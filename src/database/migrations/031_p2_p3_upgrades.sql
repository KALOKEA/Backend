-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 031 — P2/P3 audit upgrades
-- Run this SQL in: Supabase → SQL Editor → Run
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. Admin 2FA (TOTP) — add columns to users table ─────────────────────────
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS totp_secret  text,
  ADD COLUMN IF NOT EXISTS totp_enabled boolean NOT NULL DEFAULT false;

-- ── 2. Flash sale settings — add columns to store_settings ───────────────────
ALTER TABLE store_settings
  ADD COLUMN IF NOT EXISTS flash_sale_enabled      boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS flash_sale_end_time     text    NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS flash_sale_label        text    NOT NULL DEFAULT 'Flash Sale',
  ADD COLUMN IF NOT EXISTS flash_sale_discount_pct integer NOT NULL DEFAULT 20,
  ADD COLUMN IF NOT EXISTS flash_sale_coupon       text    NOT NULL DEFAULT '';

-- ── 3. Reverse logistics — add columns to returns table ──────────────────────
ALTER TABLE returns
  ADD COLUMN IF NOT EXISTS return_awb               text,
  ADD COLUMN IF NOT EXISTS shiprocket_reverse_status text,
  ADD COLUMN IF NOT EXISTS quantity                 integer NOT NULL DEFAULT 1;

-- Extend returns.status to include reverse logistics states
-- PostgreSQL: drop the old constraint, add a new one with extended values
ALTER TABLE returns DROP CONSTRAINT IF EXISTS returns_status_check;
ALTER TABLE returns
  ADD CONSTRAINT returns_status_check
  CHECK (status IN (
    'requested', 'approved', 'rejected', 'received', 'refunded', 'completed',
    -- reverse logistics states (set by ShipRocket webhook)
    'pickup_scheduled', 'picked_up', 'in_transit', 'pickup_failed'
  ));

-- Index on return_awb for fast webhook lookups
CREATE INDEX IF NOT EXISTS idx_returns_return_awb ON returns (return_awb)
  WHERE return_awb IS NOT NULL;

-- ── 4. Ensure stock_reservations (migration 008) is applied ──────────────────
CREATE TABLE IF NOT EXISTS stock_reservations (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id    uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  variant_id  uuid NOT NULL REFERENCES product_variants(id) ON DELETE CASCADE,
  quantity    integer NOT NULL CHECK (quantity > 0),
  expires_at  timestamptz NOT NULL,
  confirmed   boolean NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_stock_res_order   ON stock_reservations (order_id);
CREATE INDEX IF NOT EXISTS idx_stock_res_variant ON stock_reservations (variant_id);
CREATE INDEX IF NOT EXISTS idx_stock_res_expires ON stock_reservations (expires_at)
  WHERE confirmed = false;

-- ── 5. Ensure restock_variant RPC exists ──────────────────────────────────────
CREATE OR REPLACE FUNCTION restock_variant(p_variant_id uuid, p_qty integer)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  UPDATE product_variants
  SET    stock = stock + p_qty
  WHERE  id = p_variant_id;
END;
$$;

-- ── 6. Sort weight on products (migration 030) ────────────────────────────────
ALTER TABLE products
  ADD COLUMN IF NOT EXISTS sort_weight integer NOT NULL DEFAULT 0;
ALTER TABLE product_variants
  ADD COLUMN IF NOT EXISTS sort_weight integer NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS idx_products_sort   ON products (sort_weight DESC);
CREATE INDEX IF NOT EXISTS idx_variants_sort   ON product_variants (sort_weight DESC);

-- ── 7. Back-in-stock notifications (migration 027) ────────────────────────────
CREATE TABLE IF NOT EXISTS stock_notifications (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  variant_id uuid NOT NULL REFERENCES product_variants(id) ON DELETE CASCADE,
  email      text NOT NULL,
  notified   boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_stock_notif_variant  ON stock_notifications (variant_id)
  WHERE notified = false;
CREATE UNIQUE INDEX IF NOT EXISTS uq_stock_notif_email
  ON stock_notifications (variant_id, email)
  WHERE notified = false;

-- ── 8. Review enhancements (migration 028) ───────────────────────────────────
ALTER TABLE reviews
  ADD COLUMN IF NOT EXISTS admin_reply      text,
  ADD COLUMN IF NOT EXISTS reply_at         timestamptz,
  ADD COLUMN IF NOT EXISTS flagged          boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS flag_reason      text,
  ADD COLUMN IF NOT EXISTS helpful_count    integer NOT NULL DEFAULT 0;

-- ── 9. Newsletter campaigns (migration 029) ──────────────────────────────────
CREATE TABLE IF NOT EXISTS newsletter_campaigns (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subject     text NOT NULL,
  body_html   text NOT NULL,
  sent_count  integer NOT NULL DEFAULT 0,
  status      text NOT NULL DEFAULT 'draft'
              CHECK (status IN ('draft', 'sending', 'sent', 'failed')),
  sent_at     timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- ── 10. Coupon guest_email support (migration 021) ───────────────────────────
ALTER TABLE coupons
  ADD COLUMN IF NOT EXISTS guest_email_required boolean NOT NULL DEFAULT false;
ALTER TABLE coupon_uses
  ADD COLUMN IF NOT EXISTS guest_email text;
CREATE INDEX IF NOT EXISTS idx_coupon_uses_guest
  ON coupon_uses (coupon_id, guest_email)
  WHERE guest_email IS NOT NULL;

-- ── 11. Footer settings (migration 022) ──────────────────────────────────────
ALTER TABLE store_settings
  ADD COLUMN IF NOT EXISTS footer_tagline    text    NOT NULL DEFAULT 'Luxury Indian Fashion',
  ADD COLUMN IF NOT EXISTS footer_copyright  text    NOT NULL DEFAULT '© 2026 KALOKEA. All rights reserved.';

-- ── 12. Site content table (migration 026) ───────────────────────────────────
CREATE TABLE IF NOT EXISTS site_content (
  key        text PRIMARY KEY,
  value      jsonb NOT NULL DEFAULT '{}',
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- ── 13. Fabric & care fields (migration 024) ─────────────────────────────────
ALTER TABLE products
  ADD COLUMN IF NOT EXISTS fabric     text,
  ADD COLUMN IF NOT EXISTS care       text,
  ADD COLUMN IF NOT EXISTS origin     text;

-- ── Done ──────────────────────────────────────────────────────────────────────
-- All changes are idempotent (IF NOT EXISTS / OR REPLACE). Safe to re-run.
