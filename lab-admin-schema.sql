-- ============================================================
-- LAB-ADMIN TABLES — same database, completely separate tables, NO data copied
--
-- Run ONCE in the existing Supabase project:
--   Supabase Dashboard → SQL Editor → New Query → paste this whole file → Run
--
-- Creates an EMPTY lab_<name> copy of every table the panel uses — same columns, defaults,
-- constraints and indexes — including Lab-Admin's own login tables (lab_admin_users,
-- lab_admin_sessions, lab_security_events). No rows are copied and no existing table is
-- changed. Lab-Admin (/lab-admin) reads and writes ONLY these lab_* tables.
--
-- Safe to re-run (IF NOT EXISTS everywhere).
-- ============================================================

BEGIN;

DO $$
DECLARE
  tbls text[] := ARRAY[
    'schools', 'vendors', 'parents', 'activation_keys', 'payments',
    'device_status', 'device_timeline', 'handshake_logs', 'terms_acceptances',
    'revoked_device_bindings', 'device_daily_online',
    'admin_users', 'admin_sessions', 'security_events'
  ];
  t text;
  r record;
  def text;
BEGIN
  -- 1. Empty tables with the same structure (columns, defaults, NOT NULL, checks, PK/unique, indexes).
  FOREACH t IN ARRAY tbls LOOP
    IF to_regclass('public.' || t) IS NULL THEN
      RAISE EXCEPTION 'Source table public.% not found — nothing was created.', t;
    END IF;
    EXECUTE format('CREATE TABLE IF NOT EXISTS public.%I (LIKE public.%I INCLUDING ALL)', 'lab_' || t, t);
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', 'lab_' || t);
  END LOOP;

  -- 2. Relationships between the lab tables (LIKE does not copy foreign keys). The panel's
  --    embedded selects (e.g. a key's school name) need these.
  FOR r IN
    SELECT c.conname, src.relname AS src, tgt.relname AS tgt, pg_get_constraintdef(c.oid) AS def
    FROM pg_constraint c
    JOIN pg_class src ON src.oid = c.conrelid
    JOIN pg_class tgt ON tgt.oid = c.confrelid
    JOIN pg_namespace n ON n.oid = src.relnamespace
    WHERE c.contype = 'f' AND n.nspname = 'public'
      AND src.relname = ANY (tbls) AND tgt.relname = ANY (tbls)
  LOOP
    def := regexp_replace(r.def, 'REFERENCES (public\.)?' || r.tgt || '\(', 'REFERENCES public.lab_' || r.tgt || '(');
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = left('lab_' || r.conname, 63)) THEN
      EXECUTE format('ALTER TABLE public.%I ADD CONSTRAINT %I %s', 'lab_' || r.src, left('lab_' || r.conname, 63), def);
    END IF;
  END LOOP;

  -- 3. Row triggers (e.g. updated_at maintenance) — same trigger functions, on the lab tables.
  FOR r IN
    SELECT tg.tgname, cl.relname AS tbl, pg_get_triggerdef(tg.oid) AS def
    FROM pg_trigger tg
    JOIN pg_class cl ON cl.oid = tg.tgrelid
    JOIN pg_namespace n ON n.oid = cl.relnamespace
    WHERE NOT tg.tgisinternal AND n.nspname = 'public' AND cl.relname = ANY (tbls)
  LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = left('lab_' || r.tgname, 63)) THEN
      def := replace(r.def, 'CREATE TRIGGER ' || quote_ident(r.tgname), 'CREATE TRIGGER ' || quote_ident(left('lab_' || r.tgname, 63)));
      def := regexp_replace(def, ' ON (public\.)?' || r.tbl || ' ', ' ON public.lab_' || r.tbl || ' ');
      EXECUTE def;
    END IF;
  END LOOP;
END $$;

COMMIT;

-- Check: should list the 14 new lab_* tables.
SELECT c.relname AS lab_table
FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relname LIKE 'lab\_%'
ORDER BY 1;
