-- ============================================================
-- LMS Siddesh Panel — Fast, exact admin session check
-- INSTRUCTIONS: Paste this entire file into:
-- Supabase Dashboard → SQL Editor → New Query → Run
--
-- Every admin request re-checks (briefly cached) that the email is still an admin and the
-- session row is live. Until now that took two queries and matched the email with ILIKE, which
-- treats "_" and "%" in an email as wildcards and cannot use an index.
-- This adds:
--   1. indexes on lower(email) for both panels' admin tables (exact, case-insensitive lookups);
--   2. admin_session_status(): both checks in ONE call, exact email match, no wildcards.
-- Until it is installed the app keeps using two queries (also exact-match now). Safe to re-run.
-- ============================================================

CREATE INDEX IF NOT EXISTS admin_users_email_lower_idx     ON admin_users (lower(email));
CREATE INDEX IF NOT EXISTS lab_admin_users_email_lower_idx ON lab_admin_users (lower(email));
CREATE INDEX IF NOT EXISTS admin_sessions_session_id_idx     ON admin_sessions (session_id);
CREATE INDEX IF NOT EXISTS lab_admin_sessions_session_id_idx ON lab_admin_sessions (session_id);

CREATE OR REPLACE FUNCTION public.admin_session_status(p_panel TEXT, p_sid TEXT, p_email TEXT)
RETURNS TABLE (is_admin BOOLEAN, session_found BOOLEAN, revoked BOOLEAN, expires_at TIMESTAMPTZ)
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
BEGIN
  -- Scalar sub-selects: a duplicated session_id raises an error, so the app fails closed.
  IF p_panel = 'lms' THEN
    RETURN QUERY SELECT
      EXISTS (SELECT 1 FROM admin_users u WHERE lower(u.email) = lower(p_email)),
      EXISTS (SELECT 1 FROM admin_sessions s WHERE s.session_id = p_sid),
      (SELECT s.revoked::BOOLEAN FROM admin_sessions s WHERE s.session_id = p_sid),
      (SELECT s.expires_at::TIMESTAMPTZ FROM admin_sessions s WHERE s.session_id = p_sid);
  ELSIF p_panel = 'lab' THEN
    RETURN QUERY SELECT
      EXISTS (SELECT 1 FROM lab_admin_users u WHERE lower(u.email) = lower(p_email)),
      EXISTS (SELECT 1 FROM lab_admin_sessions s WHERE s.session_id = p_sid),
      (SELECT s.revoked::BOOLEAN FROM lab_admin_sessions s WHERE s.session_id = p_sid),
      (SELECT s.expires_at::TIMESTAMPTZ FROM lab_admin_sessions s WHERE s.session_id = p_sid);
  ELSE
    RAISE EXCEPTION 'admin_session_status: unknown panel %', p_panel;
  END IF;
END;
$$;

-- Server-side only (service_role). The browser's anon/authenticated roles must not call it.
REVOKE ALL ON FUNCTION public.admin_session_status(TEXT, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_session_status(TEXT, TEXT, TEXT) TO service_role;
