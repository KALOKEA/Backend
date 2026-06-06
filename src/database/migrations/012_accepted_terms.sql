-- Migration 012: Add accepted_terms column to users
-- Run this in Supabase SQL Editor

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS accepted_terms BOOLEAN NOT NULL DEFAULT false;

-- Ensure service_role has full access
GRANT ALL ON users TO service_role;

-- Optional: mark existing users as having accepted (they signed up before this was tracked)
-- UPDATE users SET accepted_terms = true WHERE created_at < NOW();
