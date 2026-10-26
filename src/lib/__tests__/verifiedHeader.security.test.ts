import { beforeAll, describe, expect, it } from 'vitest';

const session = { sid: 'sid-1', email: 'a@x.com', panel: 'lab' as const };
let signVerified: typeof import('../verifiedHeader').signVerified;
let isVerifiedFor: typeof import('../verifiedHeader').isVerifiedFor;
let MAX_AGE_MS: number;

beforeAll(async () => {
  process.env.ADMIN_JWT_PRIVATE_KEY = 'test-signing-key-pem';
  ({ signVerified, isVerifiedFor, MAX_AGE_MS } = await import('../verifiedHeader'));
});

describe('signed "already verified" header', () => {
  it('accepts a fresh header for exactly this session', () => {
    expect(isVerifiedFor(signVerified(session), session)).toBe(true);
  });

  it('refuses a header for another session, email or panel', () => {
    const v = signVerified(session);
    expect(isVerifiedFor(v, { ...session, sid: 'sid-2' })).toBe(false);
    expect(isVerifiedFor(v, { ...session, email: 'b@x.com' })).toBe(false);
    expect(isVerifiedFor(v, { ...session, panel: 'lms' })).toBe(false);
  });

  it('refuses an expired header, and one dated too far in the future', () => {
    const now = Date.now();
    expect(isVerifiedFor(signVerified(session, now - MAX_AGE_MS - 1), session, now)).toBe(false);
    expect(isVerifiedFor(signVerified(session, now + 5_000), session, now)).toBe(false);
  });

  it('refuses forged, tampered or malformed values', () => {
    const [body, sig] = signVerified(session).split('.');
    const forgedBody = Buffer.from(JSON.stringify({ ...session, sid: 'sid-2', at: Date.now() })).toString('base64url');
    expect(isVerifiedFor(`${forgedBody}.${sig}`, { ...session, sid: 'sid-2' })).toBe(false); // body swapped
    expect(isVerifiedFor(`${body}.${sig.slice(0, -2)}xx`, session)).toBe(false); // signature changed
    expect(isVerifiedFor(`${body}.${sig}.extra`, session)).toBe(false);
    for (const bad of [null, undefined, '', 'nope', '.', `${body}.`, 'x'.repeat(2000)]) expect(isVerifiedFor(bad, session)).toBe(false);
  });

  it('a header signed with another key is refused', async () => {
    const theirs = signVerified(session);
    process.env.ADMIN_JWT_PRIVATE_KEY = 'some-other-key';
    const { vi } = await import('vitest');
    vi.resetModules();
    const other = await import('../verifiedHeader');
    expect(other.isVerifiedFor(theirs, session)).toBe(false);
    expect(other.isVerifiedFor(other.signVerified(session), session)).toBe(true);
  });
});
