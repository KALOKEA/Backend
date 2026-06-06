-- Migration 009: Add video_url to products
-- Allows admin to attach a looping product video to the gallery.

ALTER TABLE products
  ADD COLUMN IF NOT EXISTS video_url TEXT;

-- Re-grant so service_role can read/write the updated table
GRANT ALL ON products TO service_role;
