// ============================================================================
// Short-lived cache of the admin session DATABASE checks (admin allowlist + admin_sessions
// row), so clicking to a new page does not wait on Supabase round trips every time.
//
// What is NOT cached: the token's ES256 signature, issuer/audience, expiry, purpose and panel
// claim are verified on EVERY request (local crypto, ~no cost) before this cache is consulted.
//
// Stale-while-revalidate with hard limits:
//   age < SOFT_TTL                 → trust the cached "live" result
//   SOFT_TTL ≤ age < HARD_TTL      → trust it for this request, re-check the DB in the background
//   age ≥ HARD_TTL / session expiry → wait for a fresh DB check (fail closed)
// Only a positive ("live") result is ever cached. Once a check says revoked/expired/removed,
// the session is put on a deny list and every later request on this instance is refused
// immediately. Logout revokes on this instance at once; on other server instances revocation
// takes effect within HARD_TTL at the latest.
// ============================================================================

import { after } from 'next/server';

export const SOFT_TTL_MS = 10_000;
export const HARD_TTL_MS = 60_000;
const MAX_ENTRIES = 1000;
// A denied session can never come back (revocation is permanent; expiry only moves forward),
// so remembering it for the 8h token lifetime is safe.
const DENY_TTL_MS = 8 * 60 * 60 * 1000;

export type SessionKey = { panel: 'lms' | 'lab'; sid: string; email: string };
/** The real DB check: is this session live, and until when does the DB say it is valid? */
export type SessionChecker = (key: SessionKey) => Promise<{ live: boolean; expiresAt?: number }>;

type Entry = { email: string; checkedAt: number; sessionExpiresAt: number };

const live = new Map<string, Entry>();
const denied = new Map<string, number>(); // key → deny-until
const inFlight = new Map<string, Promise<boolean>>();

const keyOf = (k: SessionKey) => `${k.panel}:${k.sid}`;

function deny(key: string, now: number) {
  live.delete(key);
  denied.set(key, now + DENY_TTL_MS);
  if (denied.size > MAX_ENTRIES) denied.delete(denied.keys().next().value!);
}

function remember(key: string, email: string, now: number, expiresAt: number | undefined) {
  live.delete(key); // re-insert so Map order = least recently checked first
  live.set(key, { email, checkedAt: now, sessionExpiresAt: expiresAt ?? now + HARD_TTL_MS });
  if (live.size > MAX_ENTRIES) live.delete(live.keys().next().value!);
}

/** One DB check per session at a time; concurrent callers share it. Fails closed on error. */
function checkNow(k: SessionKey, check: SessionChecker): Promise<boolean> {
  const key = keyOf(k);
  const pending = inFlight.get(key);
  if (pending) return pending;

  const run = (async () => {
    try {
      const result = await check(k);
      const now = Date.now();
      if (result.live && (result.expiresAt === undefined || now < result.expiresAt)) {
        remember(key, k.email, now, result.expiresAt);
        return true;
      }
      deny(key, now);
      return false;
    } catch {
      // DB unreachable: do not extend trust. An existing entry keeps working only until its
      // HARD_TTL, after which callers wait for (and fail on) a fresh check.
      return false;
    } finally {
      inFlight.delete(key);
    }
  })();
  inFlight.set(key, run);
  return run;
}

function inBackground(task: () => Promise<unknown>) {
  try {
    after(task); // keeps the serverless function alive until the re-check finishes
  } catch {
    void task(); // outside a request scope (tests/scripts)
  }
}

/**
 * Is this (signature-verified) session still live? Uses the cache when it safely can.
 */
export async function isSessionLiveCached(k: SessionKey, check: SessionChecker): Promise<boolean> {
  const key = keyOf(k);
  const now = Date.now();

  const deniedUntil = denied.get(key);
  if (deniedUntil !== undefined) {
    if (now < deniedUntil) return false;
    denied.delete(key);
  }

  const entry = live.get(key);
  if (entry) {
    const hardUntil = Math.min(entry.checkedAt + HARD_TTL_MS, entry.sessionExpiresAt);
    if (entry.email !== k.email) {
      // Same session id presented with a different email: never trust the cache for it.
      live.delete(key);
    } else if (now < hardUntil) {
      if (now - entry.checkedAt >= SOFT_TTL_MS && !inFlight.has(key)) {
        inBackground(() => checkNow(k, check));
      }
      return true;
    } else {
      live.delete(key);
    }
  }

  return checkNow(k, check);
}

/** Drop a session from the cache and refuse it from now on (logout / revoke). */
export function invalidateSession(panel: 'lms' | 'lab', sid: string) {
  deny(`${panel}:${sid}`, Date.now());
}

/** Test helper. */
export function _resetSessionCache() {
  live.clear();
  denied.clear();
  inFlight.clear();
}
