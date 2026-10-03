import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Outside a request scope `after` throws; the cache then runs the re-check as a plain promise.
vi.mock('next/server', () => ({ after: () => { throw new Error('no request scope'); } }));

import {
  isSessionLiveCached, invalidateSession, _resetSessionCache, SOFT_TTL_MS, HARD_TTL_MS, type SessionChecker,
} from '../sessionCache';

const key = { panel: 'lab' as const, sid: 'sid-1', email: 'a@x.com' };
const liveFor = (ms: number): SessionChecker => vi.fn(async () => ({ live: true, expiresAt: Date.now() + ms }));
const flush = () => new Promise(r => setTimeout(r, 0));

beforeEach(() => { _resetSessionCache(); vi.useFakeTimers({ toFake: ['Date'] }); });
afterEach(() => vi.useRealTimers());

describe('session cache (stale-while-revalidate, fail closed)', () => {
  it('first request checks the DB; the next one within SOFT_TTL does not', async () => {
    const check = liveFor(3600_000);
    expect(await isSessionLiveCached(key, check)).toBe(true);
    expect(await isSessionLiveCached(key, check)).toBe(true);
    expect(check).toHaveBeenCalledTimes(1);
  });

  it('after SOFT_TTL it answers from cache and re-checks in the background', async () => {
    const check = liveFor(3600_000);
    await isSessionLiveCached(key, check);
    vi.setSystemTime(Date.now() + SOFT_TTL_MS + 1);
    expect(await isSessionLiveCached(key, check)).toBe(true);
    await flush();
    expect(check).toHaveBeenCalledTimes(2);
  });

  it('a background re-check that finds the session revoked denies the very next request', async () => {
    let revoked = false;
    const check: SessionChecker = vi.fn(async () => (revoked ? { live: false } : { live: true, expiresAt: Date.now() + 3600_000 }));
    await isSessionLiveCached(key, check);
    revoked = true;
    vi.setSystemTime(Date.now() + SOFT_TTL_MS + 1);
    await isSessionLiveCached(key, check); // served stale, re-check starts
    await flush();
    expect(await isSessionLiveCached(key, check)).toBe(false);
  });

  it('after HARD_TTL it waits for a fresh DB check (no stale answer)', async () => {
    let revoked = false;
    const check: SessionChecker = vi.fn(async () => (revoked ? { live: false } : { live: true, expiresAt: Date.now() + 3600_000 }));
    await isSessionLiveCached(key, check);
    revoked = true;
    vi.setSystemTime(Date.now() + HARD_TTL_MS + 1);
    expect(await isSessionLiveCached(key, check)).toBe(false);
  });

  it('never trusts the cache past the session expiry time', async () => {
    const check = liveFor(2_000); // session expires in 2s
    await isSessionLiveCached(key, check);
    vi.setSystemTime(Date.now() + 2_001);
    expect(await isSessionLiveCached(key, vi.fn(async () => ({ live: false })))).toBe(false);
  });

  it('logout invalidation refuses the session immediately, even if the cache said live', async () => {
    const check = liveFor(3600_000);
    await isSessionLiveCached(key, check);
    invalidateSession('lab', 'sid-1');
    expect(await isSessionLiveCached(key, check)).toBe(false);
    expect(check).toHaveBeenCalledTimes(1);
  });

  it('a DB error with nothing cached fails closed', async () => {
    expect(await isSessionLiveCached(key, vi.fn(async () => { throw new Error('db down'); }))).toBe(false);
  });

  it('a DB error does not extend trust: cached entry still ends at HARD_TTL', async () => {
    await isSessionLiveCached(key, liveFor(3600_000));
    const failing: SessionChecker = vi.fn(async () => { throw new Error('db down'); });
    vi.setSystemTime(Date.now() + SOFT_TTL_MS + 1);
    expect(await isSessionLiveCached(key, failing)).toBe(true); // within HARD_TTL
    await flush();
    vi.setSystemTime(Date.now() + HARD_TTL_MS);
    expect(await isSessionLiveCached(key, failing)).toBe(false);
  });

  it('the same session id with a different email is not served from cache', async () => {
    await isSessionLiveCached(key, liveFor(3600_000));
    const check = vi.fn(async () => ({ live: false }));
    expect(await isSessionLiveCached({ ...key, email: 'evil@x.com' }, check)).toBe(false);
    expect(check).toHaveBeenCalledTimes(1);
  });

  it('LMS and Lab sessions with the same id are cached separately', async () => {
    await isSessionLiveCached(key, liveFor(3600_000));
    const check = vi.fn(async () => ({ live: false }));
    expect(await isSessionLiveCached({ ...key, panel: 'lms' }, check)).toBe(false);
  });

  it('concurrent first requests share one DB check', async () => {
    const check = liveFor(3600_000);
    const results = await Promise.all([1, 2, 3].map(() => isSessionLiveCached(key, check)));
    expect(results).toEqual([true, true, true]);
    expect(check).toHaveBeenCalledTimes(1);
  });

  it('a "live" answer whose expiry is already past is treated as expired', async () => {
    const check = vi.fn(async () => ({ live: true, expiresAt: Date.now() - 1 }));
    expect(await isSessionLiveCached(key, check)).toBe(false);
  });
});
