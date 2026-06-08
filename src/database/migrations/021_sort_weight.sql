-- Migration 021: sort_weight for manual "Best Sellers" ordering
-- Admin sets sort_weight > 0 on products to promote them in the Best Sellers tab.
-- Default 0 = appears in natural (newest) order.

ALTER TABLE products ADD COLUMN IF NOT EXISTS sort_weight INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_products_sort_weight ON products (sort_weight DESC);

COMMENT ON COLUMN products.sort_weight IS
  'Admin-set weight for Best Sellers ordering. Higher = promoted. Default 0 = standard newest order.';
