-- ============================================================
-- LMS Siddesh Panel — PRODUCT REGISTRY (School vs Lab × platform)
-- INSTRUCTIONS: Paste this entire file into:
--   Supabase Dashboard → SQL Editor → New Query → Run
--
-- PURPOSE: a canonical reference table naming every shipped build so School vs Lab
--   is explicit on EVERY platform — mirroring how Android is separated by the
--   '-lab-android' app_version marker. Detection lives in src/lib/product.ts
--   (detectProduct); this table is the human-readable registry those `product`
--   values map to, and a place to JOIN for fleet reporting.
--
--   Family     Platform   product            app_version marker   other signal
--   ─────────  ─────────  ─────────────────  ───────────────────  ──────────────────
--   Lab        Android    lms_lab_android    1.0.0-lab-android    Android Keystore tier
--   Lab        Windows    lms_lab_windows    1.0.0-lab-win        WIN_* security tier
--   Lab        Linux      lms_lab_linux      1.0.0-lab-linux      os_platform=linux (ping)
--   School     Android    lms_android        (none)               Android Keystore tier
--   School     Windows    lms_windows        (none)               device_os=Windows
--   School     Linux      lms_linux          (none)               device_os=Linux
--
-- SAFE: purely additive. CREATE TABLE IF NOT EXISTS + idempotent upserts; no existing
--   table or column is touched.
-- ============================================================

CREATE TABLE IF NOT EXISTS product_registry (
  product           TEXT PRIMARY KEY,                       -- matches detectProduct() output
  family            TEXT NOT NULL CHECK (family IN ('school', 'lab')),
  platform          TEXT NOT NULL CHECK (platform IN ('android', 'windows', 'linux')),
  app_version_marker TEXT,                                  -- version substring that identifies it ('' = none)
  security_tier_hint TEXT,                                  -- extra distinguishing signal, if any
  display_name      TEXT NOT NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO product_registry (product, family, platform, app_version_marker, security_tier_hint, display_name) VALUES
  ('lms_lab_android', 'lab',    'android', 'lab-android', 'ANDROID_KEYSTORE', 'LMS Lab (Android)'),
  ('lms_lab_windows', 'lab',    'windows', 'lab-win',     'WIN_*',            'LMS Lab (Windows)'),
  ('lms_lab_linux',   'lab',    'linux',   'lab-linux',   'os_platform=linux','LMS Lab (Linux)'),
  ('lms_android',     'school', 'android', '',            'ANDROID_KEYSTORE', 'LMS School (Android)'),
  ('lms_windows',     'school', 'windows', '',            'device_os=Windows','LMS School (Windows)'),
  ('lms_linux',       'school', 'linux',   '',            'device_os=Linux',  'LMS School (Linux)')
ON CONFLICT (product) DO UPDATE SET
  family = EXCLUDED.family,
  platform = EXCLUDED.platform,
  app_version_marker = EXCLUDED.app_version_marker,
  security_tier_hint = EXCLUDED.security_tier_hint,
  display_name = EXCLUDED.display_name;

CREATE INDEX IF NOT EXISTS idx_product_registry_family_platform
  ON product_registry (family, platform);

-- Optional: fleet breakdown joined to friendly names.
-- SELECT r.display_name, COUNT(d.*)
-- FROM device_status d JOIN product_registry r ON r.product = d.product
-- GROUP BY r.display_name ORDER BY 2 DESC;
