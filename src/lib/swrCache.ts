// ============================================================================
// Small in-memory stale-while-revalidate cache with request coalescing, for expensive READ-ONLY
// results that many viewers ask for at the same time (e.g. the Operations Center overview).
//
//   age < freshMs            → return the cached value
//   freshMs ≤ age < maxMs    → return it, refresh once in the background
//   age ≥ maxMs / no value   → wait for a fresh computation
// Concurrent callers of the same key share ONE computation ("singleflight"). Errors are never
// cached. Callers must do their own permission checks BEFORE asking the cache, and must only
// share a key between viewers who are allowed to see exactly the same result.
// Same pattern as src/lib/sessionCache.ts.
// ============================================================================

import { after } from 'next/server';

type Entry<T> = { value: T; at: number };

function inBackground(task: () => Promise<unknown>) {
  try {
    after(task); // keeps the serverless function alive until the refresh finishes
  } catch {
    void task(); // outside a request scope (tests/scripts)
  }
}

export function swrCache<T>({ freshMs, maxMs, maxEntries = 200 }: { freshMs: number; maxMs: number; maxEntries?: number }) {
  const entries = new Map<string, Entry<T>>();
  const inFlight = new Map<string, Promise<T>>();
  // Bumped by invalidate(): a computation that started before it must not store its (older) result.
  const generation = new Map<string, number>();

  const compute = (key: string, fn: () => Promise<T>): Promise<T> => {
    const pending = inFlight.get(key);
    if (pending) return pending;
    const gen = generation.get(key) ?? 0;
    const run = fn()
      .then((value) => {
        if ((generation.get(key) ?? 0) === gen) {
          entries.delete(key); // re-insert so Map order = oldest first
          entries.set(key, { value, at: Date.now() });
          if (entries.size > maxEntries) entries.delete(entries.keys().next().value!);
        }
        return value;
      })
      .finally(() => { if (inFlight.get(key) === run) inFlight.delete(key); });
    inFlight.set(key, run);
    return run;
  };

  return {
    async get(key: string, fn: () => Promise<T>): Promise<T> {
      const hit = entries.get(key);
      const age = hit ? Date.now() - hit.at : Infinity;
      if (hit && age < maxMs) {
        if (age >= freshMs && !inFlight.has(key)) inBackground(() => compute(key, fn).catch(() => undefined));
        return hit.value;
      }
      return compute(key, fn);
    },
    /** Drop `key` (after a write): the next get() computes fresh, and a computation already running is not stored. */
    invalidate(key: string) {
      entries.delete(key);
      inFlight.delete(key);
      generation.set(key, (generation.get(key) ?? 0) + 1);
      if (generation.size > maxEntries) generation.delete(generation.keys().next().value!);
    },
    /** Test helper. */
    _reset() { entries.clear(); inFlight.clear(); generation.clear(); },
  };
}
