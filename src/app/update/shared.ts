// Types + constants shared by the Update page's server side (page.tsx, actions.ts) and its
// client UI (UpdateClient.tsx). Plain module — no server-only imports — so both can use it.

// Render all timestamps in India Standard Time (Vercel runs in UTC). India-only deployment.
export const IST = 'Asia/Kolkata';

// A device counts as "online now" if its last heartbeat is within this window
// (must be >= the app's heartbeat interval + /api/device/ping's SESSION_GAP_MS).
export const ONLINE_WINDOW_MS = 6 * 60 * 1000;

// Event types that represent a SECURITY concern (drive the alert count + row markers).
export const SECURITY_EVENT_TYPES = ['EXPIRY_TAMPER', 'CEK_DECRYPT_FAILED', 'ATTESTATION_ISSUE'] as const;

/**
 * Lifecycle state of a licence key (one per table row):
 *  - active        bound to a device, not expired, and the key that device is running now
 *  - expired       past its expires_at
 *  - superseded    was bound to a device, but a NEWER key has since been activated on that
 *                  same device, so this one is no longer in use there
 *  - revoked       deactivated by an admin
 *  - not_activated generated/paid but never activated on any device (or binding was reset)
 */
export type KeyState = 'active' | 'expired' | 'superseded' | 'revoked' | 'not_activated';

/** Heartbeat connectivity of the key's device. `na` = not applicable (no device, or the
 *  device now runs a different key, so its heartbeat says nothing about THIS key). */
export type Connection = 'online' | 'offline' | 'never' | 'na';

export function humanDuration(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

export type DailyOnline = { day: string; totalOnline: string };

export type Device = {
  id: string;
  fingerprint: string | null;
  activationKey: string;
  keyState: KeyState;
  connection: Connection;
  activatedAtIso: string | null;
  activatedExact: string;
  supersededAtIso: string | null;
  expiresAtIso: string | null;
  expiresExact: string;
  expiresRelative: string;
  schoolName: string;
  schoolId: string;
  appVersion: string;
  lastSeenAgo: string;
  lastSeenExact: string;
  totalOnline: string;
  dailyBreakdown: DailyOnline[];
  securityTier: string;
  productId: string | null;
};

export type Ev = {
  id: string;
  type: string;
  fingerprint: string;
  detail: Record<string, unknown>;
  createdAt: string | null;
};
