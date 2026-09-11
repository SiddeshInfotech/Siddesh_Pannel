'use server';

import { getAdminSession } from '@/lib/auth';
import { supabaseAdmin } from '@/lib/supabase';
import { logger } from '@/lib/logger';
import { ok, fail, GENERIC_ERROR, type ActionResult } from '@/lib/actionResult';
import { ONLINE_WINDOW_MS, type Ev } from './shared';
import { fetchAllPages } from './telemetry';

/* eslint-disable @typescript-eslint/no-explicit-any -- Supabase rows */

const MAX_EVENTS = 5000;

/**
 * Full activity timeline for ONE licence key, newest first — loaded when its row is opened.
 *
 * device_timeline is recorded per physical device (device_fingerprint), and one device can run
 * several keys over its life, so this returns only events inside THIS key's own window: from
 * its activation until the next key was activated on the same device (if any). The key's
 * window is re-derived here from the database — never trusted from the browser.
 *
 * Besides stored events it adds the key's lifecycle milestones, which have no timeline rows
 * of their own: activated, replaced by a newer key, expired — and, for a device that is
 * offline RIGHT NOW, the "Went offline" point at its last heartbeat (the stored OFFLINE row for
 * that session is only written when the device next comes back online).
 */
export async function getKeyTimeline(keyId: string): Promise<ActionResult<Ev[]>> {
  const session = await getAdminSession();
  if (!session) return fail('Unauthorized. Please sign in again.');
  if (typeof keyId !== 'string' || keyId.length === 0) return fail(GENERIC_ERROR);

  try {
    const { data: key, error: keyErr } = await supabaseAdmin
      .from('activation_keys')
      .select('id, key, device_fingerprint, activated_at, expires_at')
      .eq('id', keyId)
      .maybeSingle();
    if (keyErr) {
      logger.error({ event: 'KEY_TIMELINE_KEY_LOOKUP_ERROR', keyId, error: keyErr.message });
      return fail(GENERIC_ERROR);
    }
    if (!key) return fail('This key no longer exists.');
    const fp: string | null = key.device_fingerprint || null;
    if (!fp || !key.activated_at) return ok([]); // never activated — nothing to show

    const activatedMs = new Date(key.activated_at).getTime();

    // When the NEXT key was activated on this same device — this key's window ends there.
    const { data: next } = await supabaseAdmin
      .from('activation_keys')
      .select('activated_at')
      .eq('device_fingerprint', fp)
      .gt('activated_at', key.activated_at)
      .order('activated_at', { ascending: true })
      .limit(1);
    const supersededAt: string | null = next?.[0]?.activated_at ?? null;

    const { data: rows, error: evErr } = await fetchAllPages<any>((from, to) => {
      let q = supabaseAdmin
        .from('device_timeline')
        .select('id, event_type, detail, created_at, device_fingerprint')
        .eq('device_fingerprint', fp)
        .gte('created_at', key.activated_at);
      if (supersededAt) q = q.lt('created_at', supersededAt);
      return q.order('created_at', { ascending: false }).range(from, to);
    }, MAX_EVENTS);
    if (evErr) {
      logger.error({ event: 'KEY_TIMELINE_EVENTS_ERROR', keyId, error: evErr.message });
      return fail(GENERIC_ERROR);
    }

    const events: Ev[] = rows.map((e) => ({
      id: String(e.id),
      type: e.event_type,
      fingerprint: e.device_fingerprint,
      detail: e.detail ?? {},
      createdAt: e.created_at ?? null,
    }));
    const milestone = (suffix: string, type: string, at: string, detail: Record<string, unknown> = {}) =>
      events.push({ id: `${key.id}:${suffix}`, type, fingerprint: fp, detail, createdAt: at });

    milestone('activated', 'KEY_ACTIVATED', key.activated_at);
    if (supersededAt) milestone('superseded', 'KEY_SUPERSEDED', supersededAt);
    if (key.expires_at) {
      const expMs = new Date(key.expires_at).getTime();
      const inWindow = expMs >= activatedMs && (!supersededAt || expMs < new Date(supersededAt).getTime());
      if (expMs <= Date.now() && inWindow) milestone('expired', 'KEY_EXPIRED', key.expires_at);
    }

    // Still this device's key and the device is offline now: mark where the current
    // session ended (its last heartbeat) and how long that session lasted.
    if (!supersededAt) {
      const { data: ds } = await supabaseAdmin
        .from('device_status')
        .select('activation_key, last_seen, session_start')
        .eq('device_fingerprint', fp)
        .maybeSingle();
      const isLive = !ds?.activation_key || ds.activation_key === key.key;
      const lastSeenMs = ds?.last_seen ? new Date(ds.last_seen).getTime() : null;
      if (isLive && lastSeenMs !== null && lastSeenMs >= activatedMs && Date.now() - lastSeenMs > ONLINE_WINDOW_MS) {
        const startMs = ds?.session_start ? new Date(ds.session_start).getTime() : lastSeenMs;
        milestone('offline-now', 'OFFLINE', ds!.last_seen, {
          duration_seconds: Math.max(0, Math.round((lastSeenMs - startMs) / 1000)),
          ongoing: true,
        });
      }
    }

    events.sort((a, b) => (b.createdAt ? new Date(b.createdAt).getTime() : 0) - (a.createdAt ? new Date(a.createdAt).getTime() : 0));
    return ok(events);
  } catch (err: unknown) {
    logger.error({ event: 'KEY_TIMELINE_CRITICAL_ERROR', keyId }, err);
    return fail(GENERIC_ERROR);
  }
}
