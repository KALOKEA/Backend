-- Migration 011: Review media attachments + product rating cache
-- media_urls: array of Cloudinary URLs attached to a review
-- avg_rating / review_count: denormalised cache on products for fast listing

ALTER TABLE reviews
  ADD COLUMN IF NOT EXISTS media_urls TEXT[] DEFAULT '{}';

ALTER TABLE products
  ADD COLUMN IF NOT EXISTS avg_rating    NUMERIC(3,1),
  ADD COLUMN IF NOT EXISTS review_count  INTEGER NOT NULL DEFAULT 0;

GRANT ALL ON reviews  TO service_role;
GRANT ALL ON products TO service_role;
