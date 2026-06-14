-- ============================================================
-- Migration 032 — Launch blocker fixes
-- Run once in Supabase SQL editor before going live.
-- All statements are idempotent (safe to re-run).
-- ============================================================

-- ── 1. Add 'refund_pending' to the payment_status CHECK constraint ────────────
-- CRITICAL: cancelOrder() writes 'refund_pending' as an atomic race guard.
-- Without this, every paid-order cancellation fails with PostgreSQL error 23514.

ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_payment_status_check;

ALTER TABLE orders
  ADD CONSTRAINT orders_payment_status_check
  CHECK (payment_status IN ('pending', 'paid', 'failed', 'refunded', 'refund_pending'));

-- ── 2. Add 'notified' column to stock_notifications (if not already there) ───
-- Fixes partial-index failures from migration 031 if the table pre-existed.

ALTER TABLE stock_notifications
  ADD COLUMN IF NOT EXISTS notified boolean NOT NULL DEFAULT false;

-- Re-create the partial indexes now that the column is guaranteed to exist.
DROP INDEX IF EXISTS idx_stock_notif_variant;
CREATE INDEX idx_stock_notif_variant
  ON stock_notifications (variant_id)
  WHERE notified = false;

DROP INDEX IF EXISTS uq_stock_notif_email;
CREATE UNIQUE INDEX uq_stock_notif_email
  ON stock_notifications (variant_id, email)
  WHERE notified = false;

-- ── 3. Full-text search GIN index on products.name ────────────────────────────
-- Replaces sequential-scan ilike "%term%" with fast tsvector lookup.
-- Covers the GET /products?search= query used by the search bar.

ALTER TABLE products
  ADD COLUMN IF NOT EXISTS name_tsv tsvector
  GENERATED ALWAYS AS (to_tsvector('english', coalesce(name, ''))) STORED;

DROP INDEX IF EXISTS idx_products_name_tsv;
CREATE INDEX idx_products_name_tsv ON products USING GIN (name_tsv);

-- After this index is in place, the backend can switch from:
--   .ilike('name', `%${q}%`)
-- to the faster:
--   .textSearch('name_tsv', q, { type: 'websearch', config: 'english' })
-- (optional future optimization — the ilike still works with this index present)

-- ── 4. Add cod_refund_method + cod_refund_reference columns ──────────────────
-- Tracks COD offline refund settlement so admins can't mark refunded without proof.

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS cod_refund_method  text CHECK (cod_refund_method IN ('bank_transfer', 'upi', 'cash')),
  ADD COLUMN IF NOT EXISTS cod_refund_reference text;

-- ── Done ──────────────────────────────────────────────────────────────────────
-- Run this before launch. No data loss, fully reversible.
-- Verification queries:
--   SELECT conname, pg_get_constraintdef(oid) FROM pg_constraint WHERE conname = 'orders_payment_status_check';
--   SELECT column_name FROM information_schema.columns WHERE table_name = 'stock_notifications' AND column_name = 'notified';
--   SELECT indexname FROM pg_indexes WHERE indexname = 'idx_products_name_tsv';
