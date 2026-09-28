-- ============================================================
-- LMS Siddesh Panel — LAB-ADMIN SPLIT (separate tables, same database)
-- INSTRUCTIONS: back up first, then paste this entire file into:
--   Supabase Dashboard → SQL Editor → New Query → Run
--
-- PURPOSE: Lab-Admin (the 5 LMS-Lab products: STEM Starter, Robotics & Drone, IoT & Robotics,
--   AI & Future Tech, ThinkSphere360 Lab) keeps ALL its data in lab_* tables. The app code picks
--   the table set per request (src/lib/panelTables.ts): admin pages by admin_users.panel, device
--   endpoints (activate / ping / terms-accept) by the device's product family.
--
-- RUN THIS BEFORE DEPLOYING the panel code: once deployed, every Lab device (including the
--   existing ThinkSphere360 Lab fleet) is looked up in lab_activation_keys.
--
-- SAFE: additive + idempotent. Nothing in the original tables is changed or deleted
--   (section 5 is an optional, commented-out cleanup).
-- ============================================================

BEGIN;

-- ── 1. Lab tables: same columns, defaults, indexes and constraints as the originals ──────────
CREATE TABLE IF NOT EXISTS lab_schools                 (LIKE schools                 INCLUDING ALL);
CREATE TABLE IF NOT EXISTS lab_vendors                 (LIKE vendors                 INCLUDING ALL);
CREATE TABLE IF NOT EXISTS lab_parents                 (LIKE parents                 INCLUDING ALL);
CREATE TABLE IF NOT EXISTS lab_activation_keys         (LIKE activation_keys         INCLUDING ALL);
CREATE TABLE IF NOT EXISTS lab_payments                (LIKE payments                INCLUDING ALL);
CREATE TABLE IF NOT EXISTS lab_device_status           (LIKE device_status           INCLUDING ALL);
CREATE TABLE IF NOT EXISTS lab_device_timeline         (LIKE device_timeline         INCLUDING ALL);
CREATE TABLE IF NOT EXISTS lab_handshake_logs          (LIKE handshake_logs          INCLUDING ALL);
CREATE TABLE IF NOT EXISTS lab_terms_acceptances       (LIKE terms_acceptances       INCLUDING ALL);
CREATE TABLE IF NOT EXISTS lab_revoked_device_bindings (LIKE revoked_device_bindings INCLUDING ALL);
CREATE TABLE IF NOT EXISTS lab_device_daily_online     (LIKE device_daily_online     INCLUDING ALL);

-- ── 2. Relationships (LIKE does not copy foreign keys). PostgREST needs these for the embedded
--      selects the pages use, e.g. `schools:lab_schools ( name )` on lab_activation_keys. ─────
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'lab_activation_keys_school_id_fkey') THEN
    ALTER TABLE lab_activation_keys ADD CONSTRAINT lab_activation_keys_school_id_fkey
      FOREIGN KEY (school_id) REFERENCES lab_schools(id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'lab_activation_keys_vendor_id_fkey') THEN
    ALTER TABLE lab_activation_keys ADD CONSTRAINT lab_activation_keys_vendor_id_fkey
      FOREIGN KEY (vendor_id) REFERENCES lab_vendors(vendor_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'lab_activation_keys_parent_id_fkey') THEN
    ALTER TABLE lab_activation_keys ADD CONSTRAINT lab_activation_keys_parent_id_fkey
      FOREIGN KEY (parent_id) REFERENCES lab_parents(id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'lab_payments_school_id_fkey') THEN
    ALTER TABLE lab_payments ADD CONSTRAINT lab_payments_school_id_fkey
      FOREIGN KEY (school_id) REFERENCES lab_schools(id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'lab_payments_vendor_id_fkey') THEN
    ALTER TABLE lab_payments ADD CONSTRAINT lab_payments_vendor_id_fkey
      FOREIGN KEY (vendor_id) REFERENCES lab_vendors(vendor_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'lab_payments_parent_id_fkey') THEN
    ALTER TABLE lab_payments ADD CONSTRAINT lab_payments_parent_id_fkey
      FOREIGN KEY (parent_id) REFERENCES lab_parents(id);
  END IF;
END $$;

-- Same posture as the originals: only the server's service_role key can touch these tables.
ALTER TABLE lab_schools                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE lab_vendors                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE lab_parents                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE lab_activation_keys         ENABLE ROW LEVEL SECURITY;
ALTER TABLE lab_payments                ENABLE ROW LEVEL SECURITY;
ALTER TABLE lab_device_status           ENABLE ROW LEVEL SECURITY;
ALTER TABLE lab_device_timeline         ENABLE ROW LEVEL SECURITY;
ALTER TABLE lab_handshake_logs          ENABLE ROW LEVEL SECURITY;
ALTER TABLE lab_terms_acceptances       ENABLE ROW LEVEL SECURITY;
ALTER TABLE lab_revoked_device_bindings ENABLE ROW LEVEL SECURITY;
ALTER TABLE lab_device_daily_online     ENABLE ROW LEVEL SECURITY;

-- ── 3. Admin accounts: which dashboard each login opens ('lms' = LMS-Admin, 'lab' = Lab-Admin) ──
ALTER TABLE admin_users ADD COLUMN IF NOT EXISTS panel TEXT NOT NULL DEFAULT 'lms';
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'admin_users_panel_check') THEN
    ALTER TABLE admin_users ADD CONSTRAINT admin_users_panel_check CHECK (panel IN ('lms', 'lab'));
  END IF;
END $$;
-- Make an existing account a Lab-Admin (it signs in to the Lab dashboard from then on):
--   UPDATE admin_users SET panel = 'lab' WHERE email = 'lab-admin@example.com';

-- ── 4. Move the existing ThinkSphere360 Lab fleet into Lab-Admin (copies; originals kept) ──────
CREATE TEMP TABLE _lab_keys ON COMMIT DROP AS
  SELECT * FROM activation_keys
  WHERE product_id IN ('LMS_LAB_ANDROID', 'LMS_LAB_WINDOWS', 'LMS_LAB_LINUX')
     OR (product_id IS NULL AND product IN ('lms_lab_android', 'lms_lab_windows', 'lms_lab_linux'));

INSERT INTO lab_schools SELECT * FROM schools
  WHERE id IN (SELECT school_id FROM _lab_keys WHERE school_id IS NOT NULL) ON CONFLICT DO NOTHING;
INSERT INTO lab_vendors SELECT * FROM vendors
  WHERE vendor_id IN (SELECT vendor_id FROM _lab_keys WHERE vendor_id IS NOT NULL) ON CONFLICT DO NOTHING;
INSERT INTO lab_parents SELECT * FROM parents
  WHERE id IN (SELECT parent_id FROM _lab_keys WHERE parent_id IS NOT NULL) ON CONFLICT DO NOTHING;

INSERT INTO lab_activation_keys SELECT * FROM _lab_keys ON CONFLICT DO NOTHING;

INSERT INTO lab_device_status SELECT * FROM device_status
  WHERE device_fingerprint IN (SELECT device_fingerprint FROM _lab_keys WHERE device_fingerprint IS NOT NULL)
  ON CONFLICT DO NOTHING;
INSERT INTO lab_device_timeline SELECT * FROM device_timeline
  WHERE device_fingerprint IN (SELECT device_fingerprint FROM _lab_keys WHERE device_fingerprint IS NOT NULL)
  ON CONFLICT DO NOTHING;
INSERT INTO lab_handshake_logs SELECT * FROM handshake_logs
  WHERE activation_key IN (SELECT key FROM _lab_keys) ON CONFLICT DO NOTHING;
INSERT INTO lab_terms_acceptances SELECT * FROM terms_acceptances
  WHERE device_fingerprint IN (SELECT device_fingerprint FROM _lab_keys WHERE device_fingerprint IS NOT NULL)
  ON CONFLICT DO NOTHING;
INSERT INTO lab_revoked_device_bindings SELECT * FROM revoked_device_bindings
  WHERE activation_key_id IN (SELECT id FROM _lab_keys) ON CONFLICT DO NOTHING;
INSERT INTO lab_device_daily_online SELECT * FROM device_daily_online
  WHERE device_fingerprint IN (SELECT device_fingerprint FROM _lab_keys WHERE device_fingerprint IS NOT NULL)
  ON CONFLICT DO NOTHING;
-- Payments are NOT copied: a school can have paid for both School and Lab, so assign Lab
-- payments by hand in Lab-Admin if needed.

-- ── 5. Product registry (fleet reporting names for the new Lab products) ───────────────────────
INSERT INTO product_registry (product, family, platform, app_version_marker, security_tier_hint, display_name)
SELECT lower(p.id || '_' || o.os), 'lab', lower(o.os), '', NULL, p.name || ' (' || o.label || ')'
FROM (VALUES ('LAB_STEM', 'STEM Starter Lab'), ('LAB_ROBODRONE', 'Robotics & Drone Lab'),
             ('LAB_IOTROBO', 'IoT & Robotics Lab'), ('LAB_AIFUTURE', 'AI & Future Tech Lab')) AS p(id, name)
CROSS JOIN (VALUES ('ANDROID', 'Android'), ('WINDOWS', 'Windows'), ('LINUX', 'Linux')) AS o(os, label)
ON CONFLICT (product) DO NOTHING;

COMMIT;

-- ── 6. OPTIONAL cleanup — run ONLY after verifying Lab-Admin shows the migrated fleet ─────────
-- Removes the copied Lab rows from LMS-Admin's tables so they no longer appear there.
-- DELETE FROM revoked_device_bindings WHERE activation_key_id IN (SELECT id FROM lab_activation_keys);
-- DELETE FROM activation_keys WHERE id IN (SELECT id FROM lab_activation_keys);
