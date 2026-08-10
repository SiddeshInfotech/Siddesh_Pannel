-- ============================================================
-- LMS Siddesh Panel — LMS Lab per-platform online tracking
-- INSTRUCTIONS: Paste this entire file into:
--   Supabase Dashboard → SQL Editor → New Query → Run
--
-- PURPOSE: The "LMS Lab" desktop/mobile app (ThinkSphere360) runs on THREE
--   platforms. Per requirement, each platform gets its OWN new column so LMS Lab
--   online telemetry is tracked separately and NO existing device_status column is
--   changed. Each column stores the last time an LMS Lab device of that platform
--   was seen online (set by /api/device/ping from the `os_platform` field).
--
-- SAFE: purely additive (ADD COLUMN IF NOT EXISTS). Backward compatible — older
--   app builds that don't send `os_platform` simply leave these columns NULL.
-- ============================================================

ALTER TABLE device_status ADD COLUMN IF NOT EXISTS lms_lab_windows_last_seen TIMESTAMPTZ;
ALTER TABLE device_status ADD COLUMN IF NOT EXISTS lms_lab_linux_last_seen   TIMESTAMPTZ;
ALTER TABLE device_status ADD COLUMN IF NOT EXISTS lms_lab_android_last_seen TIMESTAMPTZ;

-- Optional: quick way to see the newest online device per LMS Lab platform.
-- SELECT
--   MAX(lms_lab_windows_last_seen) AS windows_last_online,
--   MAX(lms_lab_linux_last_seen)   AS linux_last_online,
--   MAX(lms_lab_android_last_seen) AS android_last_online
-- FROM device_status;
