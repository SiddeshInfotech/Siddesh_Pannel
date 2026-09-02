import crypto from 'crypto';
import { logger } from '@/lib/logger';
import {
  parseAttestationExtension,
  SECURITY_LEVEL,
  KEY_ORIGIN,
} from '@/lib/attestationExtension';

// NC-1: server-side verification of the Android hardware key-attestation that the
// device sends at activation. This REPLACES the old HMAC request signature (whose
// shared secret was extractable from the APK). The device proves, via a Google-rooted
// certificate chain, that its CEK-wrap key lives in real TEE/StrongBox hardware and
// was created for THIS activation request — something no APK-extracted value can forge.
//
// Verification steps:
//   1. The attestation certificate chain validates link-by-link up to a PINNED Google
//      hardware-attestation root (operator supplies the root PEM(s) via env).
//   2. The leaf certificate's public key equals the device_wrap_pubkey we will wrap CEKs to.
//   3. The leaf certificate embeds our request-bound challenge
//      = SHA-256(activation_key | nonce | timestamp). Because the challenge is a unique,
//      high-entropy 32-byte value, a presence check inside the leaf DER is a reliable
//      proof the attestation was minted for this exact request (no fragile ASN.1 parse).

export interface AttestationInput {
  chainB64: string[];          // leaf → … → root, each cert DER base64
  deviceWrapPubkeyB64: string; // base64 SPKI (DER) of the device RSA key
  activationKey: string;
  nonce: string;
  timestamp: string;
}

export interface AttestationResult {
  ok: boolean;
  reason?: string;
  // Hardware security level parsed from the attestation extension, when the extension
  // was parseable (independent of LMS_ATTEST_STRICT — populated whenever available so
  // the caller can derive a server-authoritative tier for persistence/telemetry without
  // trusting the client's self-reported security_tier). See attestationPolicy.ts.
  securityLevel?: number;
}

/** Operator-pinned Google hardware-attestation root certificate(s), PEM, newline or
 *  "|" separated, from https://developer.android.com/.../security-key-attestation. */
function pinnedRoots(): crypto.X509Certificate[] {
  let raw = process.env.LMS_ATTEST_ROOT_CERTS;
  if (!raw) return [];
  // Accept the value whether pasted with real newlines OR with literal "\n" escapes
  // (common when storing multi-line PEM in an env var). Paste plain PEM — one or more
  // -----BEGIN CERTIFICATE----- blocks back-to-back. Any stray quotes/commas/brackets
  // (e.g. if a JSON array was pasted) are dropped so only the PEM lines remain.
  raw = raw.replace(/\\n/g, '\n');
  // Pull each -----BEGIN…END CERTIFICATE----- block out directly. Starting at BEGIN
  // and ending at END skips any surrounding JSON quotes/commas/brackets, and trimming
  // each line tolerates indentation — so plain PEM, "\n"-escaped, or a pasted JSON
  // array all yield clean PEM.
  const pems = (raw.match(/-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/g) || [])
    .map((m) => m.split('\n').map((line) => line.trim()).join('\n'));
  const out: crypto.X509Certificate[] = [];
  for (const pem of pems) {
    try {
      out.push(new crypto.X509Certificate(pem));
    } catch (e) {
      logger.warn({ event: 'ATTEST_ROOT_PARSE_FAILED', error: (e as Error).message });
    }
  }
  return out;
}

export function computeChallenge(activationKey: string, nonce: string, timestamp: string): Buffer {
  return crypto.createHash('sha256').update(`${activationKey}|${nonce}|${timestamp}`, 'utf8').digest();
}

export function verifyAttestation(input: AttestationInput): AttestationResult {
  const { chainB64, deviceWrapPubkeyB64, activationKey, nonce, timestamp } = input;

  if (!chainB64 || chainB64.length < 2) {
    return { ok: false, reason: 'attestation chain missing or too short' };
  }
  if (!deviceWrapPubkeyB64) {
    return { ok: false, reason: 'device_wrap_pubkey missing' };
  }

  // Parse the chain (leaf first).
  let certs: crypto.X509Certificate[];
  try {
    certs = chainB64.map((b64) => new crypto.X509Certificate(Buffer.from(b64, 'base64')));
  } catch (e) {
    return { ok: false, reason: `chain parse failed: ${(e as Error).message}` };
  }

  // 1. Verify each cert is signed by the next one up the chain.
  for (let i = 0; i < certs.length - 1; i++) {
    const child = certs[i];
    const issuer = certs[i + 1];
    if (!child.checkIssued(issuer) || !child.verify(issuer.publicKey)) {
      return { ok: false, reason: `chain link ${i} invalid` };
    }
  }

  // 2. Verify the chain terminates at a pinned Google attestation root.
  const roots = pinnedRoots();
  if (roots.length === 0) {
    return { ok: false, reason: 'no pinned attestation roots configured (LMS_ATTEST_ROOT_CERTS)' };
  }
  const top = certs[certs.length - 1];
  const topDer = top.raw;
  const trusted = roots.some((r) => {
    // Match either the exact root cert, or that the top chain cert is signed by the root.
    if (Buffer.compare(r.raw, topDer) === 0) return true;
    try {
      return top.checkIssued(r) && top.verify(r.publicKey);
    } catch {
      return false;
    }
  });
  if (!trusted) {
    return { ok: false, reason: 'chain does not terminate at a pinned Google root' };
  }

  // 3. Leaf public key must equal the device_wrap_pubkey we will wrap CEKs to.
  const leaf = certs[0];
  let leafSpki: Buffer;
  try {
    leafSpki = leaf.publicKey.export({ type: 'spki', format: 'der' }) as Buffer;
  } catch (e) {
    return { ok: false, reason: `leaf key export failed: ${(e as Error).message}` };
  }
  const claimedSpki = Buffer.from(deviceWrapPubkeyB64, 'base64');
  if (Buffer.compare(leafSpki, claimedSpki) !== 0) {
    return { ok: false, reason: 'leaf public key != device_wrap_pubkey' };
  }

  // 4. The leaf attestation must embed our request-bound challenge.
  //    BASELINE (always on): the 32-byte challenge must appear in the leaf DER.
  const challenge = computeChallenge(activationKey, nonce, timestamp);
  if (leaf.raw.indexOf(challenge) === -1) {
    return { ok: false, reason: 'attestation challenge mismatch (not bound to this request)' };
  }

  // 5. STRICT extras (gap #1/#3/#4) — gated behind LMS_ATTEST_STRICT so they roll
  //    out the same way as LMS_ENFORCE_ATTESTATION: with the flag OFF we only LOG
  //    what the parser found (so the operator can confirm real devices pass before
  //    enforcing); with it ON we additionally require:
  //      • every chain cert is within its validity window (#1),
  //      • the challenge sits in the real attestationChallenge field, not just
  //        anywhere in the DER (#3),
  //      • the attested key is hardware-backed (TEE/StrongBox) and not IMPORTED (#4).
  const strict = process.env.LMS_ATTEST_STRICT === 'true';
  const parsed = parseAttestationExtension(Buffer.from(leaf.raw));

  // #1 validity window (10-min clock-skew tolerance — a device that passes the
  //    ±2-min request-timestamp skew is always comfortably inside this).
  const SKEW = 10 * 60 * 1000;
  const nowMs = Date.now();
  let validityOk = true;
  let badCert = -1;
  for (let i = 0; i < certs.length; i++) {
    const nb = Date.parse(certs[i].validFrom);
    const na = Date.parse(certs[i].validTo);
    if (Number.isNaN(nb) || Number.isNaN(na) || nowMs < nb - SKEW || nowMs > na + SKEW) {
      validityOk = false; badCert = i; break;
    }
  }

  if (strict) {
    if (!validityOk) return { ok: false, reason: `chain cert ${badCert} outside validity window` };
    if (!parsed) return { ok: false, reason: 'attestation extension unparseable (strict)' };
    if (!parsed.challenge.equals(challenge)) {
      return { ok: false, reason: 'attestationChallenge field mismatch' };
    }
    if (parsed.securityLevel !== SECURITY_LEVEL.TEE && parsed.securityLevel !== SECURITY_LEVEL.STRONGBOX) {
      return { ok: false, reason: `attestation security level not hardware (${parsed.securityLevel})` };
    }
    // Hardening (SF-2): a genuine, freshly-provisioned attestation key is always
    // GENERATED in hardware. IMPORTED means the "attested" private key was handed to
    // the TEE from outside — i.e. an attacker who knows the private half — and a
    // present-but-unrecognized/UNKNOWN origin is exactly as untrustworthy as no origin
    // at all. Strict mode must fail closed on that ambiguity rather than defaulting to
    // accept, so anything other than a confirmed GENERATED/DERIVED (still HW-resident)
    // origin is rejected.
    if (
      parsed.origin === undefined ||
      parsed.origin === KEY_ORIGIN.IMPORTED ||
      parsed.origin === KEY_ORIGIN.UNKNOWN
    ) {
      return { ok: false, reason: `attested key origin not confirmed hardware-generated (origin=${parsed.origin ?? 'absent'})` };
    }
  } else {
    // Diagnostics only — confirm these all look right for your real fleet, THEN
    // set LMS_ATTEST_STRICT=true. Search Vercel logs for "ATTEST_EXT".
    logger.info({
      event: 'ATTEST_EXT',
      validityOk,
      parsed: parsed
        ? {
            challengeInField: parsed.challenge.equals(challenge),
            securityLevel: parsed.securityLevel,
            origin: parsed.origin ?? null,
          }
        : null,
    });
  }

  return { ok: true, securityLevel: parsed?.securityLevel };
}

/**
 * Gap #5 — optional check against Google's attestation key revocation status list.
 * OFF by default (LMS_ATTEST_CHECK_REVOCATION=true to enable). FAILS OPEN: a network
 * error or unreachable list never blocks activation — it only blocks a chain whose
 * serial is positively listed as revoked. Returns { revoked, reason }.
 */
const REVOCATION_URL = 'https://android.googleapis.com/attestation/status';
let revocationCache: { fetchedAt: number; entries: Record<string, { status?: string; reason?: string }> } | null = null;
const REVOCATION_TTL = 60 * 60 * 1000; // 1h

export async function checkRevocation(chainB64: string[]): Promise<{ revoked: boolean; reason?: string }> {
  if (process.env.LMS_ATTEST_CHECK_REVOCATION !== 'true') return { revoked: false };
  try {
    if (!revocationCache || Date.now() - revocationCache.fetchedAt > REVOCATION_TTL) {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 4000);
      const res = await fetch(REVOCATION_URL, { signal: ctrl.signal, cache: 'no-store' });
      clearTimeout(t);
      if (!res.ok) return { revoked: false }; // fail open
      const json = (await res.json()) as { entries?: Record<string, { status?: string; reason?: string }> };
      revocationCache = { fetchedAt: Date.now(), entries: json.entries ?? {} };
    }
    for (const b64 of chainB64) {
      let cert: crypto.X509Certificate;
      try {
        cert = new crypto.X509Certificate(Buffer.from(b64, 'base64'));
      } catch {
        continue;
      }
      // Google's published revocation list keys entries by BOTH a plain decimal serial
      // string AND a lowercase-hex serial (observed both forms in the live list) — the
      // previous code only ever tried one hex normalization and silently missed every
      // decimal-keyed entry. Probe every plausible encoding of this cert's serial;
      // trying extra candidates can only ever INCREASE detection, never cause a false
      // match (each candidate is a re-encoding of this cert's own serial, so a hit
      // means the map genuinely contains this cert — it cannot spuriously match a
      // different certificate's entry).
      const rawHex = cert.serialNumber || '0';
      const strippedHex = rawHex.toLowerCase().replace(/^0+/, '') || '0';
      let decimal = strippedHex;
      try {
        decimal = BigInt('0x' + rawHex).toString(10);
      } catch {
        /* non-numeric serial (shouldn't happen for a real cert) — decimal candidate skipped */
      }
      const candidates = new Set([strippedHex, decimal, rawHex.toLowerCase(), strippedHex.padStart(32, '0')]);
      for (const key of candidates) {
        const entry = revocationCache.entries[key];
        if (entry) {
          logger.warn({ event: 'ATTEST_CERT_REVOKED', serial: key, status: entry.status, reason: entry.reason });
          return {
            revoked: true,
            reason: `attestation cert revoked (${entry.status ?? 'listed'}${entry.reason ? `: ${entry.reason}` : ''})`,
          };
        }
      }
    }
    return { revoked: false };
  } catch {
    return { revoked: false }; // fail open on any error
  }
}
