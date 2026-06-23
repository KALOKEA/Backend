-- 042_product_sku.sql
-- ONE master SKU per product (admin-set, editable) + relax variant SKU uniqueness.
--
-- Why: the client wants a single SKU decided at the PRODUCT level, with the option
-- to override a specific size/colour. The old model put a globally-UNIQUE sku on
-- every variant. The admin matrix generator builds each variant SKU as
-- `slugify(name)-size-colour` then .slice(0,40); for long product names the size/
-- colour get truncated off, so every variant collides on the same SKU and the
-- UNIQUE constraint rejects all but the first — surfacing as "cannot add variants".
--
-- Fix: add products.sku (the master), and DROP the UNIQUE on product_variants.sku
-- so variants can share the product SKU (blank = inherit) or carry an optional
-- per-variant override. Uniqueness is now the admin's call, not enforced by the DB.
-- Fully idempotent.

ALTER TABLE products ADD COLUMN IF NOT EXISTS sku text;

-- Postgres auto-named the inline `sku text UNIQUE` constraint product_variants_sku_key.
ALTER TABLE product_variants DROP CONSTRAINT IF EXISTS product_variants_sku_key;

-- Keep a plain (non-unique) index for SKU lookups.
CREATE INDEX IF NOT EXISTS idx_variants_sku ON product_variants (sku);

NOTIFY pgrst, 'reload schema';
