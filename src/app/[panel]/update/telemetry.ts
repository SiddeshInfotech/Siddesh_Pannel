// Server-side helpers for the Update page (page.tsx) and its timeline action (actions.ts).
import { IST } from './shared';

export { humanDuration } from './shared';

export function agoFrom(iso: string | null): string {
  if (!iso) return 'never';
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 60_000) return 'just now';
  const m = Math.floor(diff / 60_000);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

/** "in 12d" / "in 5h" for a future instant, "3d ago" for a past one. */
export function relativeTo(iso: string): string {
  const diff = new Date(iso).getTime() - Date.now();
  if (diff <= 0) return agoFrom(iso);
  const h = Math.floor(diff / 3_600_000);
  if (h < 1) return 'in <1h';
  if (h < 24) return `in ${h}h`;
  return `in ${Math.floor(h / 24)}d`;
}

// IST calendar-day string (YYYY-MM-DD), matching device_daily_online.day and how the
// client groups timeline events by day — so a key's "activation day" and a duration row's
// "day" are always comparable as plain strings.
export function istDayKey(iso: string | number | Date): string {
  return new Date(iso).toLocaleDateString('en-CA', { timeZone: IST });
}

export function istDateTime(iso: string | null, withTime = true): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('en-IN', withTime
    ? { dateStyle: 'medium', timeStyle: 'short', timeZone: IST }
    : { dateStyle: 'medium', timeZone: IST });
}

// Supabase/PostgREST caps a single select at 1000 rows by default, silently. Every list this
// page shows is fleet-sized (all keys, all devices, all per-day online rows), so read them in
// pages until a short page comes back — otherwise rows past 1000 would just vanish.
const PAGE_SIZE = 1000;
type PageResult<T> = { data: T[] | null; error: { message: string } | null };

export async function fetchAllPages<T>(
  page: (from: number, to: number) => PromiseLike<PageResult<T>>,
  maxRows = 50_000
): Promise<{ data: T[]; error: { message: string } | null }> {
  const all: T[] = [];
  for (let from = 0; from < maxRows; from += PAGE_SIZE) {
    const { data, error } = await page(from, from + PAGE_SIZE - 1);
    if (error) return { data: all, error };
    all.push(...(data ?? []));
    if (!data || data.length < PAGE_SIZE) break;
  }
  return { data: all, error: null };
}

/** Splits a list for `.in(...)` filters so the request URL stays a sane length. */
export function chunk<T>(list: T[], size = 100): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}
