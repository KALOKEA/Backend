-- 039_product_videos.sql
-- Multiple videos per product (YouTube links and/or uploaded mp4 URLs).
-- Idempotent: safe to run multiple times.

ALTER TABLE products
  ADD COLUMN IF NOT EXISTS videos jsonb NOT NULL DEFAULT '[]'::jsonb;

NOTIFY pgrst, 'reload schema';
