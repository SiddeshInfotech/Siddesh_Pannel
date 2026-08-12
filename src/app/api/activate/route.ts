import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { supabaseAdmin } from '@/lib/supabase';
import { z } from 'zod';
import { logger } from '@/lib/logger';
import { getClientIp } from '@/lib/sanitize';
import { verifyAttestation, checkRevocation } from '@/lib/attestation';
import { verifyWindowsAttestation } from '@/lib/windowsAttestation';
import { signPayload } from '@/lib/licenseSign';
import { detectProduct } from '@/lib/product';

const ActivationRequestSchema = z.object({
  activation_key: z.string().min(1),
  hardware_fingerprint: z.string().min(1),
  device_model: z.string().optional(),
  device_os: z.string().optional(),
  // F6: device_android_id (DPDP-regulated identifier) removed. jhhgkhjb
  // NC-1: base64 SPKI of the device's hardware-backed (TEE/StrongBox) RSA key. CEKs are
  // ALWAYS wrapped to this key, and its hardware key-attestation chain (below) proves the
  // request is from genuine hardware — replacing the old extractable-HMAC request signature.
  device_wrap_pubkey: z.string().min(1),
  attestation_nonce: z.string().optional(),
  attestation_timestamp: z.string().optional(),
  attestation_chain: z.array(z.string()).optional(),
  // NC-1/telemetry: the concrete security posture the device reached while provisioning
  // its wrap key. Advisory (client-supplied, so a downgrade-lie is possible) — it drives
  // LOGGING and per-tier enforcement STAGING, not the cryptographic gate (which remains
  // attestation-chain verification + CEKs RSA-wrapped to device_wrap_pubkey). Bounded to
  // the known enum so a rogue client can't inject arbitrary strings into our logs/DB.
  security_tier: z
    .enum([
      // Android (KeystoreCrypto) taxonomy — unchanged.
      'SW_ONLY',
      'TEE_LEGACY_NOATTEST',
      'MODEL_SKIP',
      'ATTESTED_STRONGBOX',
      'ATTESTED_TEE',
      'KEYSTORE_PLAIN',
      'PROVISION_FAILED',
      // Windows desktop (TpmSealing) taxonomy — advisory/logged only. Deliberately
      // NOT added to ATTEST_CAPABLE_TIERS: desktop TPM cannot supply a Google-rooted
      // chain, so it stays in the audit-only lane exactly like a chain-less low tier.
      'WIN_TPM_ATTESTED',
      'WIN_TPM_NOATTEST',
      'WIN_SW_ONLY',
    ])
    .optional(),
});

// ── security_tier staging (must mirror the app's KeystoreCrypto taxonomy) ─────
// Enforce (fail-closed on a bad chain) ONLY for devices that reported a hardware-
// attested tier — those CAN attest, so a failed/absent chain is a genuine red flag.
// Devices reporting a genuinely non-attestable tier are allowed even with the master
// switch on. Alert tiers are logged loudly (they should not normally reach /activate).
const ATTEST_CAPABLE_TIERS = new Set(['ATTESTED_STRONGBOX', 'ATTESTED_TEE', 'WIN_TPM_ATTESTED']); // → ENFORCE
const ALERT_TIERS = new Set(['PROVISION_FAILED', 'CEK_DECRYPT_FAILED']);       // Tier 7/8 → ALERT
// Everything else — SW_ONLY / TEE_LEGACY_NOATTEST / MODEL_SKIP / KEYSTORE_PLAIN, and the
// Windows WIN_TPM_NOATTEST / WIN_SW_ONLY — is ALLOW: audit-logged but never blocked
// (device-bound via the wrap key, but genuinely can't produce a HW-attestation proof).

// Platform tag for an activation. WIN_* tiers (or a Windows device_os) => 'windows'.
function detectPlatform(tier: string, deviceOs?: string): 'android' | 'windows' {
  if (tier.startsWith('WIN_')) return 'windows';
  if ((deviceOs ?? '').toLowerCase().includes('windows')) return 'windows';
  return 'android';
}

// Setup key storage inside the workspace keys directory
const KEYS_DIR = path.join(process.cwd(), 'keys');
const PRIVATE_KEY_PATH = path.join(KEYS_DIR, 'private.pem');
const PUBLIC_KEY_PATH = path.join(KEYS_DIR, 'public.pem');

// Helper to ensure key pair exists, else generate one
function ensureKeyPair() {
  if (process.env.PRIVATE_KEY) {
    return; // Skip generation if key is provided via env
  }

  let targetKeysDir = KEYS_DIR;
  let targetPrivatePath = PRIVATE_KEY_PATH;
  let targetPublicPath = PUBLIC_KEY_PATH;

  try {
    if (!fs.existsSync(targetKeysDir)) {
      fs.mkdirSync(targetKeysDir, { recursive: true });
    }
  } catch {
    // Fallback to /tmp folder on read-only filesystems (like Vercel)
    targetKeysDir = path.join('/tmp', 'keys');
    targetPrivatePath = path.join(targetKeysDir, 'private.pem');
    targetPublicPath = path.join(targetKeysDir, 'public.pem');
    if (!fs.existsSync(targetKeysDir)) {
      fs.mkdirSync(targetKeysDir, { recursive: true });
    }
  }

  if (!fs.existsSync(targetPrivatePath) || !fs.existsSync(targetPublicPath)) {
    logger.info({ event: 'GENERATING_ECDSA_KEYPAIR' });
    const { privateKey, publicKey } = crypto.generateKeyPairSync('ec', {
      namedCurve: 'prime256v1',
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    });
    fs.writeFileSync(targetPrivatePath, privateKey);
    fs.writeFileSync(targetPublicPath, publicKey);
    logger.info({ event: 'KEYPAIR_SAVED' });
  }
}

// NC-1: max clock skew accepted between the device's attestation_timestamp and the
// server, to bound replay of a captured activation request.
// Kept at 5m on purpose: air-gapped tablets can have drifted clocks, so a tighter
// window would reject legit activations. Replay is defended by the SINGLE-USE NONCE
// (gap #2), which doesn't depend on the device clock — not by shrinking this window.
const ATTEST_MAX_SKEW_MS = 5 * 60 * 1000;

// Helper: insert handshake log (non-throwing)
async function logHandshake(data: {
  activationKey: string;
  deviceFingerprint: string;
  deviceModel: string;
  deviceOS: string;
  status: 'SUCCESS' | 'FAILED';
  errorMessage?: string;
  ipAddress: string;
  securityTier?: string | null; // lets the product be derived (WIN_* ⇒ LMS Lab desktop)
  product?: string; // precomputed product; falls back to deriving from deviceOS + tier
}) {
  await supabaseAdmin.from('handshake_logs').insert({
    activation_key: data.activationKey,
    device_fingerprint: data.deviceFingerprint,
    device_model: data.deviceModel,
    device_os: data.deviceOS,
    status: data.status,
    error_message: data.errorMessage ?? null,
    ip_address: data.ipAddress,
    product: data.product ?? detectProduct({ deviceOs: data.deviceOS, securityTier: data.securityTier }),
  });
}

// ── Per-subject key hierarchy ───────────────────────────────────────────────
// Each subject gets its own CEK derived from the master. The device receives
// only the derived per-subject keys for the class it is entitled to — never the
// master — so a single compromised tablet cannot yield the key to all content.
// MUST stay in sync with encrypt_videos.py (Mode 3) and the app's scope ids.
const SUBJECTS = ['Marathi', 'English', 'Math', 'EVS'];
// Content exists ONLY for these classes. Entitlement is always the intersection
// of what a school bought with this set — a school can never receive keys for a
// class that has no content (or that it did not pay for).
const CONTENT_CLASS_NUMBERS = [1, 2, 3, 4];

function deriveScopePassphrase(master: string, scopeId: string): string {
  return crypto.createHmac('sha256', master).update('lms-scope:' + scopeId).digest('base64');
}

// Forensic watermark code faintly shown during video playback on the device.
// It is the first 3 bytes (6 hex chars, uppercased) of SHA-256(activation_key),
// derived IDENTICALLY in the Android app (VideoPlayerScreen.kt -> watermarkTag).
// Persisting it on the activation record lets an admin paste a code seen in a
// leaked recording and find the exact key / school / tablet it was activated on.
// Pure function of the key, so it needs no new secret and never has to be sent
// by the device.
function watermarkCode(activationKey: string): string {
  return crypto.createHash('sha256').update(activationKey, 'utf8').digest('hex').slice(0, 6).toUpperCase();
}

// NC-1/F2: wrap a CEK to the device's hardware-backed public key (RSA-OAEP-SHA1).
// oaepHash 'sha1' (OAEP digest + MGF1 = SHA-1) matches the app's OAEPParameterSpec —
// required because Android Keystore hard-wires MGF1 to SHA-1 on many devices. Output is
// single base64. Returns null if the public key can't be parsed.
function wrapToPublicKey(plaintext: string, spkiBase64: string, oaepHash: 'sha1' | 'sha256' = 'sha1'): string | null {
  try {
    const publicKey = crypto.createPublicKey({
      key: Buffer.from(spkiBase64, 'base64'),
      format: 'der',
      type: 'spki',
    });
    // Android (oaepHash 'sha1'): Android Keystore hard-wires MGF1 to SHA-1 on many
    // devices, so SHA-256 OAEP fails on-device with IllegalBlockSizeException.
    // Windows/TPM (oaepHash 'sha256'): the TPM NCryptDecrypt path uses standard
    // OAEP-SHA256. The hash is chosen per platform by the caller. Both securely wrap
    // a 32-byte CEK; only the device's private half (Keystore / TPM) can unwrap.
    const enc = crypto.publicEncrypt(
      { key: publicKey, padding: crypto.constants.RSA_PKCS1_OAEP_PADDING, oaepHash },
      Buffer.from(plaintext, 'utf8')
    );
    return enc.toString('base64');
  } catch {
    return null;
  }
}

// V-07: resolve the curriculum class id(s) a school is entitled to.
// `standard` is a purchased GRADE SCOPE — either a range ("1st to 4th",
// "1st to 10th") or a single grade ("Grade 2"). We extract its integers and
// intersect with the classes that actually have content (1-4):
//   • two numbers -> inclusive range [min..max] ∩ {1..4}
//   • one number  -> that single grade if it is in {1..4}
// FAIL CLOSED: if no in-range entitlement can be determined, return [] so the
// device receives NO content keys. We NEVER fall back to "all classes" — that
// was the leak (a 5th-7th or unparseable school silently got every class' keys).
function resolveClassIds(school: any /* eslint-disable-line @typescript-eslint/no-explicit-any */): string[] {
  // 1. Explicit operator override on the school record wins, if present.
  const explicit = school?.class_id ?? school?.curriculum_class ?? school?.class;
  const explicitNums = explicit
    ? (String(explicit).match(/\d+/g) ?? []).map(Number).filter((n) => CONTENT_CLASS_NUMBERS.includes(n))
    : [];
  if (explicitNums.length) {
    return [...new Set(explicitNums)].sort((a, b) => a - b).map((n) => `class_${n}`);
  }

  // 2. Parse the controlled grade-scope field only (free-text fields can carry
  //    stray numbers like years, which must not widen entitlement).
  const nums = (String(school?.standard ?? '').match(/\d+/g) ?? []).map(Number).filter((n) => n > 0);

  let entitled: number[];
  if (nums.length >= 2) {
    const lo = Math.min(nums[0], nums[1]);
    const hi = Math.max(nums[0], nums[1]);
    entitled = CONTENT_CLASS_NUMBERS.filter((n) => n >= lo && n <= hi);
  } else if (nums.length === 1) {
    entitled = CONTENT_CLASS_NUMBERS.filter((n) => n === nums[0]);
  } else {
    entitled = []; // 3. fail closed — unknown/blank scope gets no content keys
  }

  return entitled.map((n) => `class_${n}`);
}

// ─── Rate limiting (V-03) ────────────────────────────────────────────────────
// Reuses the atomic `bump_login_rate_limit` RPC + `login_rate_limits` table
// (scripts/create_login_rate_limits.sql) — the stored key is just a namespaced
// string, so NO new table is needed. Three independent gates make /api/activate
// hard to abuse even if an attacker rotates IPs or targets a single key:
//   • IP  — coarse anti-DoS, checked BEFORE HMAC so floods die early.
//   • FP  — a single tablet should not retry activation many times.
//   • KEY — throttles brute-force against one activation key across rotated IPs.
// Enforced only in production (mirrors the login route) so dev is not throttled.
const RL_WINDOW_BURST = 10 * 1000;     // 10 seconds
const RL_WINDOW_15M = 15 * 60 * 1000;
const RL_WINDOW_1H = 60 * 60 * 1000;
const RL_IP_BURST_MAX = 5; // per IP per 10s — DYNAMIC-3/E3: trips fast on rapid-fire
                           // enumeration (incl. the pentest's "6 rapid requests")
                           // WITHOUT lowering the wider 40/15m bulk-provisioning budget
const RL_IP_MAX = 40;  // per IP per 15 min — tolerates bulk school provisioning
const RL_FP_MAX = 5;   // per device fingerprint per 15 min
const RL_KEY_MAX = 10; // per activation key per hour

async function bumpRateLimit(
  key: string,
  windowMs: number,
  max: number
): Promise<{ allowed: boolean; resetAt: number }> {
  const { data, error } = await supabaseAdmin.rpc('bump_login_rate_limit', {
    p_key: key,
    p_window_ms: windowMs,
    p_max: max,
  });
  if (error) {
    // Fail OPEN on a genuine infra error so a DB hiccup can't block ALL
    // activations fleet-wide; alert via the log instead.
    logger.warn({ event: 'ACTIVATE_RATE_LIMIT_RPC_ERROR', key, error: error.message });
    return { allowed: true, resetAt: Date.now() + windowMs };
  }
  const row = Array.isArray(data) ? data[0] : data;
  const resetAt = row?.reset_at ? new Date(row.reset_at).getTime() : Date.now() + windowMs;
  return { allowed: row?.allowed ?? true, resetAt };
}

/** Clears a rate-limit window after a successful activation. */
async function resetRateLimit(key: string): Promise<void> {
  const { error } = await supabaseAdmin.rpc('reset_login_rate_limit', { p_key: key });
  if (error) logger.warn({ event: 'ACTIVATE_RATE_LIMIT_RESET_ERROR', key, error: error.message });
}

/** Builds a uniform 429 with Retry-After (does not reveal which gate tripped). */
function rateLimited(resetAt: number): NextResponse {
  const retryAfterSecs = Math.max(1, Math.ceil((resetAt - Date.now()) / 1000));
  return NextResponse.json(
    { error: `Too many activation attempts. Try again in ${Math.ceil(retryAfterSecs / 60)} minute(s).` },
    { status: 429, headers: { 'Retry-After': String(retryAfterSecs), 'X-RateLimit-Remaining': '0' } }
  );
}

export async function POST(req: NextRequest) {
  const ipAddress = getClientIp(req.headers);
  const isProd = process.env.NODE_ENV === 'production';

  let requestKey = '';
  let requestFingerprint = '';
  let requestModel = 'Unknown Tablet';
  let requestOS = 'Android';

  try {
    // V-03 / E3: rate gates FIRST — throttle floods before HMAC/file IO.
    if (isProd) {
      // Burst gate: a short 10s window that trips at 5 requests. Rapid-fire
      // enumeration (a script, or the pentest's "6 rapid requests") gets a 429
      // by the 6th request, while the wider 40/15m budget below still allows
      // legitimate spread-out bulk school provisioning (each real activation
      // takes ~5s, so a single network won't naturally exceed 5 in 10s).
      const burstRl = await bumpRateLimit(`act_ip_burst:${ipAddress}`, RL_WINDOW_BURST, RL_IP_BURST_MAX);
      if (!burstRl.allowed) {
        logger.warn({ event: 'ACTIVATE_RATE_LIMITED_IP_BURST', ipAddress });
        return rateLimited(burstRl.resetAt);
      }
      // Coarse sustained IP gate — anti-DoS over a longer window.
      const ipRl = await bumpRateLimit(`act_ip:${ipAddress}`, RL_WINDOW_15M, RL_IP_MAX);
      if (!ipRl.allowed) {
        logger.warn({ event: 'ACTIVATE_RATE_LIMITED_IP', ipAddress });
        return rateLimited(ipRl.resetAt);
      }
    }

    ensureKeyPair();

    const rawBody = await req.text();

    let body: any /* eslint-disable-line @typescript-eslint/no-explicit-any */;
    try {
      body = JSON.parse(rawBody);
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }

    const validationResult = ActivationRequestSchema.safeParse(body);
    if (!validationResult.success) {
      const failedKey = body?.activation_key || 'MISSING_KEY';
      const failedFp = body?.hardware_fingerprint || 'MISSING_FP';
      
      await logHandshake({
        activationKey: failedKey,
        deviceFingerprint: failedFp,
        deviceModel: body?.device_model || 'Unknown Tablet',
        deviceOS: body?.device_os || 'Android',
        status: 'FAILED',
        errorMessage: 'Missing required parameters: activation_key and hardware_fingerprint',
        ipAddress,
      });
      return NextResponse.json(
        { error: 'Missing required parameters: activation_key and hardware_fingerprint' },
        { status: 400 }
      );
    }

    const {
      activation_key,
      hardware_fingerprint,
      device_model,
      device_os,
      device_wrap_pubkey,
      attestation_nonce,
      attestation_timestamp,
      attestation_chain,
      security_tier,
    } = validationResult.data;
    const reportedTier = security_tier ?? 'UNREPORTED';
    // Windows desktop vs Android tablet — drives attestation verifier, CEK wrap hash,
    // and the platform tag persisted on the activation record.
    const platform = detectPlatform(reportedTier, device_os);
    const isWindows = platform === 'windows';
    // Which product this activation is from (WIN_* tier ⇒ LMS Lab desktop; else by OS).
    // Persisted on the activation_keys row and the SUCCESS handshake log below.
    const product = detectProduct({ securityTier: security_tier, deviceOs: device_os });


    // Populate the audit/context vars from the validated request. (Bug fix:
    // these were left as '' for the whole handler — which both blanked every
    // handshake log AND made the CEK wrapping key SHA256('') instead of
    // SHA256(activation_key), so the app's unwrapKey() produced a garbage CEK
    // and encrypted video could not be decrypted after activation.)
    requestKey = activation_key;
    requestFingerprint = hardware_fingerprint;
    requestModel = device_model || 'Unknown Tablet';
    requestOS = device_os || 'Android';

    // ── NC-1: hardware key-attestation verification (replaces the extractable HMAC
    //    request signature). The device proves its CEK-wrap key is hardware-backed and
    //    minted for THIS request. Staged rollout: set LMS_ENFORCE_ATTESTATION=true (and
    //    pin Google roots via LMS_ATTEST_ROOT_CERTS) to FAIL CLOSED. Until then we verify
    //    and AUDIT-LOG only — content stays safe because every CEK is RSA-wrapped to
    //    device_wrap_pubkey regardless. ────────────────────────────────────────────────
    {
      // Large-format Android monitors/panels (e.g. x301) run low-cost AOSP boards
      // with NO Google-rooted hardware key attestation — they can never produce a
      // valid chain, so strict enforcement would permanently block them. Exempt
      // those specific models: enforcement is downgraded to audit-only for them,
      // while every real phone/tablet still fails-closed. Configurable via
      // LMS_ATTEST_EXEMPT_MODELS (comma-separated, case-insensitive); `x301` is the
      // built-in default so these panels activate with no extra config. Content is
      // NOT put at risk — every CEK is RSA-wrapped to the device's own wrap key
      // regardless of attestation. NOTE: device_model is client-supplied, so this
      // is an availability exemption, not a security boundary; keep the list tight.
      const exemptModels = (process.env.LMS_ATTEST_EXEMPT_MODELS ?? 'x301')
        .split(',')
        .map((m) => m.trim().toLowerCase())
        .filter((m) => m.length > 0);
      const modelExempt = exemptModels.includes((requestModel ?? '').trim().toLowerCase());
      // Staged per tier: with the master switch on we FAIL CLOSED only for devices that
      // reported an attestation-capable tier (Tier 4/5). Tiers 1/2/3/6 stay audit-only
      // (they genuinely cannot produce a chain, so blocking them would brick real fleets),
      // and model-exempt panels are always audit-only. This replaces the old "any chain
      // failure enforced unless model-exempt", which couldn't tell "can't attest" from
      // "attestation stripped". NOTE: security_tier is client-supplied and advisory — the
      // real protection is that every CEK is RSA-wrapped to device_wrap_pubkey regardless.
      // A device is "attestation-capable" if it reported a hardware-attested tier, OR
      // it actually presented a chain (≥2 certs) — the latter keeps older app builds
      // that send a chain but no security_tier under enforcement, so this staging never
      // weakens the prior posture for chain-senders. Genuinely chain-less low tiers
      // (SW_ONLY / *_NOATTEST / MODEL_SKIP / KEYSTORE_PLAIN) stay audit-only.
      const tierCapable =
        ATTEST_CAPABLE_TIERS.has(reportedTier) || (attestation_chain?.length ?? 0) >= 2;
      const enforceAttest =
        process.env.LMS_ENFORCE_ATTESTATION === 'true' && tierCapable && !modelExempt;
      if (ALERT_TIERS.has(reportedTier)) {
        console.warn('[ATTEST_TIER_ALERT]', JSON.stringify({ tier: reportedTier, model: requestModel, ipAddress }));
      }
      if (modelExempt) {
        console.warn(
          '[ATTEST_MODEL_EXEMPT]',
          JSON.stringify({ tier: reportedTier, model: requestModel, ipAddress })
        );
      }
      const tsNum = Number(attestation_timestamp);
      const skewOk = Number.isFinite(tsNum) && Math.abs(Date.now() - tsNum) <= ATTEST_MAX_SKEW_MS;
      // Route to the platform's attestation verifier: Android = Google-rooted key
      // attestation (X.509 chain); Windows = TPM platform claim (DRM-006).
      const att = isWindows
        ? verifyWindowsAttestation({
            claimB64: attestation_chain ?? [],
            deviceWrapPubkeyB64: device_wrap_pubkey,
            activationKey: activation_key,
            nonce: attestation_nonce ?? '',
            timestamp: attestation_timestamp ?? '',
            tier: reportedTier,
          })
        : verifyAttestation({
            chainB64: attestation_chain ?? [],
            deviceWrapPubkeyB64: device_wrap_pubkey,
            activationKey: activation_key,
            nonce: attestation_nonce ?? '',
            timestamp: attestation_timestamp ?? '',
          });

      // Gap #2 — single-use nonce (replay defense). Reuse the rate-limit RPC with
      // max=1 over the skew window: the first use of a nonce is allowed; any repeat
      // within the window is a replay → blocked. Fails OPEN on infra error (a replay
      // is already useless because the CEK is RSA-wrapped to the original device key).
      let nonceOk = true;
      if (isProd && attestation_nonce) {
        const nrl = await bumpRateLimit(`att_nonce:${attestation_nonce}`, ATTEST_MAX_SKEW_MS, 1);
        nonceOk = nrl.allowed;
      }

      // Gap #5 — optional Google revocation-list check (Android only; OFF by default,
      // fails open). Windows TPM claims are not on Google's list, so it is skipped.
      const rev = isWindows
        ? { revoked: false as boolean, reason: undefined as string | undefined }
        : await checkRevocation(attestation_chain ?? []);

      // NOTE: the app `logger` is silenced, so these use console.* directly — that is
      // what shows up in Vercel runtime logs (search "ATTEST").
      if (!skewOk || !att.ok || !nonceOk || rev.revoked) {
        const reason = !skewOk
          ? 'attestation timestamp skew'
          : !nonceOk
          ? 'attestation nonce replay'
          : rev.revoked
          ? rev.reason
          : att.reason;
        if (enforceAttest) {
          console.warn('[ATTEST_FAILED_ENFORCED]', JSON.stringify({ tier: reportedTier, reason, ipAddress }));
          await logHandshake({
            activationKey: requestKey,
            deviceFingerprint: requestFingerprint,
            deviceModel: requestModel,
            deviceOS: requestOS,
            status: 'FAILED',
            errorMessage: `Device attestation verification failed (tier=${reportedTier}).`,
            ipAddress,
          });
          return NextResponse.json({ error: 'Request signature verification failed.' }, { status: 401 });
        }
        console.warn('[ATTEST_FAILED_AUDIT]', JSON.stringify({ tier: reportedTier, reason, ipAddress }));
      } else {
        // Positive confirmation that attestation PASSED — safe to flip
        // LMS_ENFORCE_ATTESTATION=true once you see this for your real devices.
        console.log('[ATTEST_OK]', JSON.stringify({ tier: reportedTier, chainLen: (attestation_chain ?? []).length, ipAddress }));
      }
    }

    // V-03: targeted gates — per-device (a tablet shouldn't retry much) and
    // per-key (throttle brute-force on one key even across rotated IPs), BEFORE
    // any DB lookup so enumeration/brute-force never reaches Supabase at speed.
    if (isProd) {
      const fpRl = await bumpRateLimit(`act_fp:${hardware_fingerprint}`, RL_WINDOW_15M, RL_FP_MAX);
      if (!fpRl.allowed) {
        logger.warn({ event: 'ACTIVATE_RATE_LIMITED_FP', ipAddress });
        return rateLimited(fpRl.resetAt);
      }
      const keyRl = await bumpRateLimit(`act_key:${activation_key}`, RL_WINDOW_1H, RL_KEY_MAX);
      if (!keyRl.allowed) {
        logger.warn({ event: 'ACTIVATE_RATE_LIMITED_KEY', ipAddress });
        return rateLimited(keyRl.resetAt);
      }
    }

    // ── 1. Locate activation key record ───────────────────────────────────
    const { data: keyRecord, error: keyError } = await supabaseAdmin
      .from('activation_keys')
      .select('*')
      .eq('key', activation_key)
      .single();

    if (keyError || !keyRecord) {
      await logHandshake({
        activationKey: requestKey,
        deviceFingerprint: requestFingerprint,
        deviceModel: requestModel,
        deviceOS: requestOS,
        status: 'FAILED',
        errorMessage: 'Invalid activation key. Key not found in system.',
        ipAddress,
      });
      return NextResponse.json(
        { error: 'Invalid activation key. Key not found in system.' },
        { status: 404 }
      );
    }

    // ── Check Revoked ──────────────────────────────────────────────────────
    if (keyRecord.status === 'Revoked') {
      await logHandshake({
        activationKey: requestKey,
        deviceFingerprint: requestFingerprint,
        deviceModel: requestModel,
        deviceOS: requestOS,
        status: 'FAILED',
        errorMessage: 'This activation key has been deactivated by the administrator.',
        ipAddress,
      });
      return NextResponse.json(
        { error: 'This activation key has been deactivated by the administrator.' },
        { status: 403 }
      );
    }

    // ── Check Expired ──────────────────────────────────────────────────────
    if (keyRecord.expires_at && new Date() > new Date(keyRecord.expires_at)) {
      await logHandshake({
        activationKey: requestKey,
        deviceFingerprint: requestFingerprint,
        deviceModel: requestModel,
        deviceOS: requestOS,
        status: 'FAILED',
        errorMessage: 'This activation key has expired and is no longer valid.',
        ipAddress,
      });
      return NextResponse.json(
        { error: 'This activation key has expired and is no longer valid.' },
        { status: 403 }
      );
    }

    // ── 2. Enforce one-time tablet binding ─────────────────────────────────
    if (keyRecord.device_fingerprint && keyRecord.device_fingerprint !== hardware_fingerprint) {
      await logHandshake({
        activationKey: requestKey,
        deviceFingerprint: requestFingerprint,
        deviceModel: requestModel,
        deviceOS: requestOS,
        status: 'FAILED',
        errorMessage: 'Key sharing blocked. This activation key is strictly locked to another tablet.',
        ipAddress,
      });
      return NextResponse.json(
        { error: 'Key sharing blocked. This activation key is strictly locked to another tablet.' },
        { status: 403 }
      );
    }

    // ── 3. Mark key as Active & set activation metrics ─────────────────────
    const activatedAt = new Date();
    const expiresAt = keyRecord.expires_at
      ? new Date(keyRecord.expires_at)
      : new Date(activatedAt.getTime() + keyRecord.duration_days * 24 * 60 * 60 * 1000);

    const { error: updateError } = await supabaseAdmin
      .from('activation_keys')
      .update({
        device_fingerprint: hardware_fingerprint,
        device_model: requestModel,
        device_os: requestOS,
        device_board: body?.device_board || 'N/A',
        device_brand: body?.device_brand || 'N/A',
        device_device: body?.device_device || 'N/A',
        device_manufacturer: body?.device_manufacturer || 'N/A',
        status: 'Active',
        product,
        activated_at: activatedAt.toISOString(),
        expires_at: expiresAt.toISOString(),
        last_known_monotonic_time: activatedAt.toISOString(),
      })
      .eq('id', keyRecord.id);

    if (updateError) {
      throw new Error(`Failed to update activation key: ${updateError.message}`);
    }

    // ── 3b. Persist forensic watermark code (best-effort) ──────────────────
    // Stored so an admin can look up which tablet a leaked recording came from.
    // Done as a SEPARATE, non-blocking update: if the `watermark_code` column is
    // not present yet (run scripts/add_watermark_code.sql), Supabase returns an
    // error we just log — the activation handshake is never broken by it.
    {
      const { error: wmError } = await supabaseAdmin
        .from('activation_keys')
        .update({ watermark_code: watermarkCode(activation_key) })
        .eq('id', keyRecord.id);
      if (wmError) {
        logger.warn({ event: 'WATERMARK_CODE_PERSIST_FAILED', keyId: keyRecord.id, error: wmError.message });
      }
    }

    // ── 3c. Persist device security tier (best-effort) ─────────────────────
    // Kept as a SEPARATE, non-blocking update (independent of the watermark one) so a
    // not-yet-migrated `security_tier` column cannot break activation OR drop the
    // watermark write. Run scripts/add_security_tier.sql to add the column. Once present
    // an admin can filter the fleet by posture (e.g. all TEE_LEGACY_NOATTEST panels).
    if (security_tier) {
      const { error: stError } = await supabaseAdmin
        .from('activation_keys')
        .update({ security_tier })
        .eq('id', keyRecord.id);
      if (stError) {
        logger.warn({ event: 'SECURITY_TIER_PERSIST_FAILED', keyId: keyRecord.id, error: stError.message });
      }
    }

    // ── 3d. Persist device platform tag (best-effort) ──────────────────────
    // android | windows — lets the panel distinguish Windows desktop activations
    // from Android tablets. Separate non-blocking update; run scripts/add_platform.sql
    // to add the column (until then this logs and is skipped).
    {
      const { error: pfError } = await supabaseAdmin
        .from('activation_keys')
        .update({ platform })
        .eq('id', keyRecord.id);
      if (pfError) {
        logger.warn({ event: 'PLATFORM_PERSIST_FAILED', keyId: keyRecord.id, error: pfError.message });
      }
    }

    // ── 3e. Record the SIGNED expiry + clear any prior tamper flag (best-effort) ──
    // `signed_expires_at` is the exact expiry we are about to sign into the payload below.
    // It is the immutable ground truth the ping route compares device reports against, and
    // is deliberately SEPARATE from `expires_at` (which an admin may later shorten/extend).
    // A fresh (re)activation also clears any previous expiry-tamper flag. Non-blocking:
    // run scripts/add_expiry_tamper.sql to add these columns (until then this logs + skips).
    {
      const { error: etError } = await supabaseAdmin
        .from('activation_keys')
        .update({
          signed_expires_at: expiresAt.toISOString(),
          expiry_tamper_flag: false,
          expiry_tamper_at: null,
          expiry_tamper_detail: null,
        })
        .eq('id', keyRecord.id);
      if (etError) {
        logger.warn({ event: 'SIGNED_EXPIRY_PERSIST_FAILED', keyId: keyRecord.id, error: etError.message });
      }
    }

    // ── 4. Fetch School metadata ───────────────────────────────────────────
    const { data: school } = await supabaseAdmin
      .from('schools')
      .select('*')
      .eq('id', keyRecord.school_id)
      .single();

    const schoolName = school ? school.name : 'LMS Institution';

    // ── 5. Construct licensing JWT payload ────────────────────────────────
    const payload = {
      school_id: keyRecord.school_id,
      school_name: schoolName,
      board: school ? school.board : 'State Board',
      mediums: school ? school.mediums : ['Semi-English'],
      academicYear: school?.academic_year || '2026-27',
      section: school?.section || 'Section A',
      standard: school?.standard || 'Primary',
      fullClassName: school?.full_class_name || 'Curriculum Portal',
      device_fingerprint: hardware_fingerprint,
      activation_date: activatedAt.toISOString(),
      expiration_date: expiresAt.toISOString(),
      features: ['video_playback', 'offline_tests'],
    };

    const payloadStr = JSON.stringify(payload);

    // ── 6. Sign payload with ECDSA private key ────────────────────────────
    // Shared signer (src/lib/licenseSign.ts) — same key /api/device/ping uses to
    // sign Signed Renewable Leases, so the client verifies both with one pinned key.
    const signature = signPayload(payloadStr);

    // ── 7. Log success ────────────────────────────────────────────────────
    await logHandshake({
      activationKey: requestKey,
      deviceFingerprint: requestFingerprint,
      deviceModel: requestModel,
      deviceOS: requestOS,
      status: 'SUCCESS',
      ipAddress,
      product,
    });

    // V-03: activation succeeded — clear this device's & key's brute-force
    // windows so legitimate retries (a couple of failed attempts before success)
    // don't count against the owner. The IP window is left to expire naturally.
    if (isProd) {
      await resetRateLimit(`act_fp:${hardware_fingerprint}`);
      await resetRateLimit(`act_key:${activation_key}`);
    }

    // ── 8. Envelope key wrapping of CEK ──────────────────────────────────
    const masterCekRaw = process.env.LMS_MASTER_CEK;
    if (!masterCekRaw) {
      logger.error({ event: 'CRITICAL_CONFIG_ERROR', message: 'LMS_MASTER_CEK missing' });
      return NextResponse.json({ success: false, error: 'Internal Server Error' }, { status: 500 });
    }
    const masterCek = masterCekRaw;

    // NC-1/F2: the CEK is ALWAYS wrapped to the device's hardware-backed public key
    // (RSA-OAEP-SHA256) — only that device's TEE/StrongBox private key can unwrap it.
    // The old symmetric Tier-2 wrap is removed: its key was derived from the shared
    // native HMAC secret that has been deleted from the app.
    // Windows/TPM unwraps with OAEP-SHA256; Android Keystore requires OAEP-SHA1.
    const oaepHash: 'sha1' | 'sha256' = isWindows ? 'sha256' : 'sha1';
    const wrapOne = (plaintext: string): string => {
      const out = wrapToPublicKey(plaintext, device_wrap_pubkey, oaepHash);
      if (!out) throw new Error('Failed to wrap CEK to device public key');
      return out;
    };

    // Per-subject wrapped CEKs — only for the classes this school is entitled to.
    const classIds = resolveClassIds(school);
    if (classIds.length === 0) {
      // Fail closed: the device activates but gets no content keys. Surface it so
      // the operator can fix a school whose grade scope is blank/out-of-range.
      logger.warn({
        event: 'ACTIVATE_NO_ENTITLEMENT',
        ipAddress,
        schoolId: keyRecord.school_id,
        standard: school?.standard ?? null,
      });
    }
    const wrappedCeks: Record<string, string> = {};
    for (const classId of classIds) {
      for (const subject of SUBJECTS) {
        const scopeId = `${classId}/${subject}`;
        wrappedCeks[scopeId] = wrapOne(deriveScopePassphrase(masterCek, scopeId));
      }
    }

    // ── 9. Return signed token ────────────────────────────────────────────
    const responseBody: Record<string, unknown> = {
      header: { alg: 'ES256', typ: 'JWT' },
      payload,
      payload_str: payloadStr,
      signature,
      wks: wrappedCeks,                 // F7: opaque wire name (client maps wks -> wrapped_ceks)
    };

    // Legacy single master CEK (unlocks ALL classes). V-07: NEVER send it to a
    // device that is not entitled to every content class — that would defeat the
    // per-class scoping above. Also gated by LMS_DISABLE_LEGACY_CEK so it can be
    // turned off entirely once all content is on per-subject keys (recommended).
    const entitledToAll = CONTENT_CLASS_NUMBERS.every((n) => classIds.includes(`class_${n}`));
    if (process.env.LMS_DISABLE_LEGACY_CEK !== 'true' && entitledToAll) {
      responseBody.wk0 = wrapOne(masterCek);   // F7: opaque wire name (client maps wk0 -> wrapped_cek)
    }

    return NextResponse.json(responseBody);
  } catch (err: unknown) {
    // V-03: keep the real exception in SERVER logs only. Never echo it to the
    // client — leaking exception text aids enumeration/attack tuning. The HTTP
    // response stays generic.
    const debugMsg = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
    console.error('ACTIVATE_FAIL:', err instanceof Error ? err.stack : err);
    logger.error({ event: 'HANDSHAKE_CRITICAL_ERROR', ipAddress, debugMsg }, err);

    await logHandshake({
      activationKey: requestKey || 'UNKNOWN',
      deviceFingerprint: requestFingerprint || 'UNKNOWN',
      deviceModel: requestModel,
      deviceOS: requestOS,
      status: 'FAILED',
      errorMessage: `handshake error: ${debugMsg}`,
      ipAddress,
    }).catch(() => {});

    return NextResponse.json(
      { error: 'Cryptographic activation handshake failed.' },
      { status: 500 }
    );
  }
}
