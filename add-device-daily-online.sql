-- Per-day online-duration tracking, bucketed by IST calendar day.
--
-- device_status.total_online_seconds is a LIFETIME running total across every activation
-- of a device — it cannot answer "how long was this device online today" or "how long
-- since THIS licence key was activated" (a device re-activated with several keys over
-- time, e.g. during testing, has one shared lifetime total across all of them). This table
-- adds a per-day bucket, fed by /api/device/ping using the SAME inter-heartbeat gap credit
-- already used for total_online_seconds (see route.ts) — additive, best-effort, never
-- blocks a heartbeat if this table isn't migrated yet.
--
-- A key's own online time is then SUM(seconds) WHERE day >= that key's activation day,
-- and a per-day breakdown for the admin panel's device timeline is just the rows
-- themselves, filtered the same way and ordered by day.
CREATE TABLE IF NOT EXISTS device_daily_online (
  device_fingerprint TEXT NOT NULL,
  day DATE NOT NULL,
  seconds INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (device_fingerprint, day)
);

CREATE INDEX IF NOT EXISTS idx_device_daily_online_fp ON device_daily_online (device_fingerprint);
