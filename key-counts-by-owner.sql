-- ============================================================
-- LMS Siddesh Panel — Key counts per owner (Accounts page)
-- INSTRUCTIONS: Paste this entire file into:
-- Supabase Dashboard → SQL Editor → New Query → Run
--
-- The Accounts page shows how many licence keys each school / vendor / parent has.
-- Without this function the server downloads EVERY key row (1000 per request, one request
-- after another) just to count them. This counts inside Postgres and returns one small row
-- per owner. Until it is installed, the page keeps using the old way (no error).
-- Safe to run more than once.
-- ============================================================

CREATE OR REPLACE FUNCTION public.key_counts_by_owner(p_panel TEXT)
RETURNS TABLE (owner_type TEXT, owner_id TEXT, n BIGINT)
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
BEGIN
  IF p_panel = 'lms' THEN
    RETURN QUERY
      SELECT 'school'::TEXT, k.school_id::TEXT, COUNT(*) FROM activation_keys k WHERE k.school_id IS NOT NULL GROUP BY k.school_id
      UNION ALL
      SELECT 'vendor'::TEXT, k.vendor_id::TEXT, COUNT(*) FROM activation_keys k WHERE k.vendor_id IS NOT NULL GROUP BY k.vendor_id
      UNION ALL
      SELECT 'parent'::TEXT, k.parent_id::TEXT, COUNT(*) FROM activation_keys k WHERE k.parent_id IS NOT NULL GROUP BY k.parent_id;
  ELSIF p_panel = 'lab' THEN
    RETURN QUERY
      SELECT 'school'::TEXT, k.school_id::TEXT, COUNT(*) FROM lab_activation_keys k WHERE k.school_id IS NOT NULL GROUP BY k.school_id
      UNION ALL
      SELECT 'vendor'::TEXT, k.vendor_id::TEXT, COUNT(*) FROM lab_activation_keys k WHERE k.vendor_id IS NOT NULL GROUP BY k.vendor_id
      UNION ALL
      SELECT 'parent'::TEXT, k.parent_id::TEXT, COUNT(*) FROM lab_activation_keys k WHERE k.parent_id IS NOT NULL GROUP BY k.parent_id;
  ELSE
    RAISE EXCEPTION 'key_counts_by_owner: unknown panel %', p_panel;
  END IF;
END;
$$;

-- Server-side only (service_role). The browser's anon/authenticated roles must not read counts.
REVOKE ALL ON FUNCTION public.key_counts_by_owner(TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.key_counts_by_owner(TEXT) TO service_role;
