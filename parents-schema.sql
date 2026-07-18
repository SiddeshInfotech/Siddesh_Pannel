-- ============================================================
-- LMS Siddesh Panel — Supabase PostgreSQL Schema for Parents
-- INSTRUCTIONS: Paste this entire file into:
-- Supabase Dashboard → SQL Editor → New Query → Run
-- ============================================================

CREATE TABLE IF NOT EXISTS parents (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id         TEXT UNIQUE,
  parent_name       TEXT NOT NULL,
  kid_name          TEXT NOT NULL,
  email             TEXT NOT NULL UNIQUE,
  phone_number      TEXT NOT NULL,
  city              TEXT,
  state             TEXT,
  grade             TEXT,
  status            TEXT DEFAULT 'Active',
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  updated_at        TIMESTAMPTZ DEFAULT NOW()
);

-- Enable RLS and setup default policies
ALTER TABLE parents ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow authenticated full access to parents" 
  ON parents FOR ALL TO authenticated USING (true);
