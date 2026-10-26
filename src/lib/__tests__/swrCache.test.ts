import { beforeEach, describe, expect, it, vi } from 'vitest';

// Outside a request scope `after` throws; the cache then runs the refresh as a plain promise.
vi.mock('next/server', () => ({ after: () => { throw new Error('no request scope'); } }));

import { swrCache } from '../swrCache';

const flush = () => new Promise((r) => setTimeout(r, 0));
let cache: ReturnType<typeof swrCache<number>>;
beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); cache = swrCache<number>({ freshMs: 15_000, maxMs: 45_000 }); });

describe('stale-while-revalidate cache', () => {
  it('serves a fresh value without recomputing', async () => {
    const fn = vi.fn(async () => 1);
    expect(await cache.get('k', fn)).toBe(1);
    expect(await cache.get('k', fn)).toBe(1);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('serves a stale value and refreshes once in the background', async () => {
    let release!: (v: number) => void;
    const fn = vi.fn(async () => 1);
    await cache.get('k', fn);
    fn.mockImplementation(() => new Promise<number>((r) => { release = r; })); // refresh stays open
    vi.setSystemTime(Date.now() + 20_000);
    expect(await cache.get('k', fn)).toBe(1); // stale, answered at once
    expect(await cache.get('k', fn)).toBe(1); // refresh already running: not started twice
    expect(fn).toHaveBeenCalledTimes(2);
    release(2);
    await flush();
    expect(await cache.get('k', fn)).toBe(2);
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('waits for a fresh value once the entry is older than maxMs', async () => {
    let n = 0;
    const fn = vi.fn(async () => ++n);
    await cache.get('k', fn);
    vi.setSystemTime(Date.now() + 46_000);
    expect(await cache.get('k', fn)).toBe(2);
  });

  it('shares one computation between concurrent callers', async () => {
    let release!: (v: number) => void;
    const fn = vi.fn(() => new Promise<number>((r) => { release = r; }));
    const both = Promise.all([cache.get('k', fn), cache.get('k', fn)]);
    release(7);
    expect(await both).toEqual([7, 7]);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('never caches an error', async () => {
    await expect(cache.get('k', async () => { throw new Error('db down'); })).rejects.toThrow('db down');
    expect(await cache.get('k', async () => 3)).toBe(3);
  });

  it('invalidate() forces a fresh read, and a read that started before it is not stored', async () => {
    let release!: (v: number) => void;
    const fn = vi.fn(async () => 1);
    await cache.get('k', fn);
    cache.invalidate('k');
    fn.mockImplementation(() => new Promise<number>((r) => { release = r; }));
    const before = cache.get('k', fn); // started before the next write
    cache.invalidate('k'); // the write
    release(2);
    expect(await before).toBe(2);
    fn.mockImplementation(async () => 3);
    expect(await cache.get('k', fn)).toBe(3); // 2 was not cached
  });

  it('keeps keys apart (one viewer scope never answers another)', async () => {
    expect(await cache.get('lab|', async () => 1)).toBe(1);
    expect(await cache.get('lms|', async () => 2)).toBe(2);
    expect(await cache.get('lab|P1', async () => 3)).toBe(3);
  });
});
