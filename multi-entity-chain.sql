-- ============================================================
-- LMS Siddesh Panel — Multi-entity activation CHAIN (School | Vendor | Parent)
-- INSTRUCTIONS: Paste this entire file into:
--   Supabase Dashboard → SQL Editor → New Query → Run
--
-- PURPOSE: extend the school-only activation chain so a Vendor or a Parent/Individual
--   key flows through activation → content-key entitlement → heartbeat → monitoring
--   with FULL PARITY to a school. Prereq: support-multi-entity-payments.sql (which added
--   vendor_id/parent_id to payments + activation_keys) has already been run.
--
-- SAFE: purely additive (ADD COLUMN IF NOT EXISTS) + idempotent DROP NOT NULL. No existing
--   column or row is changed; older app builds keep working unchanged.
-- ============================================================

-- 1. VENDOR content scope ---------------------------------------------------------------
-- Vendors get content exactly like a school, but had no grade/year field. Add them
-- (nullable). resolveClassIds() treats `standard` as the purchased grade scope; a blank
-- vendor scope falls back to the full content set (see src/lib/entity.ts). academic_year
-- is shown as the vendor's "year" on the app's generic Information tab.
ALTER TABLE vendors ADD COLUMN IF NOT EXISTS standard      TEXT;
ALTER TABLE vendors ADD COLUMN IF NOT EXISTS academic_year TEXT;

-- Per-key academic year, captured at GENERATION time from the key's chosen validity
-- (duration/expiry). Served back at activation as the entity's "year" — so the year the
-- operator picked when generating the key is what the device shows and we keep on record.
-- Used most visibly for a Vendor key's generic "Year" line on the app Information tab.
ALTER TABLE activation_keys ADD COLUMN IF NOT EXISTS academic_year TEXT;

-- 2. Heartbeat telemetry: allow non-school devices --------------------------------------
-- /api/device/ping writes device_status + device_timeline keyed by the entity. For a
-- vendor/parent device school_id is NULL, so it MUST be nullable, and we add the two
-- entity columns so per-entity telemetry can be queried later.
ALTER TABLE device_status   ADD COLUMN IF NOT EXISTS vendor_id TEXT;
ALTER TABLE device_status   ADD COLUMN IF NOT EXISTS parent_id UUID;
ALTER TABLE device_status   ALTER COLUMN school_id DROP NOT NULL;

ALTER TABLE device_timeline ADD COLUMN IF NOT EXISTS vendor_id TEXT;
ALTER TABLE device_timeline ADD COLUMN IF NOT EXISTS parent_id UUID;
ALTER TABLE device_timeline ALTER COLUMN school_id DROP NOT NULL;

-- Indexes for filtering the fleet by entity.
CREATE INDEX IF NOT EXISTS idx_device_status_vendor   ON device_status (vendor_id);
CREATE INDEX IF NOT EXISTS idx_device_status_parent   ON device_status (parent_id);
CREATE INDEX IF NOT EXISTS idx_device_timeline_vendor ON device_timeline (vendor_id);
CREATE INDEX IF NOT EXISTS idx_device_timeline_parent ON device_timeline (parent_id);
