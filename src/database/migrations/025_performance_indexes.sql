-- =============================================================================
-- 025 — Performance indexes for search, guest order lookups, and variant filtering.
-- Run in the Supabase SQL editor.
-- =============================================================================

-- 1. Product full-text search — ILIKE '%term%' on name causes a sequential scan
--    on large catalogs. A pg_trgm GIN index makes substring searches fast (~10x).
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS idx_products_name_trgm
  ON products USING GIN (name gin_trgm_ops);

-- 2. Guest order lookups — used by payment.failed webhook to email the guest
--    and by GET /orders/guest/track. Without this, every webhook hits a seq-scan.
CREATE INDEX IF NOT EXISTS idx_orders_guest_email
  ON orders (guest_email)
  WHERE guest_email IS NOT NULL;

-- 3. Active variant filter — product pages and shop API always filter
--    product_variants WHERE is_active = true. Without this index every variant
--    lookup scans the whole table.
CREATE INDEX IF NOT EXISTS idx_variants_is_active
  ON product_variants (product_id, is_active)
  WHERE is_active = true;

-- 4. Composite order status + created_at for admin order list sort
--    (GET /orders?status=pending ordered by newest first).
CREATE INDEX IF NOT EXISTS idx_orders_status_created
  ON orders (status, created_at DESC);

-- 5. Order items lookup by variant — used in stock-restore on cancel/return.
--    The variant foreign key index already exists; add a composite covering
--    order_id + variant_id for the cancel-order restock loop.
CREATE INDEX IF NOT EXISTS idx_order_items_variant_order
  ON order_items (variant_id, order_id);

-- 6. Email log — admin page queries by recipient email + recent first.
--    Column is `recipient` (migration 016), NOT `to_email`.
CREATE INDEX IF NOT EXISTS idx_email_log_recipient_created
  ON email_log (recipient, created_at DESC);

NOTIFY pgrst, 'reload schema';
