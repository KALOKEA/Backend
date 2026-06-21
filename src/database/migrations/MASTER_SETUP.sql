-- ============================================================================
--  KALOKEA — MASTER SETUP (idempotent catch-up)   [run in Supabase → SQL Editor]
-- ============================================================================
--  HOW TO USE
--    • BRAND-NEW / EMPTY database:  run 000_FULL_SCHEMA.sql ONCE first
--      (it creates the core tables), then run THIS file.
--    • EXISTING database (your case): just run THIS file. It applies every
--      schema change added after the base and fixes anything you may have missed.
--
--  100% idempotent: every statement uses IF NOT EXISTS / OR REPLACE / safe
--  constraint swaps, so you can run it as many times as you like with no harm.
--  Covers migrations 011, 021–037 (incl. faqs, model_info, youtube_url, coupon
--  featured, admin-seeded reviews, force-TEXT content, 2FA, flash sale, reverse
--  logistics, newsletter campaigns, stock notifications, full-text search).
-- ============================================================================

BEGIN;

-- ── PRODUCTS: media, FAQ, model info, fabric, ratings, sort, search ──────────
ALTER TABLE products ADD COLUMN IF NOT EXISTS video_url    TEXT;                       -- 009
ALTER TABLE products ADD COLUMN IF NOT EXISTS youtube_url  TEXT;                       -- 033
ALTER TABLE products ADD COLUMN IF NOT EXISTS model_info   TEXT;                       -- 037
ALTER TABLE products ADD COLUMN IF NOT EXISTS fabric_care  TEXT;                       -- 024
ALTER TABLE products ADD COLUMN IF NOT EXISTS fabric       TEXT;                       -- 031
ALTER TABLE products ADD COLUMN IF NOT EXISTS care         TEXT;                       -- 031
ALTER TABLE products ADD COLUMN IF NOT EXISTS origin       TEXT;                       -- 031
ALTER TABLE products ADD COLUMN IF NOT EXISTS faqs         jsonb NOT NULL DEFAULT '[]'::jsonb;  -- 037
ALTER TABLE products ADD COLUMN IF NOT EXISTS sort_weight  integer NOT NULL DEFAULT 0; -- 030
ALTER TABLE products ADD COLUMN IF NOT EXISTS avg_rating   NUMERIC(3,1);               -- 011
ALTER TABLE products ADD COLUMN IF NOT EXISTS review_count INTEGER NOT NULL DEFAULT 0; -- 011
CREATE INDEX IF NOT EXISTS idx_products_sort_weight ON products (sort_weight DESC);

-- Full-text search vector on product name (032). Generated column = always in sync.
ALTER TABLE products ADD COLUMN IF NOT EXISTS name_tsv tsvector
  GENERATED ALWAYS AS (to_tsvector('english', coalesce(name, ''))) STORED;
CREATE INDEX IF NOT EXISTS idx_products_name_tsv ON products USING GIN (name_tsv);

-- ── PRODUCT VARIANTS: sort weight (030) ─────────────────────────────────────
ALTER TABLE product_variants ADD COLUMN IF NOT EXISTS sort_weight integer NOT NULL DEFAULT 0;

-- ── REVIEWS: admin-seeded + enhancements (028 / 034) ────────────────────────
ALTER TABLE reviews ALTER COLUMN user_id DROP NOT NULL;
ALTER TABLE reviews ADD COLUMN IF NOT EXISTS guest_name       TEXT;
ALTER TABLE reviews ADD COLUMN IF NOT EXISTS admin_reply      TEXT;
ALTER TABLE reviews ADD COLUMN IF NOT EXISTS admin_replied_at TIMESTAMPTZ;  -- name used by 028
ALTER TABLE reviews ADD COLUMN IF NOT EXISTS reply_at         TIMESTAMPTZ;  -- name used by 031
ALTER TABLE reviews ADD COLUMN IF NOT EXISTS flagged          BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE reviews ADD COLUMN IF NOT EXISTS flag_reason      TEXT;
ALTER TABLE reviews ADD COLUMN IF NOT EXISTS helpful_count    INTEGER NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS idx_reviews_flagged ON reviews (flagged) WHERE flagged = TRUE;

-- ── COUPONS: featured offer + guest-email cap (035 / 013 / 021) ──────────────
ALTER TABLE coupons     ADD COLUMN IF NOT EXISTS is_featured          BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE coupons     ADD COLUMN IF NOT EXISTS guest_email_required boolean NOT NULL DEFAULT false;
ALTER TABLE coupon_uses ADD COLUMN IF NOT EXISTS guest_email          text;
CREATE INDEX IF NOT EXISTS idx_coupon_uses_guest
  ON coupon_uses (coupon_id, guest_email) WHERE guest_email IS NOT NULL;

-- ── USERS: 2FA TOTP (031) + accepted terms (012) ────────────────────────────
ALTER TABLE users ADD COLUMN IF NOT EXISTS totp_secret    text;
ALTER TABLE users ADD COLUMN IF NOT EXISTS totp_enabled   boolean NOT NULL DEFAULT false;
ALTER TABLE users ADD COLUMN IF NOT EXISTS accepted_terms boolean NOT NULL DEFAULT false;

-- ── ORDERS: launch-blocker payment status + COD refund tracking (032) ───────
ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_payment_status_check;
ALTER TABLE orders ADD CONSTRAINT orders_payment_status_check
  CHECK (payment_status IN ('pending','paid','failed','refunded','refund_pending'));
ALTER TABLE orders ADD COLUMN IF NOT EXISTS cod_refund_method text
  CHECK (cod_refund_method IN ('bank_transfer','upi','cash'));
ALTER TABLE orders ADD COLUMN IF NOT EXISTS cod_refund_reference text;
-- Guard column for the pending-payment WhatsApp reminder cron (038).
ALTER TABLE orders ADD COLUMN IF NOT EXISTS payment_reminder_sent boolean NOT NULL DEFAULT false;
CREATE INDEX IF NOT EXISTS idx_orders_pending_payment
  ON orders (payment_status, status, payment_method, created_at)
  WHERE payment_reminder_sent = false;

-- ── RETURNS: reverse logistics (031) ────────────────────────────────────────
ALTER TABLE returns ADD COLUMN IF NOT EXISTS return_awb                text;
ALTER TABLE returns ADD COLUMN IF NOT EXISTS shiprocket_reverse_status text;
ALTER TABLE returns ADD COLUMN IF NOT EXISTS quantity                  integer NOT NULL DEFAULT 1;
ALTER TABLE returns DROP CONSTRAINT IF EXISTS returns_status_check;
ALTER TABLE returns ADD CONSTRAINT returns_status_check
  CHECK (status IN ('requested','approved','rejected','received','refunded','completed',
                    'pickup_scheduled','picked_up','in_transit','pickup_failed'));
CREATE INDEX IF NOT EXISTS idx_returns_return_awb ON returns (return_awb) WHERE return_awb IS NOT NULL;

-- ── STORE SETTINGS: flash sale (031), low stock (015), live chat (019),
--    footer (022/023) ──────────────────────────────────────────────────────
ALTER TABLE store_settings ADD COLUMN IF NOT EXISTS flash_sale_enabled      boolean NOT NULL DEFAULT false;
ALTER TABLE store_settings ADD COLUMN IF NOT EXISTS flash_sale_end_time     text    NOT NULL DEFAULT '';
ALTER TABLE store_settings ADD COLUMN IF NOT EXISTS flash_sale_label        text    NOT NULL DEFAULT 'Flash Sale';
ALTER TABLE store_settings ADD COLUMN IF NOT EXISTS flash_sale_discount_pct integer NOT NULL DEFAULT 20;
ALTER TABLE store_settings ADD COLUMN IF NOT EXISTS flash_sale_coupon       text    NOT NULL DEFAULT '';
ALTER TABLE store_settings ADD COLUMN IF NOT EXISTS low_stock_threshold     integer DEFAULT 5;
ALTER TABLE store_settings ADD COLUMN IF NOT EXISTS live_chat_widget        text    DEFAULT '';
ALTER TABLE store_settings ADD COLUMN IF NOT EXISTS footer_tagline          text    NOT NULL DEFAULT 'Luxury Indian Fashion';
ALTER TABLE store_settings ADD COLUMN IF NOT EXISTS footer_copyright        text    NOT NULL DEFAULT '© 2026 KALOKEA. All rights reserved.';
ALTER TABLE store_settings ADD COLUMN IF NOT EXISTS footer_instagram_url    text    NOT NULL DEFAULT 'https://www.instagram.com/kalokea';
ALTER TABLE store_settings ADD COLUMN IF NOT EXISTS footer_whatsapp_url     text    NOT NULL DEFAULT 'https://wa.me/918799610432';
ALTER TABLE store_settings ADD COLUMN IF NOT EXISTS footer_facebook_url     text    NOT NULL DEFAULT 'https://www.facebook.com/kalokea.in';
ALTER TABLE store_settings ADD COLUMN IF NOT EXISTS footer_pinterest_url    text    NOT NULL DEFAULT 'https://www.pinterest.com/kalokea';

-- ── STOCK RESERVATIONS (008/031) + restock RPC ──────────────────────────────
CREATE TABLE IF NOT EXISTS stock_reservations (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id   uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  variant_id uuid NOT NULL REFERENCES product_variants(id) ON DELETE CASCADE,
  quantity   integer NOT NULL CHECK (quantity > 0),
  expires_at timestamptz NOT NULL,
  confirmed  boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_stock_res_order   ON stock_reservations (order_id);
CREATE INDEX IF NOT EXISTS idx_stock_res_variant ON stock_reservations (variant_id);
CREATE INDEX IF NOT EXISTS idx_stock_res_expires ON stock_reservations (expires_at) WHERE confirmed = false;

CREATE OR REPLACE FUNCTION restock_variant(p_variant_id uuid, p_qty integer)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  UPDATE product_variants SET stock = stock + p_qty WHERE id = p_variant_id;
END; $$;

-- ── STOCK NOTIFICATIONS (027/031/032) — supports BOTH `notified` and `sent` ──
CREATE TABLE IF NOT EXISTS stock_notifications (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  variant_id uuid NOT NULL REFERENCES product_variants(id) ON DELETE CASCADE,
  email      text NOT NULL,
  notified   boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE stock_notifications ADD COLUMN IF NOT EXISTS notified boolean NOT NULL DEFAULT false;
ALTER TABLE stock_notifications ADD COLUMN IF NOT EXISTS sent     boolean NOT NULL DEFAULT false;
ALTER TABLE stock_notifications ADD COLUMN IF NOT EXISTS sent_at  timestamptz;
CREATE INDEX IF NOT EXISTS idx_stock_notif_variant ON stock_notifications (variant_id) WHERE notified = false;
CREATE UNIQUE INDEX IF NOT EXISTS uq_stock_notif_email ON stock_notifications (variant_id, email) WHERE notified = false;

-- ── NEWSLETTER CAMPAIGNS (029) + email_log extras ───────────────────────────
CREATE TABLE IF NOT EXISTS newsletter_campaigns (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subject         text NOT NULL,
  body_html       text NOT NULL,
  preview_text    text,
  recipient_count integer NOT NULL DEFAULT 0,
  sent_count      integer NOT NULL DEFAULT 0,
  failed_count    integer NOT NULL DEFAULT 0,
  status          text NOT NULL DEFAULT 'sending' CHECK (status IN ('draft','sending','sent','failed')),
  sent_at         timestamptz NOT NULL DEFAULT now(),
  created_at      timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE newsletter_campaigns ADD COLUMN IF NOT EXISTS preview_text    text;
ALTER TABLE newsletter_campaigns ADD COLUMN IF NOT EXISTS recipient_count integer NOT NULL DEFAULT 0;
ALTER TABLE newsletter_campaigns ADD COLUMN IF NOT EXISTS failed_count    integer NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS idx_newsletter_campaigns_sent_at ON newsletter_campaigns (sent_at DESC);

ALTER TABLE email_log ADD COLUMN IF NOT EXISTS retry_count integer NOT NULL DEFAULT 0;
ALTER TABLE email_log ADD COLUMN IF NOT EXISTS metadata    jsonb;
ALTER TABLE email_log ADD COLUMN IF NOT EXISTS body_html   text;

-- ── SITE CONTENT table (026) ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS site_content (
  key        text PRIMARY KEY,
  value      text NOT NULL DEFAULT '',
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- ── FORCE UNBOUNDED TEXT on editable content columns (036) ───────────────────
-- Fixes "only part of my Terms/long content saves". USING ::text makes the cast
-- safe whether the column is currently varchar(N), text, or jsonb.
ALTER TABLE cms_pages        ALTER COLUMN content          TYPE TEXT USING content::text;
ALTER TABLE cms_pages        ALTER COLUMN meta_description TYPE TEXT USING meta_description::text;
ALTER TABLE homepage_content ALTER COLUMN value            TYPE TEXT USING value::text;
ALTER TABLE site_content     ALTER COLUMN value            TYPE TEXT USING value::text;

-- ── GRANTS (PostgREST uses service_role) + reload schema cache ───────────────
GRANT ALL ON ALL TABLES    IN SCHEMA public TO service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO service_role;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO service_role;

COMMIT;

-- Tell PostgREST to pick up the new columns immediately (must be outside the txn).
NOTIFY pgrst, 'reload schema';
