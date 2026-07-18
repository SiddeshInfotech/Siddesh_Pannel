-- ============================================================
-- LMS Siddesh Panel — Support Multi-Entity Payments
-- INSTRUCTIONS: Paste this entire file into:
-- Supabase Dashboard → SQL Editor → New Query → Run
-- ============================================================

-- 1. Alter 'payments' table
-- Add columns for vendors and parents, and remove NOT NULL on school_id
ALTER TABLE payments ADD COLUMN IF NOT EXISTS vendor_id TEXT REFERENCES vendors(vendor_id);
ALTER TABLE payments ADD COLUMN IF NOT EXISTS parent_id UUID REFERENCES parents(id);
ALTER TABLE payments ALTER COLUMN school_id DROP NOT NULL;

-- 2. Alter 'activation_keys' table
-- Add columns for vendors and parents, and remove NOT NULL on school_id
ALTER TABLE activation_keys ADD COLUMN IF NOT EXISTS vendor_id TEXT REFERENCES vendors(vendor_id);
ALTER TABLE activation_keys ADD COLUMN IF NOT EXISTS parent_id UUID REFERENCES parents(id);
ALTER TABLE activation_keys ALTER COLUMN school_id DROP NOT NULL;

-- Note: Ensure that your logic always sets exactly ONE of these three IDs 
-- when inserting rows into payments or activation_keys.
