-- ============================================================
-- LMS Siddesh Panel — CANONICAL PRODUCT IDENTITY upgrade
-- INSTRUCTIONS: Paste this entire file into:
--   Supabase Dashboard → SQL Editor → New Query → Run
--
-- PURPOSE: introduces the canonical, stable `product_id` column (values:
--   LMS_SCHOOL_ANDROID | LMS_SCHOOL_WINDOWS | LMS_LAB_ANDROID | LMS_LAB_WINDOWS |
--   LMS_LAB_LINUX — see src/lib/productIdentity.ts) alongside the existing lowercase
--   `product` column (src/lib/product.ts, product-column.sql). `product_id` is the
--   field Key Generation now sets explicitly and the activation/ping gate enforces;
--   `product` is left in place, untouched, for any code path not yet migrated.
--
-- WHY NOT JUST RENAME `product`'S VALUES IN PLACE: the historical `product =
-- 'lms_lab_windows'` value is PROVABLY WRONG for every LMS School Windows device
-- activated before this fix (see src/lib/product.ts's ROOT-CAUSE FIX comment) —
-- School and Lab Windows shared the exact same detection bug. Blindly copying
-- 'lms_lab_windows' -> 'LMS_LAB_WINDOWS' would permanently lock already-activated
-- School Windows testers into the wrong product, and the new activation/ping match
-- gate would then REJECT their own legitimate app. So:
--   • Android and Lab-Linux legacy values were never ambiguous — safe to backfill directly.
--   • Windows legacy values (`lms_windows` / `lms_lab_windows`) are NOT backfilled at all.
--     Those rows are left with product_id = NULL and self-heal to the correct value on
--     the device's next activation or heartbeat (see checkProductMatch in src/lib/product.ts),
--     matching this project's existing "self-heal instead of Blocked/Expired" design.
--
-- SAFE: purely additive (ADD COLUMN IF NOT EXISTS), nullable, no default, no destructive
-- migration. Existing `product`/`platform`/`security_tier` columns are untouched.
-- ============================================================

ALTER TABLE activation_keys   ADD COLUMN IF NOT EXISTS product_id TEXT;
ALTER TABLE device_status     ADD COLUMN IF NOT EXISTS product_id TEXT;
ALTER TABLE device_timeline   ADD COLUMN IF NOT EXISTS product_id TEXT;
ALTER TABLE handshake_logs    ADD COLUMN IF NOT EXISTS product_id TEXT;
ALTER TABLE terms_acceptances ADD COLUMN IF NOT EXISTS product_id TEXT;

-- Safe backfill: Android and Lab-Linux legacy values were never ambiguous (Lab Android/
-- Linux both send an unambiguous marker; original Android has no competing product on
-- that OS). Windows ('lms_windows' / 'lms_lab_windows') is deliberately excluded — see
-- above — and stays NULL to self-heal.
UPDATE activation_keys SET product_id = CASE product
  WHEN 'lms_android'      THEN 'LMS_SCHOOL_ANDROID'
  WHEN 'lms_lab_android'  THEN 'LMS_LAB_ANDROID'
  WHEN 'lms_lab_linux'    THEN 'LMS_LAB_LINUX'
  ELSE NULL
END
WHERE product_id IS NULL AND product IS NOT NULL;

UPDATE device_status SET product_id = CASE product
  WHEN 'lms_android'      THEN 'LMS_SCHOOL_ANDROID'
  WHEN 'lms_lab_android'  THEN 'LMS_LAB_ANDROID'
  WHEN 'lms_lab_linux'    THEN 'LMS_LAB_LINUX'
  ELSE NULL
END
WHERE product_id IS NULL AND product IS NOT NULL;

UPDATE handshake_logs SET product_id = CASE product
  WHEN 'lms_android'      THEN 'LMS_SCHOOL_ANDROID'
  WHEN 'lms_lab_android'  THEN 'LMS_LAB_ANDROID'
  WHEN 'lms_lab_linux'    THEN 'LMS_LAB_LINUX'
  ELSE NULL
END
WHERE product_id IS NULL AND product IS NOT NULL;

UPDATE terms_acceptances SET product_id = CASE product
  WHEN 'lms_android'      THEN 'LMS_SCHOOL_ANDROID'
  WHEN 'lms_lab_android'  THEN 'LMS_LAB_ANDROID'
  WHEN 'lms_lab_linux'    THEN 'LMS_LAB_LINUX'
  ELSE NULL
END
WHERE product_id IS NULL AND product IS NOT NULL;

-- device_timeline has no long-lived "product" concept to backfill from (it's an
-- append-only event log) — new rows get product_id going forward; old rows stay NULL.

CREATE INDEX IF NOT EXISTS idx_activation_keys_product_id   ON activation_keys (product_id);
CREATE INDEX IF NOT EXISTS idx_device_status_product_id     ON device_status (product_id);
CREATE INDEX IF NOT EXISTS idx_device_timeline_product_id   ON device_timeline (product_id);
CREATE INDEX IF NOT EXISTS idx_handshake_logs_product_id    ON handshake_logs (product_id);
CREATE INDEX IF NOT EXISTS idx_terms_acceptances_product_id ON terms_acceptances (product_id);

-- Optional: sanity check after running — should show 0 School Windows devices still
-- unresolved once your fleet has heartbeated at least once post-deploy:
-- SELECT count(*) FROM device_status WHERE product_id IS NULL AND security_tier LIKE 'WIN_%';
