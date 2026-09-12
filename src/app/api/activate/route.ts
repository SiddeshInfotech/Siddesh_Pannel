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
import { resolveEffectiveProductId, resolveLegacyProductId, checkProductMatch } from '@/lib/product';
import { PRODUCT_ID_ENUM, productDisplayName, familyFor, isProductId } from '@/lib/productIdentity';
import { entityRefFromRow, resolveEntity, isEntitledToAll } from '@/lib/entity';
import { shouldEnforceAttestation, deriveServerTier, validateAttestationConfig } from '@/lib/attestationPolicy';
import { labScopeIds } from '@/lib/labCourses';
import { recordAttestationIssue } from '@/lib/attestationTelemetry';
import { isPanelKey, isPanelActivationWindowClosed, DEVICE_CLASS_MANAGED_PANEL } from '@/lib/deviceClass';
import { wrapToPublicKey } from '@/lib/deviceWrap';

// SF-2 remediation: warn loudly at module load (once per server instance) if the
// deployed env-var combination is dangerous or silently reopens the tier-trust hole
// this file used to have. See attestationPolicy.ts.
validateAttestationConfig();

const ActivationRequestSchema = z.object({
  activation_key: z.string().min(1),
  hardware_fingerprint: z.string().min(1),
  device_model: z.string().optional(),
  device_os: z.string().optional(),
  app_version: z.string().optional(),
  // Canonical, compiled-in client product identity (src/lib/productIdentity.ts). Optional
  // for backward compatibility: older/unmigrated clients (incl. production LMS School
  // Android, which never sends this) fall back to resolveLegacyProductId() heuristics.
  // When present it is authoritative and gated against the license's pinned product below.
  product_id: z.enum(PRODUCT_ID_ENUM).optional(),
  // F6: device_android_id (DPDP-regulated identifier) removed. jhhgkhjb
  // NC-1: base64 SPKI of the device's hardware-backed (TEE/StrongBox) RSA key. CEKs are
  // ALWAYS wrapped to this key, and its hardware key-attestation chain (below) proves the
  // request is from genuine hardware — replacing the old extractable-HMAC request signature.
  device_wrap_pubkey: z.string().min(1),
  attestation_nonce: z.string().optional(),
  attestation_timestamp: z.string().optional(),
  attestation_chain: z.array(z.string()).optional(),
  // NC-1/telemetry: the concrete security posture the device SELF-REPORTS while
  // provisioning its wrap key. SF-2: this is client-supplied and a downgrade-lie is
  // trivial, so it is used for LOGGING/debugging only — it plays NO role in whether
  // attestation is enforced (see attestationPolicy.ts) or in the persisted
  // attestation_verified_tier (server-derived from what was actually cryptographically
  // observed). Bounded to the known enum so a rogue client can't inject arbitrary
  // strings into our logs/DB.
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
      // Windows desktop (TpmSealing) taxonomy — advisory/logged only.
      'WIN_TPM_ATTESTED',
      'WIN_TPM_NOATTEST',
      'WIN_SW_ONLY',
    ])
    .optional(),
  // [Windows] Real request-binding: RSA-SHA256 signature (base64) over
  // "<activation_key|attestation_nonce|attestation_timestamp>", made with the wrap private key.
  // Verified against device_wrap_pubkey (see verifyWindowsAttestation). Optional/advisory.
  challenge_signature: z.string().max(1024).optional(),
  // Deferred Terms & Conditions consent. A device whose /api/device/terms-accept was refused
  // for hardware attestation (an interactive panel, before it has a key) carries its consent
  // here instead; it is recorded in terms_acceptances ONLY after this activation succeeds.
  terms_version: z.string().min(1).max(40).optional(),
  privacy_version: z.string().min(1).max(40).optional(),
  terms_accepted_at: z.string().min(1).max(40).optional(),
});

// ── security_tier staging (must mirror the app's KeystoreCrypto taxonomy) ─────
// security_tier itself is CLIENT-SUPPLIED and is NEVER used to decide enforcement (see
// attestationPolicy.ts — that decision is now purely env-var + explicit model allowlist
// driven). It is kept only as an ALERT signal (below) and for admin telemetry.
const ALERT_TIERS = new Set(['PROVISION_FAILED', 'CEK_DECRYPT_FAILED']);       // Tier 7/8 → ALERT

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

// Shown by the Android app and the Windows desktop app when a one-time key is reused
// (both surface the server's `error` text as-is). Same text for same/other device so the
// response doesn't reveal where the key is bound; the handshake log records which.
// The one-time key is CLAIMED (bound to the device) before the licence is built, signed and
// its CEKs wrapped. If the function were cut off after the claim, the device would never get
// its licence yet the key would stay bound (admin "Reset Device Binding" needed). Give the
// handler headroom over slow cold starts / revocation fetch; clients wait up to 60 s too.
export const maxDuration = 60;

const KEY_ALREADY_USED_MESSAGE =
  'This activation key has already been used and cannot be activated again. Please contact your administrator.';

// Helper: insert handshake log (non-throwing)
async function logHandshake(data: {
  activationKey: string;
  deviceFingerprint: string;
  deviceModel: string;
  deviceOS: string;
  status: 'SUCCESS' | 'FAILED';
  errorMessage?: string;
  ipAddress: string;
  securityTier?: string | null; // advisory posture only — NOT a product signal, see src/lib/product.ts
  productId?: string; // precomputed canonical product id; falls back to the legacy heuristic
}) {
  const productId = data.productId ?? resolveLegacyProductId({ deviceOs: data.deviceOS, securityTier: data.securityTier });
  await supabaseAdmin.from('handshake_logs').insert({
    activation_key: data.activationKey,
    device_fingerprint: data.deviceFingerprint,
    device_model: data.deviceModel,
    device_os: data.deviceOS,
    status: data.status,
    error_message: data.errorMessage ?? null,
    ip_address: data.ipAddress,
    product_id: productId,
  });
}

// ── Per-subject key hierarchy ───────────────────────────────────────────────
// Each subject gets its own CEK derived from the master. The device receives
// only the derived per-subject keys for the class it is entitled to — never the
// master — so a single compromised tablet cannot yield the key to all content.
// MUST stay in sync with encrypt_videos.py (Mode 3) and the app's scope ids.
const SUBJECTS = ['Marathi', 'English', 'Math', 'EVS'];
// Content class entitlement now lives in src/lib/entity.ts (resolveEntity), shared by
// the School/Vendor/Parent chain. CONTENT_CLASS_NUMBERS is imported from there.

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

// wrapToPublicKey (RSA-OAEP to the device key) lives in src/lib/deviceWrap.ts — shared with the
// managed-panel proof-of-possession challenge in /api/device/ping.

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
      app_version,
      device_wrap_pubkey,
      attestation_nonce,
      attestation_timestamp,
      attestation_chain,
      security_tier,
      challenge_signature,
      terms_version,
      privacy_version,
      terms_accepted_at,
    } = validationResult.data;
    const reportedTier = security_tier ?? 'UNREPORTED';
    // Windows desktop vs Android tablet — drives attestation verifier, CEK wrap hash,
    // and the platform tag persisted on the activation record.
    const platform = detectPlatform(reportedTier, device_os);
    const isWindows = platform === 'windows';
    // Canonical product identity this activation is from: the client's own declared
    // product_id if it sent one (authoritative), else the legacy signal-based heuristic
    // (production LMS School Android, and any not-yet-updated Windows/Lab client).
    // Persisted on the activation_keys row and the SUCCESS handshake log below; also
    // gated against the license's pinned product just after the key is looked up.
    const clientProductId = resolveEffectiveProductId({
      productId: validationResult.data.product_id,
      securityTier: security_tier,
      deviceOs: device_os,
      appVersion: app_version,
    });


    // Populate the audit/context vars from the validated request. (Bug fix:
    // these were left as '' for the whole handler — which both blanked every
    // handshake log AND made the CEK wrapping key SHA256('') instead of
    // SHA256(activation_key), so the app's unwrapKey() produced a garbage CEK
    // and encrypted video could not be decrypted after activation.)
    requestKey = activation_key;
    requestFingerprint = hardware_fingerprint;
    requestModel = device_model || 'Unknown Tablet';
    requestOS = device_os || 'Android';

    // SF-2: server-derived, authoritative tier — computed from what the server itself
    // cryptographically observed, never from the client's self-reported security_tier.
    // Persisted separately below (3c-bis) for admin fleet-posture auditing.
    let serverAttestationTier: ReturnType<typeof deriveServerTier> = 'UNSUPPORTED';
    // Managed classroom panel = the activation KEY was generated as "Interactive panel"
    // (activation_keys.device_class, src/lib/deviceClass.ts), Android only. Never derived from
    // the device's model/brand/OS (self-reported). Known only after the key lookup below, so the
    // attestation verdict is DEFERRED until then. A panel key: attestation audit-only + panel
    // rules (activation window, consent, device-key binding) + signed `device_class` (step 5).
    let managedPanel = false;
    // Set when attestation failed and the env policy would enforce it; resolved after the
    // key lookup (a panel key downgrades it to audit-only; anything else → 401 as before).
    // replayOrSkew: a stale timestamp or reused nonce is NEVER excused by a panel key — those
    // guard against replayed requests, not against missing hardware attestation.
    let deferredAttestFailure: { reason: string | undefined; replayOrSkew: boolean } | null = null;

    // ── NC-1: hardware key-attestation verification (replaces the extractable HMAC
    //    request signature). The device proves its CEK-wrap key is hardware-backed and
    //    minted for THIS request. Staged rollout: set LMS_ENFORCE_ATTESTATION=true (and
    //    pin Google roots via LMS_ATTEST_ROOT_CERTS) to FAIL CLOSED. Until then we verify
    //    and AUDIT-LOG only — content stays safe because every CEK is RSA-wrapped to
    //    device_wrap_pubkey regardless. ────────────────────────────────────────────────
    {
      // SF-2 remediation: enforcement used to be gated on the CLIENT-SUPPLIED
      // security_tier ("only enforce devices that claim to be attestation-capable") —
      // a device could simply self-report a low tier (or omit its chain) to make itself
      // indistinguishable from hardware that genuinely can't attest, and sail through
      // with an entirely unattested device_wrap_pubkey. Enforcement now applies to
      // EVERY device (a device model never exempts — see attestationPolicy.ts); the only
      // relaxation is an operator-issued Interactive-panel KEY, resolved after the key
      // lookup. Content was never solely reliant on this gate (every CEK is RSA-wrapped to
      // device_wrap_pubkey regardless), but the gate must not be decided by client input.
      const enforceAttest = shouldEnforceAttestation();
      if (ALERT_TIERS.has(reportedTier)) {
        console.warn('[ATTEST_TIER_ALERT]', JSON.stringify({ tier: reportedTier, model: requestModel, os: requestOS, ipAddress }));
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
            challengeSignatureB64: challenge_signature,
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

      // Real evidence presence, independent of whether it verified — Android always
      // needs >=2 certs; Windows only needs a non-empty claim blob (a single entry).
      const chainPresent = isWindows
        ? (attestation_chain?.length ?? 0) >= 1 && !!attestation_chain?.[0]
        : (attestation_chain?.length ?? 0) >= 2;

      serverAttestationTier = deriveServerTier({
        isWindows,
        chainPresent,
        attestationOk: att.ok,
        revoked: rev.revoked,
        skewOk,
        nonceOk,
        securityLevel: att.securityLevel,
      });

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
          // Verdict deferred to just after the key lookup (see deferredAttestFailure): only an
          // Interactive-panel key can downgrade it. Telemetry is written there too, with the
          // final enforced/audit-only outcome.
          deferredAttestFailure = { reason, replayOrSkew: !skewOk || !nonceOk };
        } else {
          // Admin-only diagnostic: record WHICH device failed WHY, so the monitoring panel
          // can show it instead of only Vercel's server logs. Detailed reasons are not
          // intentionally returned in the API response — the client gets the same generic
          // message either way, enforced or not. See attestationTelemetry.ts for the full
          // safeguard list (bounded reason codes, deduplication, best-effort,
          // security-vs-health-warning separation).
          await recordAttestationIssue({
            deviceFingerprint: hardware_fingerprint,
            // The license-pin-matched `product` isn't computed until after the key lookup
            // below — this fires before that, so use the client-declared/heuristic identity
            // already resolved above (same "raw, unpinned" value terms-accept/route.ts uses
            // for its own telemetry record).
            product: clientProductId,
            tier: serverAttestationTier,
            rawReason: reason,
            enforced: false,
            deviceModel: requestModel,
            ip: ipAddress,
            stage: 'activate',
          });
          console.warn('[ATTEST_FAILED_AUDIT]', JSON.stringify({ tier: reportedTier, reason, model: requestModel, os: requestOS, ipAddress }));
        }
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

    // ── 1b. Resolve the deferred attestation verdict ─────────────────────────
    // Only an Android device presenting an Interactive-panel key is downgraded to audit-only.
    // Every other case — Standard key, Windows, or an unknown key — is rejected with the SAME
    // 401 as before this change, and BEFORE the 404 below, so a device that fails attestation
    // still learns nothing about whether a key exists.
    const panelKey = !isWindows && isPanelKey(keyRecord);
    managedPanel = panelKey;
    if (deferredAttestFailure) {
      const { reason, replayOrSkew } = deferredAttestFailure;
      const enforced = !panelKey || replayOrSkew;
      await recordAttestationIssue({
        deviceFingerprint: hardware_fingerprint,
        product: clientProductId,
        tier: serverAttestationTier,
        rawReason: reason,
        enforced,
        deviceModel: requestModel,
        ip: ipAddress,
        stage: 'activate',
      });
      if (enforced) {
        console.warn('[ATTEST_FAILED_ENFORCED]', JSON.stringify({ tier: reportedTier, reason, model: requestModel, os: requestOS, ipAddress }));
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
      console.warn('[ATTEST_PANEL_KEY_AUDIT]', JSON.stringify({ tier: reportedTier, reason, model: requestModel, os: requestOS, ipAddress }));
    } else if (panelKey) {
      console.log('[ATTEST_PANEL_KEY]', JSON.stringify({ tier: reportedTier, model: requestModel, os: requestOS, ipAddress }));
    }

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

    // ── PRODUCT IDENTITY GATE ───────────────────────────────────────────────
    // A license already pinned to a product (set explicitly at Key Generation, or pinned
    // by a prior activation) MUST match what this client declares — cross-product
    // activation (e.g. an LMS Lab Windows key on the LMS School Windows app) is rejected
    // outright, regardless of how well the device otherwise attests. A legacy key with no
    // pinned product yet self-heals by pinning to this first genuine contact.
    const productMatch = checkProductMatch(keyRecord.product_id, clientProductId);
    if (!productMatch.ok) {
      await logHandshake({
        activationKey: requestKey,
        deviceFingerprint: requestFingerprint,
        deviceModel: requestModel,
        deviceOS: requestOS,
        status: 'FAILED',
        errorMessage: `Product mismatch: key licensed for ${productDisplayName(keyRecord.product_id)}, client is ${productDisplayName(
          clientProductId === 'UNKNOWN' ? null : clientProductId
        )}.`,
        ipAddress,
        productId: keyRecord.product_id,
      });
      return NextResponse.json(
        {
          error: `This activation key is licensed for ${productDisplayName(
            keyRecord.product_id
          )} and cannot be used with this application.`,
        },
        { status: 403 }
      );
    }
    // Effective product to persist below: either the license's existing pin, or the
    // newly-computed pin for a previously-unpinned key.
    const product = productMatch.pin ?? keyRecord.product_id;

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

    // ── 1c. Interactive-panel key rules (panel keys only; Standard keys skip this) ──
    if (panelKey) {
      // A panel key that was never used within its activation window is dead — this bounds
      // how long a leaked, unused panel key stays exploitable.
      if (isPanelActivationWindowClosed(keyRecord)) {
        await logHandshake({
          activationKey: requestKey,
          deviceFingerprint: requestFingerprint,
          deviceModel: requestModel,
          deviceOS: requestOS,
          status: 'FAILED',
          errorMessage: 'Panel key activation window closed (not activated in time).',
          ipAddress,
        });
        return NextResponse.json(
          { error: 'This panel key was not activated within its allowed time. Please ask your administrator for a new panel key.' },
          { status: 403 }
        );
      }
      // Consent is mandatory for a panel: either carried with this request (deferred from the
      // Terms screen — the normal panel path) or already recorded by /api/device/terms-accept.
      if (!terms_version) {
        const { data: priorConsent } = await supabaseAdmin
          .from('terms_acceptances')
          .select('device_fingerprint')
          .eq('device_fingerprint', hardware_fingerprint)
          .maybeSingle();
        if (!priorConsent) {
          await logHandshake({
            activationKey: requestKey,
            deviceFingerprint: requestFingerprint,
            deviceModel: requestModel,
            deviceOS: requestOS,
            status: 'FAILED',
            errorMessage: 'Panel activation without Terms & Conditions consent.',
            ipAddress,
          });
          return NextResponse.json(
            { error: 'Please accept the Privacy Policy and Terms & Conditions before activating.' },
            { status: 400 }
          );
        }
      }
    }

    // ── 2. Enforce ONE-TIME key use ────────────────────────────────────────
    // A key is single-use: once an activation has bound it to a device, every later
    // activation with it is refused — on another device (key sharing) AND on the same
    // device (reinstall / app-data clear / re-activation from the Android app or the
    // Windows desktop). An already-activated device is unaffected: it opens from its stored
    // signed license and only talks to /api/device/ping. To move a key to a repaired or
    // reinstalled device an admin uses "Reset Device Binding" (keys/actions.ts), which
    // clears device_fingerprint and makes the key usable exactly once more.
    if (keyRecord.device_fingerprint) {
      const sameDevice = keyRecord.device_fingerprint === hardware_fingerprint;
      await logHandshake({
        activationKey: requestKey,
        deviceFingerprint: requestFingerprint,
        deviceModel: requestModel,
        deviceOS: requestOS,
        status: 'FAILED',
        errorMessage: sameDevice
          ? 'Key already used. Re-activation on the same device blocked (one-time key).'
          : 'Key sharing blocked. This activation key is already used on another device.',
        ipAddress,
      });
      return NextResponse.json({ error: KEY_ALREADY_USED_MESSAGE }, { status: 403 });
    }

    // ── 3. Mark key as Active & set activation metrics ─────────────────────
    const activatedAt = new Date();
    const expiresAt = keyRecord.expires_at
      ? new Date(keyRecord.expires_at)
      : new Date(activatedAt.getTime() + keyRecord.duration_days * 24 * 60 * 60 * 1000);

    // The `.is('device_fingerprint', null)` filter makes this an atomic CLAIM: if two devices
    // race to activate the same unused key, only the first UPDATE matches the row — the
    // other gets zero rows back and is refused below, so a key can never bind twice.
    const { data: claimedRows, error: updateError } = await supabaseAdmin
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
        activated_at: activatedAt.toISOString(),
        expires_at: expiresAt.toISOString(),
        last_known_monotonic_time: activatedAt.toISOString(),
      })
      .eq('id', keyRecord.id)
      .is('device_fingerprint', null)
      .select('id');

    if (updateError) {
      throw new Error(`Failed to update activation key: ${updateError.message}`);
    }
    if (!claimedRows || claimedRows.length === 0) {
      await logHandshake({
        activationKey: requestKey,
        deviceFingerprint: requestFingerprint,
        deviceModel: requestModel,
        deviceOS: requestOS,
        status: 'FAILED',
        errorMessage: 'Key already used. Lost a concurrent activation race for this key (one-time key).',
        ipAddress,
      });
      return NextResponse.json({ error: KEY_ALREADY_USED_MESSAGE }, { status: 403 });
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

    // An Interactive-panel activation without verified hardware attestation is classified
    // honestly: licence-authorized + device-key-bound, NOT hardware-attested. A panel that did
    // produce valid attestation keeps its stronger VERIFIED_* tier.
    if (panelKey && !serverAttestationTier.startsWith('VERIFIED_')) {
      serverAttestationTier = 'MANAGED_PANEL_BOUND';
    }

    // ── 3c-bis. Persist the SERVER-DERIVED attestation tier (best-effort) ──────
    // SF-2: unlike security_tier above (the client's own self-report, kept only for
    // debugging), this column is what the server itself cryptographically observed —
    // the value an admin auditing fleet posture should actually trust. Separate,
    // non-blocking update; run scripts/add_attestation_verified_tier.sql to add the
    // column (until then this logs and is skipped).
    {
      const { error: avtError } = await supabaseAdmin
        .from('activation_keys')
        .update({ attestation_verified_tier: serverAttestationTier })
        .eq('id', keyRecord.id);
      if (avtError) {
        logger.warn({ event: 'ATTESTATION_VERIFIED_TIER_PERSIST_FAILED', keyId: keyRecord.id, error: avtError.message });
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

    // ── 3d-panel. Interactive panel: bind the device key + lifecycle (best-effort) ──
    // Needs scripts/add_interactive_panel.sql. Until it runs these writes log + skip: the panel
    // still activates, but the heartbeat proof-of-possession stays off for it.
    if (panelKey) {
      // The enrolled device key — the heartbeat keeps proving possession of it (src/lib/panelPop.ts).
      const { error: pbError } = await supabaseAdmin
        .from('activation_keys')
        .update({
          device_wrap_pubkey,
          pop_challenge_hash: null,
          pop_prev_hash: null,
          pop_failures: 0,
          pop_last_ok_at: null,
          replaced_at: null,
          replaced_by_key_id: null,
        })
        .eq('id', keyRecord.id);
      if (pbError) logger.warn({ event: 'PANEL_BIND_PERSIST_FAILED', keyId: keyRecord.id, error: pbError.message });

      // The SAME device legitimately re-activating this key after an admin Reset lifts its kill.
      const { error: rbError } = await supabaseAdmin
        .from('revoked_device_bindings')
        .delete()
        .eq('activation_key_id', keyRecord.id)
        .eq('device_fingerprint', hardware_fingerprint);
      if (rbError) logger.warn({ event: 'PANEL_REVOKED_BINDING_CLEAR_FAILED', keyId: keyRecord.id, error: rbError.message });

      // Informational only (no kill): older panel keys this same panel activated before — e.g.
      // after an APK reinstall with a new key — are marked as replaced by this one.
      const { error: rpError } = await supabaseAdmin
        .from('activation_keys')
        .update({ replaced_at: activatedAt.toISOString(), replaced_by_key_id: keyRecord.id })
        .eq('device_fingerprint', hardware_fingerprint)
        .eq('device_class', DEVICE_CLASS_MANAGED_PANEL)
        .neq('id', keyRecord.id)
        .is('replaced_at', null);
      if (rpError) logger.warn({ event: 'PANEL_REPLACED_MARK_FAILED', keyId: keyRecord.id, error: rpError.message });

      console.log('[PANEL_ACTIVATED]', JSON.stringify({ tier: serverAttestationTier, model: requestModel, os: requestOS, ipAddress }));
    }

    // ── 3d-bis. Persist the canonical product identifier (best-effort) ─────
    // LMS_SCHOOL_ANDROID | LMS_SCHOOL_WINDOWS | LMS_LAB_ANDROID | LMS_LAB_WINDOWS | LMS_LAB_LINUX
    // — separate non-blocking update so a not-yet-migrated `product_id` column (run
    // product-identity-upgrade.sql) can never fail the activation. Only written when this
    // activation actually changes the pin (productMatch.pin set) — an already-pinned,
    // matching license is left untouched.
    if (productMatch.pin) {
      const { error: prError } = await supabaseAdmin
        .from('activation_keys')
        .update({ product_id: product })
        .eq('id', keyRecord.id);
      if (prError) {
        logger.warn({ event: 'PRODUCT_ID_PERSIST_FAILED', keyId: keyRecord.id, error: prError.message });
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

    // ── 4. Resolve the OWNING ENTITY (school | vendor | parent) ────────────
    // A key belongs to exactly one entity. resolveEntity fetches the right table and
    // returns (a) the entity-specific license fields (school info / generic vendor /
    // student), and (b) the content-class entitlement — full parity across entities.
    const entityRef = entityRefFromRow(keyRecord);
    const resolved = await resolveEntity(entityRef, { keyAcademicYear: keyRecord.academic_year });

    // ── 5. Construct licensing JWT payload ────────────────────────────────
    // Common fields + the entity-specific license portion. `entity_type` lets each
    // client app render the correct Information tab (school / vendor / student).
    const payload = {
      ...resolved.license,
      device_fingerprint: hardware_fingerprint,
      activation_date: activatedAt.toISOString(),
      expiration_date: expiresAt.toISOString(),
      features: ['video_playback', 'offline_tests'],
      // Managed classroom panel ONLY: a signed, device-bound claim the Android client uses to
      // tolerate the panel's system root binary at video-key release. Omitted for every other
      // device, so their signed payload is exactly what it was before.
      ...(managedPanel ? { device_class: DEVICE_CLASS_MANAGED_PANEL } : {}),
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
      productId: product,
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

    // Per-subject wrapped CEKs — only for the classes this ENTITY is entitled to
    // (school grade scope / vendor scope-or-all / parent grade). resolveEntity above
    // computed this with the same fail-closed rules for every entity type.
    const classIds = resolved.classIds;
    if (classIds.length === 0) {
      // Fail closed: the device activates but gets no content keys. Surface it so the
      // operator can fix an entity whose grade scope is blank/out-of-range.
      logger.warn({
        event: 'ACTIVATE_NO_ENTITLEMENT',
        ipAddress,
        entityType: resolved.entityType,
        entityName: resolved.entityName,
        schoolId: keyRecord.school_id ?? null,
        vendorId: keyRecord.vendor_id ?? null,
        parentId: keyRecord.parent_id ?? null,
      });
    }
    const wrappedCeks: Record<string, string> = {};
    // ── LMS School vs LMS Lab key scoping (additive, non-breaking) ────────────
    // LMS School content is class-scoped (class_N/Subject) and is sold to school, vendor AND
    // parent entities — they ALL need class keys. LMS Lab uses course_N scoping: every real
    // course PLUS the reserved future slots (src/lib/labCourses.ts), so a course added later
    // plays on devices activated today without re-activation.
    // Driven by the canonical product's family (src/lib/productIdentity.ts) — the same
    // value just validated by the product identity gate above — never by the WIN_* tier
    // (shared by School and Lab desktop builds, proves nothing about family).
    const useCourseScopes = isProductId(product) && familyFor(product) === 'lab';
    if (useCourseScopes) {
      for (const scopeId of labScopeIds()) {
        wrappedCeks[scopeId] = wrapOne(deriveScopePassphrase(masterCek, scopeId));
      }
    } else {
      for (const classId of classIds) {
        for (const subject of SUBJECTS) {
          const scopeId = `${classId}/${subject}`;
          wrappedCeks[scopeId] = wrapOne(deriveScopePassphrase(masterCek, scopeId));
        }
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
    const entitledToAll = isEntitledToAll(classIds);
    if (process.env.LMS_DISABLE_LEGACY_CEK !== 'true' && entitledToAll) {
      responseBody.wk0 = wrapOne(masterCek);   // F7: opaque wire name (client maps wk0 -> wrapped_cek)
    }

    // ── 10. Deferred Terms & Conditions consent (best-effort) ──────────────
    // A device whose /api/device/terms-accept was refused for attestation (an interactive panel
    // before it had a key) sends its consent with this activation. Recorded only now — after the
    // key, product and attestation gates above all passed — with the same row shape as
    // /api/device/terms-accept. Never fails the activation.
    if (terms_version) {
      const d = new Date(terms_accepted_at ?? '');
      const nowIso = new Date().toISOString();
      const { error: termsErr } = await supabaseAdmin.from('terms_acceptances').upsert({
        device_fingerprint: hardware_fingerprint,
        terms_version,
        accepted_at: Number.isNaN(d.getTime()) ? nowIso : d.toISOString(),
        device_model: requestModel,
        device_os: requestOS,
        ip_address: ipAddress,
        updated_at: nowIso,
      }, { onConflict: 'device_fingerprint' });
      if (termsErr) {
        logger.warn({ event: 'ACTIVATE_DEFERRED_TERMS_PERSIST_FAILED', error: termsErr.message });
      } else {
        // Consent audit (scripts/add_interactive_panel.sql): Privacy version + the SERVER's own
        // receipt time, which is authoritative (accepted_at above is the device clock).
        const { error: auditErr } = await supabaseAdmin
          .from('terms_acceptances')
          .update({ server_received_at: nowIso, ...(privacy_version ? { privacy_version } : {}) })
          .eq('device_fingerprint', hardware_fingerprint);
        if (auditErr) logger.warn({ event: 'ACTIVATE_DEFERRED_TERMS_AUDIT_FAILED', error: auditErr.message });
        if (product) {
          const { error: prodErr } = await supabaseAdmin
            .from('terms_acceptances')
            .update({ product_id: product })
            .eq('device_fingerprint', hardware_fingerprint);
          if (prodErr) logger.warn({ event: 'ACTIVATE_DEFERRED_TERMS_PRODUCT_FAILED', error: prodErr.message });
        }
      }
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
