import crypto from 'crypto';
import { wrapToPublicKey } from '@/lib/deviceWrap';

// ============================================================================
// Managed-panel PROOF OF POSSESSION (rolling, piggy-backed on /api/device/ping).
//
// An interactive panel has no Google hardware attestation, so after activation the server
// keeps re-checking that the device pinging is the one holding the non-exportable Keystore key
// it was activated with (activation_keys.device_wrap_pubkey). The Android key is RSA
// DECRYPT-only, so the proof is "decrypt this":
//
//   server → device : challenge = RSA-OAEP-SHA1(enrolled pubkey, "lms-pop:v1:" + 32 random bytes)
//   device → server : next ping carries hex SHA-256(decrypted plaintext)
//
// The server stores only hashes (current + previous, so a lost ping response doesn't count as a
// failure). The device refuses to answer anything that doesn't start with POP_PREFIX, so it can
// never be used as a generic decryption oracle (wrapped CEKs never carry the prefix).
// ============================================================================

export const POP_PREFIX = 'lms-pop:v1:';
/** Consecutive failures that raise a security alert. */
export const POP_ALERT_AFTER = 3;
/** Consecutive failures that revoke the licence (remote kill)… */
export const POP_KILL_AFTER = 10;
/** …and only if no correct answer was seen for at least this long, so a genuine panel with a
 *  transient Keystore / network problem is never wiped for a short burst of failures. */
export const POP_KILL_MIN_SILENCE_MS = 24 * 60 * 60 * 1000;

export interface PopChallenge {
  /** base64 RSA-OAEP ciphertext sent to the device. */
  challengeB64: string;
  /** hex SHA-256 of the plaintext — the only thing the server stores. */
  expectedHash: string;
}

/** What the device must send back for a decrypted challenge plaintext. */
export function popResponseFor(plaintext: string): string {
  return crypto.createHash('sha256').update(plaintext, 'utf8').digest('hex');
}

export function createPopChallenge(devicePubkeySpkiB64: string): PopChallenge | null {
  const plaintext = POP_PREFIX + crypto.randomBytes(32).toString('base64');
  const challengeB64 = wrapToPublicKey(plaintext, devicePubkeySpkiB64, 'sha1');
  if (!challengeB64) return null;
  return { challengeB64, expectedHash: popResponseFor(plaintext) };
}

function hexEquals(expectedHex: string, responseHex: string): boolean {
  if (!/^[0-9a-f]{64}$/.test(expectedHex) || !/^[0-9a-f]{64}$/.test(responseHex)) return false;
  return crypto.timingSafeEqual(Buffer.from(expectedHex, 'hex'), Buffer.from(responseHex, 'hex'));
}

export type PopOutcome = 'ok' | 'missing' | 'mismatch' | 'none_outstanding';

/** Evaluate a ping's pop_response against the outstanding challenge(s). */
export function evaluatePop(
  currentHash: string | null | undefined,
  previousHash: string | null | undefined,
  response: string | null | undefined,
): PopOutcome {
  if (!currentHash && !previousHash) return 'none_outstanding';
  if (!response) return 'missing';
  const r = response.trim().toLowerCase();
  if ((currentHash && hexEquals(currentHash, r)) || (previousHash && hexEquals(previousHash, r))) return 'ok';
  return 'mismatch';
}

export interface PopVerdict {
  failures: number;
  /** Raise a security alert on this ping. */
  alert: boolean;
  /** Revoke the licence (remote kill) on this ping. */
  kill: boolean;
}

/**
 * @param lastOkAtMs epoch ms of the last correct answer (null = never since activation).
 * @param activatedAtMs epoch ms of activation — the silence window also counts from here, so a
 *        panel that never answered is judged from the moment it was activated.
 */
export function nextPopVerdict(
  previousFailures: number,
  outcome: PopOutcome,
  lastOkAtMs: number | null = null,
  activatedAtMs: number | null = null,
  nowMs: number = Date.now(),
): PopVerdict {
  const prev = Number.isFinite(previousFailures) && previousFailures > 0 ? previousFailures : 0;
  if (outcome === 'ok') return { failures: 0, alert: false, kill: false };
  if (outcome === 'none_outstanding') return { failures: prev, alert: false, kill: false };
  const failures = prev + 1;
  const since = lastOkAtMs ?? activatedAtMs;
  const silentLongEnough = since === null || nowMs - since >= POP_KILL_MIN_SILENCE_MS;
  return {
    failures,
    // A WRONG answer is a strong clone/tamper signal → alert immediately; a missing one only
    // after a few in a row (app restarts / flaky networks).
    alert: outcome === 'mismatch' || failures === POP_ALERT_AFTER,
    kill: failures >= POP_KILL_AFTER && silentLongEnough,
  };
}
