-- ============================================================
-- LMS Siddesh Panel — consent for Individual users (parents)
-- The ThinkSphere360 website fills these when someone signs up (email or Google)
-- and again on purchase: the terms and privacy notice version they agreed to, and when.
-- INSTRUCTIONS: Paste this entire file into:
-- Supabase Dashboard → SQL Editor → New Query → Run
-- Safe to run more than once.
-- ============================================================

ALTER TABLE parents ADD COLUMN IF NOT EXISTS consent_version     TEXT;
ALTER TABLE parents ADD COLUMN IF NOT EXISTS consent_accepted_at TIMESTAMPTZ;

COMMENT ON COLUMN parents.consent_version IS 'ThinkSphere360 Terms of Service and Privacy Notice version agreed to (website TERMS_VERSION). Set by the website.';
COMMENT ON COLUMN parents.consent_accepted_at IS 'When that version was agreed to. Set by the website.';

-- So the website sees the new columns straight away.
NOTIFY pgrst, 'reload schema';
