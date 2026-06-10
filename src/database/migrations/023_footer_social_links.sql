-- Migration 023: Add Facebook and Pinterest URLs to store_settings
-- Extends migration 022 to cover all footer social links configurable in the admin.

ALTER TABLE store_settings
  ADD COLUMN IF NOT EXISTS footer_facebook_url  TEXT NOT NULL DEFAULT 'https://www.facebook.com/kalokea.in',
  ADD COLUMN IF NOT EXISTS footer_pinterest_url TEXT NOT NULL DEFAULT 'https://www.pinterest.com/kalokea';

GRANT ALL ON TABLE store_settings TO service_role;

NOTIFY pgrst, 'reload schema';
