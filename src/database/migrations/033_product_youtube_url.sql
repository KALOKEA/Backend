-- Migration 033: Add youtube_url to products
-- Allows admin to attach a YouTube video embed to the product detail page.

ALTER TABLE products
  ADD COLUMN IF NOT EXISTS youtube_url TEXT;

-- Re-grant so service_role can read/write the updated table
GRANT ALL ON products TO service_role;
