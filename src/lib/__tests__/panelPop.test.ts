import { describe, it, expect } from 'vitest';
import crypto from 'crypto';
import {
  POP_PREFIX,
  POP_ALERT_AFTER,
  POP_KILL_AFTER,
  POP_KILL_MIN_SILENCE_MS,
  createPopChallenge,
  popResponseFor,
  evaluatePop,
  nextPopVerdict,
} from '@/lib/panelPop';
import { isPanelActivationWindowClosed, DEVICE_CLASS_MANAGED_PANEL } from '@/lib/deviceClass';

// A real RSA-2048 key pair standing in for the panel's Android-Keystore wrap key, and the SAME
// RSA-OAEP-SHA1 decrypt the app performs (KeystoreCrypto: OAEP SHA-1 / MGF1 SHA-1).
const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const PUB_SPKI_B64 = publicKey.export({ type: 'spki', format: 'der' }).toString('base64');
const other = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });

function deviceAnswer(challengeB64: string, key: crypto.KeyObject = privateKey): string | null {
  const plain = crypto
    .privateDecrypt({ key, padding: crypto.constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha1' }, Buffer.from(challengeB64, 'base64'))
    .toString('utf8');
  // The app refuses anything that isn't a PoP challenge (never a generic decryption oracle).
  if (!plain.startsWith(POP_PREFIX)) return null;
  return popResponseFor(plain);
}

describe('panelPop — proof of possession of the enrolled device key', () => {
  it('the enrolled device can answer; the answer verifies', () => {
    const c = createPopChallenge(PUB_SPKI_B64)!;
    expect(c).not.toBeNull();
    const answer = deviceAnswer(c.challengeB64);
    expect(answer).toMatch(/^[0-9a-f]{64}$/);
    expect(evaluatePop(c.expectedHash, null, answer)).toBe('ok');
  });

  it('a device holding a DIFFERENT key cannot decrypt the challenge', () => {
    const c = createPopChallenge(PUB_SPKI_B64)!;
    expect(() => deviceAnswer(c.challengeB64, other.privateKey)).toThrow();
  });

  it('each challenge is fresh (no reuse of an old answer)', () => {
    const a = createPopChallenge(PUB_SPKI_B64)!;
    const b = createPopChallenge(PUB_SPKI_B64)!;
    expect(a.expectedHash).not.toBe(b.expectedHash);
    expect(evaluatePop(b.expectedHash, null, deviceAnswer(a.challengeB64))).toBe('mismatch');
  });

  it('accepts the answer to the PREVIOUS challenge (one lost ping reply is not a failure)', () => {
    const prev = createPopChallenge(PUB_SPKI_B64)!;
    const cur = createPopChallenge(PUB_SPKI_B64)!;
    expect(evaluatePop(cur.expectedHash, prev.expectedHash, deviceAnswer(prev.challengeB64))).toBe('ok');
  });

  it('classifies missing / malformed / no outstanding challenge', () => {
    const c = createPopChallenge(PUB_SPKI_B64)!;
    expect(evaluatePop(c.expectedHash, null, undefined)).toBe('missing');
    expect(evaluatePop(c.expectedHash, null, 'not-hex')).toBe('mismatch');
    expect(evaluatePop(null, null, 'a'.repeat(64))).toBe('none_outstanding');
  });

  it('an unparseable device key yields no challenge (feature simply off for that key)', () => {
    expect(createPopChallenge('not-a-key')).toBeNull();
  });
});

describe('panelPop — failure policy', () => {
  const now = Date.UTC(2026, 8, 12, 12, 0, 0);
  const longAgo = now - POP_KILL_MIN_SILENCE_MS - 1;

  it('a correct answer resets failures', () => {
    expect(nextPopVerdict(7, 'ok', null, null, now)).toEqual({ failures: 0, alert: false, kill: false });
  });

  it('no outstanding challenge changes nothing', () => {
    expect(nextPopVerdict(2, 'none_outstanding', null, null, now)).toEqual({ failures: 2, alert: false, kill: false });
  });

  it('a WRONG answer alerts immediately', () => {
    expect(nextPopVerdict(0, 'mismatch', now, now, now).alert).toBe(true);
  });

  it(`missing answers alert at ${POP_ALERT_AFTER} in a row`, () => {
    expect(nextPopVerdict(POP_ALERT_AFTER - 2, 'missing', now, now, now).alert).toBe(false);
    expect(nextPopVerdict(POP_ALERT_AFTER - 1, 'missing', now, now, now).alert).toBe(true);
  });

  it(`kills only after ${POP_KILL_AFTER} failures AND a day without a correct answer`, () => {
    // Enough failures but a recent correct answer → no kill (transient glitch on a real panel).
    expect(nextPopVerdict(POP_KILL_AFTER - 1, 'missing', now - 60_000, longAgo, now).kill).toBe(false);
    // Recently activated, never answered yet → no kill.
    expect(nextPopVerdict(POP_KILL_AFTER - 1, 'missing', null, now - 60_000, now).kill).toBe(false);
    // Enough failures and silent for over a day → kill.
    expect(nextPopVerdict(POP_KILL_AFTER - 1, 'missing', longAgo, longAgo, now).kill).toBe(true);
    // Not enough failures yet → no kill.
    expect(nextPopVerdict(POP_KILL_AFTER - 2, 'missing', longAgo, longAgo, now).kill).toBe(false);
  });
});

describe('deviceClass — panel activation window', () => {
  const now = new Date('2026-09-12T12:00:00Z');
  it('an unused panel key past its window is closed', () => {
    expect(isPanelActivationWindowClosed(
      { device_class: DEVICE_CLASS_MANAGED_PANEL, enrollment_expires_at: '2026-09-11T00:00:00Z', device_fingerprint: null }, now,
    )).toBe(true);
  });
  it('inside the window, already-bound keys, Standard keys and keys without a window are not affected', () => {
    expect(isPanelActivationWindowClosed(
      { device_class: DEVICE_CLASS_MANAGED_PANEL, enrollment_expires_at: '2026-09-20T00:00:00Z', device_fingerprint: null }, now,
    )).toBe(false);
    expect(isPanelActivationWindowClosed(
      { device_class: DEVICE_CLASS_MANAGED_PANEL, enrollment_expires_at: '2026-09-11T00:00:00Z', device_fingerprint: 'LMS-FP-X' }, now,
    )).toBe(false);
    expect(isPanelActivationWindowClosed(
      { device_class: null, enrollment_expires_at: '2026-09-11T00:00:00Z', device_fingerprint: null }, now,
    )).toBe(false);
    expect(isPanelActivationWindowClosed(
      { device_class: DEVICE_CLASS_MANAGED_PANEL, enrollment_expires_at: null, device_fingerprint: null }, now,
    )).toBe(false);
  });
});
