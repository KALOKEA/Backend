-- 037_product_faqs.sql
-- Per-product, admin-editable FAQ list shown on each product page.
-- Stored as a JSONB array of { "q": "...", "a": "..." } objects. Defaults to [].
-- Run in Supabase SQL editor, then reload the PostgREST schema cache.

ALTER TABLE products
  ADD COLUMN IF NOT EXISTS faqs jsonb NOT NULL DEFAULT '[]'::jsonb;

GRANT ALL ON TABLE products TO service_role;
NOTIFY pgrst, 'reload schema';
