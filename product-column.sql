-- ============================================================
-- LMS Siddesh Panel — per-record PRODUCT identifier
-- INSTRUCTIONS: Paste this entire file into:
--   Supabase Dashboard → SQL Editor → New Query → Run
--
-- PURPOSE: tag each device/product-originated row with WHICH product it came from:
--     lms_lab_android | lms_lab_windows | lms_lab_linux | lms_android | lms_windows
--   (an unclassifiable row is written as 'unknown'). The value is derived SERVER-SIDE
--   automatically from the signals each request already carries — os_platform +
--   security_tier + app_version + device_os — by src/lib/product.ts (detectProduct).
--   No client change is required.
--
-- SCOPE: only the 5 tables whose rows actually originate from a product/device. The
--   admin/business tables (admin_users, admin_sessions, schools, parents, vendors,
--   payments) and the admin-auth security_events table are intentionally NOT tagged —
--   a product identifier there would be meaningless.
--
-- AUTHORITATIVE SOURCE: device_status.product (set on every heartbeat, which carries
--   os_platform — the most precise signal). handshake_logs / terms_acceptances are set
--   at activation/consent time, where an original 'LMS android' cannot always be told
--   apart from 'LMS Lab Android' (both send Android Keystore tiers and no os_platform);
--   those rows fall back to 'lms_android' and are corrected on device_status by the ping.
--
-- SAFE: purely additive (ADD COLUMN IF NOT EXISTS), nullable, no default. Existing rows
--   stay NULL until the device is next seen; no existing column or logic changes. No hard
--   CHECK constraint so an unexpected value can never break a write.
-- ============================================================

ALTER TABLE device_status      ADD COLUMN IF NOT EXISTS product TEXT;
ALTER TABLE device_timeline    ADD COLUMN IF NOT EXISTS product TEXT;
ALTER TABLE handshake_logs     ADD COLUMN IF NOT EXISTS product TEXT;
ALTER TABLE terms_acceptances  ADD COLUMN IF NOT EXISTS product TEXT;
ALTER TABLE activation_keys    ADD COLUMN IF NOT EXISTS product TEXT;

-- Indexes for filtering / reporting by product (e.g. "all LMS Lab Windows devices").
CREATE INDEX IF NOT EXISTS idx_device_status_product     ON device_status (product);
CREATE INDEX IF NOT EXISTS idx_device_timeline_product   ON device_timeline (product);
CREATE INDEX IF NOT EXISTS idx_handshake_logs_product    ON handshake_logs (product);
CREATE INDEX IF NOT EXISTS idx_terms_acceptances_product ON terms_acceptances (product);
CREATE INDEX IF NOT EXISTS idx_activation_keys_product   ON activation_keys (product);

-- Optional: fleet breakdown by product.
-- SELECT product, COUNT(*) FROM device_status GROUP BY product ORDER BY 2 DESC;
