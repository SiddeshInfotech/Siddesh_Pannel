-- ============================================================================
-- Universal admin login: one email may belong to ONLY ONE panel.
-- The single /lms-admin login looks up an email in both admin_users (LMS-Admin) and
-- lab_admin_users (Lab-Admin); an email in both would be ambiguous (the app refuses it).
-- This trigger makes that impossible at the database level (case-insensitive).
-- Run once in the Supabase SQL editor. Safe to re-run.
-- ============================================================================

-- 1) Check for existing conflicts first — this must return 0 rows before step 2.
SELECT lower(a.email) AS email_in_both_panels
FROM admin_users a
JOIN lab_admin_users l ON lower(l.email) = lower(a.email);

-- 2) Block new conflicts on insert/update in either table.
CREATE OR REPLACE FUNCTION enforce_admin_email_one_panel()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_TABLE_NAME = 'admin_users' THEN
    IF EXISTS (SELECT 1 FROM lab_admin_users WHERE lower(email) = lower(NEW.email)) THEN
      RAISE EXCEPTION 'Admin email % already belongs to Lab-Admin', NEW.email USING ERRCODE = 'unique_violation';
    END IF;
  ELSE
    IF EXISTS (SELECT 1 FROM admin_users WHERE lower(email) = lower(NEW.email)) THEN
      RAISE EXCEPTION 'Admin email % already belongs to LMS-Admin', NEW.email USING ERRCODE = 'unique_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS admin_email_one_panel ON admin_users;
CREATE TRIGGER admin_email_one_panel
  BEFORE INSERT OR UPDATE OF email ON admin_users
  FOR EACH ROW EXECUTE FUNCTION enforce_admin_email_one_panel();

DROP TRIGGER IF EXISTS admin_email_one_panel ON lab_admin_users;
CREATE TRIGGER admin_email_one_panel
  BEFORE INSERT OR UPDATE OF email ON lab_admin_users
  FOR EACH ROW EXECUTE FUNCTION enforce_admin_email_one_panel();
