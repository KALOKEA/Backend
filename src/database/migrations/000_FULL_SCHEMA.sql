-- =============================================================================
-- KALOKEA — 000_FULL_SCHEMA.sql
-- Master migration file: runs ALL migrations 001–026 in one shot.
-- 100% idempotent — safe to run on an existing DB or a brand-new one.
-- Use this for: fresh Supabase projects, disaster recovery, environment cloning.
--
-- HOW TO RUN:
--   Supabase dashboard → SQL Editor → paste this file → Run
--   (or: psql -U postgres -d postgres -f 000_FULL_SCHEMA.sql)
-- =============================================================================




-- ═══════════════════════════════════════════════════════════════════════════
-- SECTION 001 — Initial schema
-- ═══════════════════════════════════════════════════════════════════════════

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- users
CREATE TABLE IF NOT EXISTS users (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text,
  email       text UNIQUE,
  phone       text UNIQUE,
  role        text NOT NULL DEFAULT 'customer' CHECK (role IN ('customer', 'admin')),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT users_email_or_phone CHECK (email IS NOT NULL OR phone IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS idx_users_phone ON users (phone);
CREATE INDEX IF NOT EXISTS idx_users_email ON users (email);
DROP TRIGGER IF EXISTS trg_users_updated_at ON users;
CREATE TRIGGER trg_users_updated_at BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- otp_sessions
CREATE TABLE IF NOT EXISTS otp_sessions (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  identifier  text NOT NULL,
  otp_hash    text NOT NULL,
  used        boolean NOT NULL DEFAULT false,
  expires_at  timestamptz NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_otp_identifier ON otp_sessions (identifier);
CREATE INDEX IF NOT EXISTS idx_otp_expires_at ON otp_sessions (expires_at);

-- categories
CREATE TABLE IF NOT EXISTS categories (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL,
  slug        text NOT NULL UNIQUE,
  parent_id   uuid REFERENCES categories(id) ON DELETE SET NULL,
  image_url   text,
  is_active   boolean NOT NULL DEFAULT true,
  sort_order  integer NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_categories_slug   ON categories (slug);
CREATE INDEX IF NOT EXISTS idx_categories_parent ON categories (parent_id);

-- products
CREATE TABLE IF NOT EXISTS products (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name             text NOT NULL,
  slug             text NOT NULL UNIQUE,
  description      text,
  category_id      uuid REFERENCES categories(id) ON DELETE SET NULL,
  base_price       numeric(10,2) NOT NULL DEFAULT 0,
  compare_price    numeric(10,2),
  is_active        boolean NOT NULL DEFAULT true,
  is_featured      boolean NOT NULL DEFAULT false,
  tags             text[] NOT NULL DEFAULT '{}',
  meta_title       text,
  meta_description text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_products_slug        ON products (slug);
CREATE INDEX IF NOT EXISTS idx_products_category    ON products (category_id);
CREATE INDEX IF NOT EXISTS idx_products_is_active   ON products (is_active);
CREATE INDEX IF NOT EXISTS idx_products_is_featured ON products (is_featured);
CREATE INDEX IF NOT EXISTS idx_products_base_price  ON products (base_price);
DROP TRIGGER IF EXISTS trg_products_updated_at ON products;
CREATE TRIGGER trg_products_updated_at BEFORE UPDATE ON products
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- product_images
CREATE TABLE IF NOT EXISTS product_images (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id  uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  url         text NOT NULL,
  alt_text    text,
  is_primary  boolean NOT NULL DEFAULT false,
  sort_order  integer NOT NULL DEFAULT 0,
  public_id   text,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_product_images_product ON product_images (product_id);

-- product_variants
CREATE TABLE IF NOT EXISTS product_variants (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id  uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  size        text,
  colour      text,
  price       numeric(10,2) NOT NULL DEFAULT 0 CHECK (price >= 0),
  stock       integer NOT NULL DEFAULT 0 CHECK (stock >= 0),
  sku         text UNIQUE,
  is_active   boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_variants_product ON product_variants (product_id);
CREATE INDEX IF NOT EXISTS idx_variants_sku     ON product_variants (sku);
DROP TRIGGER IF EXISTS trg_variants_updated_at ON product_variants;
CREATE TRIGGER trg_variants_updated_at BEFORE UPDATE ON product_variants
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- carts
CREATE TABLE IF NOT EXISTS carts (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid REFERENCES users(id) ON DELETE CASCADE,
  session_id  text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT carts_owner CHECK (user_id IS NOT NULL OR session_id IS NOT NULL)
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_carts_user_id    ON carts (user_id)    WHERE user_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_carts_session_id ON carts (session_id) WHERE session_id IS NOT NULL AND user_id IS NULL;
DROP TRIGGER IF EXISTS trg_carts_updated_at ON carts;
CREATE TRIGGER trg_carts_updated_at BEFORE UPDATE ON carts
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- cart_items
CREATE TABLE IF NOT EXISTS cart_items (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cart_id     uuid NOT NULL REFERENCES carts(id) ON DELETE CASCADE,
  variant_id  uuid NOT NULL REFERENCES product_variants(id) ON DELETE CASCADE,
  quantity    integer NOT NULL DEFAULT 1 CHECK (quantity > 0),
  added_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_cart_items_cart_variant UNIQUE (cart_id, variant_id)
);
CREATE INDEX IF NOT EXISTS idx_cart_items_cart    ON cart_items (cart_id);
CREATE INDEX IF NOT EXISTS idx_cart_items_variant ON cart_items (variant_id);

-- addresses
CREATE TABLE IF NOT EXISTS addresses (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name        text NOT NULL,
  phone       text NOT NULL,
  line1       text NOT NULL,
  line2       text,
  city        text NOT NULL,
  state       text NOT NULL,
  pincode     text NOT NULL,
  is_default  boolean NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_addresses_user ON addresses (user_id);

-- coupons
CREATE TABLE IF NOT EXISTS coupons (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code             text NOT NULL UNIQUE,
  type             text NOT NULL CHECK (type IN ('percent', 'fixed')),
  value            numeric(10,2) NOT NULL CHECK (value >= 0),
  min_order_value  numeric(10,2) NOT NULL DEFAULT 0,
  max_uses         integer,
  used_count       integer NOT NULL DEFAULT 0,
  valid_from       timestamptz,
  valid_until      timestamptz,
  is_active        boolean NOT NULL DEFAULT true,
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_coupons_code ON coupons (code);

-- orders
CREATE TABLE IF NOT EXISTS orders (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_number         text NOT NULL UNIQUE,
  user_id              uuid REFERENCES users(id) ON DELETE SET NULL,
  guest_phone          text,
  guest_email          text,
  subtotal             numeric(10,2) NOT NULL DEFAULT 0,
  shipping             numeric(10,2) NOT NULL DEFAULT 0,
  discount             numeric(10,2) NOT NULL DEFAULT 0,
  total                numeric(10,2) NOT NULL DEFAULT 0,
  address_snapshot     jsonb NOT NULL,
  payment_method       text NOT NULL CHECK (payment_method IN ('razorpay', 'cod')),
  payment_status       text NOT NULL DEFAULT 'pending' CHECK (payment_status IN ('pending', 'paid', 'failed', 'refunded')),
  status               text NOT NULL DEFAULT 'pending'
                         CHECK (status IN ('pending', 'confirmed', 'processing', 'shipped', 'delivered', 'cancelled', 'refunded')),
  coupon_id            uuid REFERENCES coupons(id) ON DELETE SET NULL,
  coupon_code          text,
  razorpay_order_id    text,
  razorpay_payment_id  text,
  tracking_number      text,
  courier_name         text,
  notes                text,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_orders_user           ON orders (user_id);
CREATE INDEX IF NOT EXISTS idx_orders_order_number   ON orders (order_number);
CREATE INDEX IF NOT EXISTS idx_orders_razorpay_order ON orders (razorpay_order_id);
CREATE INDEX IF NOT EXISTS idx_orders_status         ON orders (status);
CREATE INDEX IF NOT EXISTS idx_orders_payment_status ON orders (payment_status);
CREATE INDEX IF NOT EXISTS idx_orders_created_at     ON orders (created_at);
DROP TRIGGER IF EXISTS trg_orders_updated_at ON orders;
CREATE TRIGGER trg_orders_updated_at BEFORE UPDATE ON orders
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- order_items
CREATE TABLE IF NOT EXISTS order_items (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id           uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  variant_id         uuid REFERENCES product_variants(id) ON DELETE SET NULL,
  snapshot_name      text NOT NULL,
  snapshot_sku       text,
  snapshot_size      text,
  snapshot_colour    text,
  snapshot_price     numeric(10,2) NOT NULL DEFAULT 0,
  snapshot_image_url text,
  quantity           integer NOT NULL DEFAULT 1 CHECK (quantity > 0),
  created_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_order_items_order   ON order_items (order_id);
CREATE INDEX IF NOT EXISTS idx_order_items_variant ON order_items (variant_id);

-- coupon_uses
CREATE TABLE IF NOT EXISTS coupon_uses (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  coupon_id   uuid NOT NULL REFERENCES coupons(id) ON DELETE CASCADE,
  user_id     uuid REFERENCES users(id) ON DELETE SET NULL,
  order_id    uuid REFERENCES orders(id) ON DELETE CASCADE,
  used_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_coupon_uses_coupon ON coupon_uses (coupon_id);
CREATE INDEX IF NOT EXISTS idx_coupon_uses_user   ON coupon_uses (user_id);

-- reviews
CREATE TABLE IF NOT EXISTS reviews (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id   uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  user_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  order_id     uuid REFERENCES orders(id) ON DELETE SET NULL,
  rating       integer NOT NULL CHECK (rating BETWEEN 1 AND 5),
  title        text,
  body         text,
  is_approved  boolean NOT NULL DEFAULT false,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_reviews_product  ON reviews (product_id);
CREATE INDEX IF NOT EXISTS idx_reviews_user     ON reviews (user_id);
CREATE INDEX IF NOT EXISTS idx_reviews_approved ON reviews (is_approved);

-- wishlists
CREATE TABLE IF NOT EXISTS wishlists (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  product_id  uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  added_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_wishlists_user_product UNIQUE (user_id, product_id)
);
CREATE INDEX IF NOT EXISTS idx_wishlists_user ON wishlists (user_id);

-- banners
CREATE TABLE IF NOT EXISTS banners (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title       text NOT NULL,
  image_url   text NOT NULL,
  link_url    text,
  position    text NOT NULL CHECK (position IN ('hero', 'mid', 'footer')),
  is_active   boolean NOT NULL DEFAULT true,
  sort_order  integer NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_banners_position ON banners (position);

-- returns
CREATE TABLE IF NOT EXISTS returns (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id       uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  order_item_id  uuid REFERENCES order_items(id) ON DELETE SET NULL,
  user_id        uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reason         text NOT NULL,
  status         text NOT NULL DEFAULT 'requested'
                   CHECK (status IN ('requested', 'approved', 'rejected', 'received', 'refunded', 'completed')),
  admin_notes    text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_returns_order ON returns (order_id);
CREATE INDEX IF NOT EXISTS idx_returns_user  ON returns (user_id);
DROP TRIGGER IF EXISTS trg_returns_updated_at ON returns;
CREATE TRIGGER trg_returns_updated_at BEFORE UPDATE ON returns
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- newsletter_subscribers
CREATE TABLE IF NOT EXISTS newsletter_subscribers (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email       text NOT NULL UNIQUE,
  is_active   boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- admin_activity_log
CREATE TABLE IF NOT EXISTS admin_activity_log (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id     uuid REFERENCES users(id) ON DELETE SET NULL,
  action       text NOT NULL,
  entity_type  text,
  entity_id    text,
  details      jsonb,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_admin_log_admin   ON admin_activity_log (admin_id);
CREATE INDEX IF NOT EXISTS idx_admin_log_created ON admin_activity_log (created_at);

-- RLS: enable on all tables (service_role bypasses; anon/authed keys get no direct access)
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'users','otp_sessions','categories','products','product_images',
    'product_variants','carts','cart_items','addresses','coupons','orders',
    'order_items','coupon_uses','reviews','wishlists','banners','returns',
    'newsletter_subscribers','admin_activity_log'
  ]
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY;', t);
  END LOOP;
END $$;

GRANT USAGE ON SCHEMA public TO service_role;
GRANT ALL ON ALL TABLES    IN SCHEMA public TO service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO service_role;
GRANT ALL ON ALL FUNCTIONS IN SCHEMA public TO service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES    TO service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON FUNCTIONS TO service_role;


-- ═══════════════════════════════════════════════════════════════════════════
-- SECTION 002 — Refresh-token revocation (token_version)
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE users ADD COLUMN IF NOT EXISTS token_version integer NOT NULL DEFAULT 0;


-- ═══════════════════════════════════════════════════════════════════════════
-- SECTION 003 — OTP per-session attempt lock
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE otp_sessions ADD COLUMN IF NOT EXISTS attempts integer NOT NULL DEFAULT 0;


-- ═══════════════════════════════════════════════════════════════════════════
-- SECTION 004 — Store settings (singleton row)
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS store_settings (
  id                  integer PRIMARY KEY DEFAULT 1,
  seller_name         text    NOT NULL DEFAULT 'KALOKEA',
  seller_address      text    NOT NULL DEFAULT '',
  seller_gstin        text    NOT NULL DEFAULT '',
  seller_state        text    NOT NULL DEFAULT '',
  gst_rate            numeric NOT NULL DEFAULT 5,
  admin_email         text    NOT NULL DEFAULT '',
  updated_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT store_settings_singleton CHECK (id = 1)
);
INSERT INTO store_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;
GRANT ALL ON store_settings TO service_role;


-- ═══════════════════════════════════════════════════════════════════════════
-- SECTION 005 — GST: per-product HSN, order GST columns, gst_ledger, exchanges
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE products ADD COLUMN IF NOT EXISTS hsn_code text;
ALTER TABLE products ADD COLUMN IF NOT EXISTS gst_rate numeric;

ALTER TABLE orders ADD COLUMN IF NOT EXISTS place_of_supply  text;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS is_intra_state   boolean;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS taxable_value    numeric(10,2) NOT NULL DEFAULT 0;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS cgst             numeric(10,2) NOT NULL DEFAULT 0;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS sgst             numeric(10,2) NOT NULL DEFAULT 0;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS igst             numeric(10,2) NOT NULL DEFAULT 0;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS total_gst        numeric(10,2) NOT NULL DEFAULT 0;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS gstin            text;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS company_name     text;

ALTER TABLE order_items ADD COLUMN IF NOT EXISTS hsn_code       text;
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS gst_rate       numeric NOT NULL DEFAULT 0;
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS taxable_value  numeric(10,2) NOT NULL DEFAULT 0;
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS gst_amount     numeric(10,2) NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS gst_ledger (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  txn_type        text NOT NULL CHECK (txn_type IN ('sale', 'return', 'exchange')),
  txn_date        timestamptz NOT NULL DEFAULT now(),
  order_id        uuid REFERENCES orders(id)       ON DELETE SET NULL,
  order_item_id   uuid REFERENCES order_items(id)  ON DELETE SET NULL,
  return_id       uuid,
  exchange_id     uuid,
  order_number    text,
  hsn_code        text,
  description     text,
  quantity        integer NOT NULL DEFAULT 0,
  gst_rate        numeric NOT NULL DEFAULT 0,
  place_of_supply text,
  is_intra_state  boolean NOT NULL DEFAULT true,
  taxable_value   numeric(12,2) NOT NULL DEFAULT 0,
  cgst            numeric(12,2) NOT NULL DEFAULT 0,
  sgst            numeric(12,2) NOT NULL DEFAULT 0,
  igst            numeric(12,2) NOT NULL DEFAULT 0,
  total_gst       numeric(12,2) NOT NULL DEFAULT 0,
  gross           numeric(12,2) NOT NULL DEFAULT 0,
  customer_name   text,
  customer_gstin  text,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_gst_ledger_txn_date ON gst_ledger (txn_date);
CREATE INDEX IF NOT EXISTS idx_gst_ledger_type     ON gst_ledger (txn_type);
CREATE INDEX IF NOT EXISTS idx_gst_ledger_order    ON gst_ledger (order_id);
CREATE INDEX IF NOT EXISTS idx_gst_ledger_rate     ON gst_ledger (gst_rate);
CREATE UNIQUE INDEX IF NOT EXISTS uq_gst_ledger_sale   ON gst_ledger (order_item_id) WHERE txn_type = 'sale';
CREATE UNIQUE INDEX IF NOT EXISTS uq_gst_ledger_return ON gst_ledger (return_id)     WHERE txn_type = 'return';

CREATE TABLE IF NOT EXISTS exchanges (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id            uuid NOT NULL REFERENCES orders(id)            ON DELETE CASCADE,
  order_item_id       uuid NOT NULL REFERENCES order_items(id)       ON DELETE CASCADE,
  user_id             uuid REFERENCES users(id)                      ON DELETE SET NULL,
  new_variant_id      uuid REFERENCES product_variants(id)           ON DELETE SET NULL,
  reason              text NOT NULL,
  status              text NOT NULL DEFAULT 'requested'
                        CHECK (status IN ('requested', 'approved', 'rejected', 'completed')),
  original_price      numeric(10,2) NOT NULL DEFAULT 0,
  new_price           numeric(10,2) NOT NULL DEFAULT 0,
  price_difference    numeric(10,2) NOT NULL DEFAULT 0,
  gst_difference      numeric(10,2) NOT NULL DEFAULT 0,
  new_snapshot_name   text,
  new_snapshot_size   text,
  new_snapshot_colour text,
  admin_notes         text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_exchanges_order ON exchanges (order_id);
CREATE INDEX IF NOT EXISTS idx_exchanges_user  ON exchanges (user_id);
DROP TRIGGER IF EXISTS trg_exchanges_updated_at ON exchanges;
CREATE TRIGGER trg_exchanges_updated_at BEFORE UPDATE ON exchanges
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

GRANT ALL ON gst_ledger TO service_role;
GRANT ALL ON exchanges  TO service_role;


-- ═══════════════════════════════════════════════════════════════════════════
-- SECTION 006 — Atomic operations (decrement_stock, restock_variant)
-- Note: redeem_coupon is defined in section 021 with the final 4-arg signature
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION decrement_stock(p_variant_id uuid, p_qty integer)
RETURNS boolean LANGUAGE plpgsql AS $$
DECLARE affected integer;
BEGIN
  UPDATE product_variants SET stock = stock - p_qty
  WHERE id = p_variant_id AND stock >= p_qty;
  GET DIAGNOSTICS affected = ROW_COUNT;
  RETURN affected > 0;
END;
$$;

CREATE OR REPLACE FUNCTION restock_variant(p_variant_id uuid, p_qty integer)
RETURNS void LANGUAGE sql AS $$
  UPDATE product_variants SET stock = stock + p_qty WHERE id = p_variant_id;
$$;

GRANT EXECUTE ON FUNCTION decrement_stock(uuid, integer) TO service_role;
GRANT EXECUTE ON FUNCTION restock_variant(uuid, integer) TO service_role;


-- ═══════════════════════════════════════════════════════════════════════════
-- SECTION 007 — Shipping + COD fee settings
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE store_settings ADD COLUMN IF NOT EXISTS shipping_fee            integer NOT NULL DEFAULT 4900;
ALTER TABLE store_settings ADD COLUMN IF NOT EXISTS shipping_free_threshold integer NOT NULL DEFAULT 99900;
ALTER TABLE store_settings ADD COLUMN IF NOT EXISTS cod_fee                 integer NOT NULL DEFAULT 4900;
GRANT ALL ON store_settings TO service_role;


-- ═══════════════════════════════════════════════════════════════════════════
-- SECTION 008 — Stock reservations (Razorpay race fix)
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS stock_reservations (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id    uuid NOT NULL REFERENCES orders(id)            ON DELETE CASCADE,
  variant_id  uuid NOT NULL REFERENCES product_variants(id)  ON DELETE CASCADE,
  quantity    integer NOT NULL CHECK (quantity > 0),
  expires_at  timestamptz NOT NULL DEFAULT (now() + interval '15 minutes'),
  confirmed   boolean NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_stock_reservations_order   ON stock_reservations (order_id);
CREATE INDEX IF NOT EXISTS idx_stock_reservations_variant ON stock_reservations (variant_id);
CREATE INDEX IF NOT EXISTS idx_stock_reservations_expires ON stock_reservations (expires_at) WHERE confirmed = false;
ALTER TABLE stock_reservations ENABLE ROW LEVEL SECURITY;
GRANT ALL ON stock_reservations TO service_role;

CREATE OR REPLACE FUNCTION get_soft_reserved(p_variant_id uuid)
RETURNS integer LANGUAGE sql STABLE AS $$
  SELECT COALESCE(SUM(quantity), 0)::integer
  FROM stock_reservations
  WHERE variant_id = p_variant_id AND confirmed = false AND expires_at > now();
$$;

CREATE OR REPLACE FUNCTION expire_stock_reservations()
RETURNS integer LANGUAGE plpgsql AS $$
DECLARE deleted integer;
BEGIN
  DELETE FROM stock_reservations WHERE confirmed = false AND expires_at <= now();
  GET DIAGNOSTICS deleted = ROW_COUNT;
  RETURN deleted;
END;
$$;

GRANT EXECUTE ON FUNCTION get_soft_reserved(uuid)         TO service_role;
GRANT EXECUTE ON FUNCTION expire_stock_reservations()     TO service_role;


-- ═══════════════════════════════════════════════════════════════════════════
-- SECTION 009 — Product video URL
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE products ADD COLUMN IF NOT EXISTS video_url TEXT;
GRANT ALL ON products TO service_role;


-- ═══════════════════════════════════════════════════════════════════════════
-- SECTION 010 — Homepage content key-value store
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS homepage_content (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL DEFAULT '',
  updated_at TIMESTAMPTZ DEFAULT now()
);

INSERT INTO homepage_content (key, value) VALUES
  ('hero_eyebrow',    'NEW COLLECTION — 2026'),
  ('hero_headline_1', 'Dressed for'),
  ('hero_headline_2', 'Every Moment'),
  ('hero_subtext',    'Timeless silhouettes, curated fabrics — pieces that move with you, season after season.'),
  ('hero_cta1_label', 'Shop Collection'),
  ('hero_cta1_link',  '/shop'),
  ('hero_cta2_label', 'New Arrivals'),
  ('hero_cta2_link',  '/shop?tag=new-arrivals'),
  ('hero_image_url',  'https://images.unsplash.com/photo-1469334031218-e382a71b716b?w=1400&q=90&fit=crop&crop=top'),
  ('hero_video_url',  ''),
  ('hero_mode',       'image'),
  ('trust_1_title',              'Free Delivery'),
  ('trust_1_sub',                'On orders above ₹999'),
  ('trust_2_title',              'Easy Returns'),
  ('trust_2_sub',                '7-day hassle-free returns'),
  ('trust_3_title',              'Secure Payments'),
  ('trust_3_sub',                'Razorpay 256-bit encrypted'),
  ('trust_4_title',              'Made in India'),
  ('trust_4_sub',                'Proudly designed & sourced'),
  ('newsletter_heading',         'Join the Kalokea Family'),
  ('newsletter_subtext',         'Get early access to new arrivals, exclusive offers, and style inspiration straight to your inbox.'),
  ('featured_section_heading',   'Featured Pieces')
ON CONFLICT (key) DO NOTHING;

GRANT ALL ON homepage_content TO service_role;


-- ═══════════════════════════════════════════════════════════════════════════
-- SECTION 011 — Review media attachments + product rating cache
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE reviews  ADD COLUMN IF NOT EXISTS media_urls   TEXT[] DEFAULT '{}';
ALTER TABLE products ADD COLUMN IF NOT EXISTS avg_rating   NUMERIC(3,1);
ALTER TABLE products ADD COLUMN IF NOT EXISTS review_count INTEGER NOT NULL DEFAULT 0;
GRANT ALL ON reviews  TO service_role;
GRANT ALL ON products TO service_role;


-- ═══════════════════════════════════════════════════════════════════════════
-- SECTION 012 — accepted_terms column on users
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE users ADD COLUMN IF NOT EXISTS accepted_terms BOOLEAN NOT NULL DEFAULT false;
GRANT ALL ON users TO service_role;


-- ═══════════════════════════════════════════════════════════════════════════
-- SECTION 013 — Per-user coupon redemption cap
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE coupons ADD COLUMN IF NOT EXISTS max_per_user INTEGER DEFAULT NULL
  CHECK (max_per_user IS NULL OR max_per_user >= 1);


-- ═══════════════════════════════════════════════════════════════════════════
-- SECTION 014 — orders.fulfillment_status
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE orders ADD COLUMN IF NOT EXISTS fulfillment_status TEXT DEFAULT 'pending'
  CHECK (fulfillment_status IN ('pending', 'processing', 'shipped', 'delivered', 'cancelled'));

UPDATE orders
  SET fulfillment_status = CASE
    WHEN status IN ('shipped', 'delivered', 'cancelled') THEN status
    ELSE 'pending'
  END
WHERE fulfillment_status IS NULL OR fulfillment_status = 'pending';


-- ═══════════════════════════════════════════════════════════════════════════
-- SECTION 015 — low_stock_threshold in store_settings
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE store_settings ADD COLUMN IF NOT EXISTS low_stock_threshold INTEGER DEFAULT 5
  CHECK (low_stock_threshold >= 1);


-- ═══════════════════════════════════════════════════════════════════════════
-- SECTION 016 — Email delivery log
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS email_log (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  recipient     TEXT NOT NULL,
  subject       TEXT NOT NULL,
  email_type    TEXT NOT NULL DEFAULT 'unknown',
  status        TEXT NOT NULL DEFAULT 'sent'
                  CHECK (status IN ('sent', 'failed', 'retried_ok', 'retried_fail')),
  error_message TEXT,
  retry_count   SMALLINT NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS email_log_recipient_idx  ON email_log (recipient);
CREATE INDEX IF NOT EXISTS email_log_type_idx       ON email_log (email_type);
CREATE INDEX IF NOT EXISTS email_log_status_idx     ON email_log (status);
CREATE INDEX IF NOT EXISTS email_log_created_at_idx ON email_log (created_at DESC);
GRANT INSERT, SELECT ON email_log TO service_role;


-- ═══════════════════════════════════════════════════════════════════════════
-- SECTION 017 — ShipRocket columns on orders
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE orders ADD COLUMN IF NOT EXISTS shiprocket_order_id    BIGINT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS shiprocket_shipment_id BIGINT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS awb_code               TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS courier_id             INTEGER;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS label_url              TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS shiprocket_status      TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS pickup_scheduled_at    TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS idx_orders_awb_code           ON orders (awb_code)           WHERE awb_code IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_orders_shiprocket_order_id ON orders (shiprocket_order_id) WHERE shiprocket_order_id IS NOT NULL;


-- ═══════════════════════════════════════════════════════════════════════════
-- SECTION 018 — CMS pages
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS cms_pages (
  slug             TEXT PRIMARY KEY,
  title            TEXT NOT NULL,
  content          TEXT NOT NULL DEFAULT '',
  meta_description TEXT,
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
GRANT ALL ON TABLE cms_pages TO service_role;

INSERT INTO cms_pages (slug, title, content, meta_description) VALUES
(
  'about', 'About Us',
  '<p>Kalokea was born from a simple belief: every woman deserves to wear something that makes her feel seen, celebrated, and entirely herself.</p>',
  'Kalokea is a women''s fashion brand celebrating confidence, elegance, and individuality.'
),
(
  'contact', 'Contact Us',
  '<p>We''d love to hear from you. <strong>Email:</strong> support@kalokea.in &nbsp; <strong>Phone:</strong> +91 87996 10432</p>',
  'Contact Kalokea — we are here to help with your orders, returns, and any questions.'
),
(
  'privacy-policy', 'Privacy Policy',
  '<p><em>Last updated: June 2025</em></p><h2>Information We Collect</h2><p>We collect information you provide when placing orders and usage data to improve our services.</p><h2>Data Security</h2><p>Payment data is handled securely by Razorpay and never stored on our servers.</p>',
  'How Kalokea collects, uses, and protects your personal information.'
),
(
  'refund-policy', 'Refund & Return Policy',
  '<p><em>Last updated: June 2025</em></p><h2>Return Window</h2><p>We accept returns within <strong>7 days</strong> of delivery for eligible items.</p><h2>Refund Timeline</h2><p>Refunds are processed within <strong>5–7 business days</strong> after we receive the item.</p>',
  'Kalokea refund and return policy — 7-day returns on eligible items.'
),
(
  'shipping-policy', 'Shipping Policy',
  '<p><em>Last updated: June 2025</em></p><h2>Delivery Time</h2><p>Orders dispatched within <strong>1–2 business days</strong>. Standard delivery takes <strong>3–7 business days</strong>.</p><h2>Free Shipping</h2><p>Free shipping on orders above ₹999.</p>',
  'Kalokea shipping policy — delivery times, free shipping threshold, and tracking.'
),
(
  'terms', 'Terms & Conditions',
  '<p><em>Last updated: June 2025</em></p><h2>Acceptance of Terms</h2><p>By using Kalokea, you agree to these terms.</p><h2>Governing Law</h2><p>These terms are governed by the laws of India. Disputes subject to jurisdiction of courts in Ahmedabad, Gujarat.</p>',
  'Terms and conditions for using Kalokea — the women''s fashion store.'
)
ON CONFLICT (slug) DO NOTHING;


-- ═══════════════════════════════════════════════════════════════════════════
-- SECTION 019 — live_chat_widget in store_settings
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE store_settings ADD COLUMN IF NOT EXISTS live_chat_widget TEXT DEFAULT '';
GRANT ALL ON TABLE store_settings TO service_role;


-- ═══════════════════════════════════════════════════════════════════════════
-- SECTION 020 — Packaging profiles + NDR tracking
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS packaging_profiles (
  id         SERIAL PRIMARY KEY,
  name       TEXT NOT NULL,
  weight     NUMERIC(8,2) NOT NULL DEFAULT 0.5,
  length     NUMERIC(8,2) NOT NULL DEFAULT 10,
  breadth    NUMERIC(8,2) NOT NULL DEFAULT 10,
  height     NUMERIC(8,2) NOT NULL DEFAULT 10,
  is_default BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE orders ADD COLUMN IF NOT EXISTS ndr_reason         TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS ndr_action         TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS tracking_synced_at TIMESTAMPTZ;

GRANT ALL ON TABLE packaging_profiles TO service_role;
GRANT USAGE, SELECT ON SEQUENCE packaging_profiles_id_seq TO service_role;
GRANT ALL ON TABLE orders TO service_role;

INSERT INTO packaging_profiles (name, weight, length, breadth, height, is_default) VALUES
  ('Small Packet', 0.3, 15, 12, 5,  false),
  ('Standard Box', 0.5, 25, 20, 10, true)
ON CONFLICT DO NOTHING;


-- ═══════════════════════════════════════════════════════════════════════════
-- SECTION 021a — Coupon guest-email support + final redeem_coupon (4-arg)
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE coupon_uses ADD COLUMN IF NOT EXISTS guest_email text;

-- Drop any old 3-arg version before creating the canonical 4-arg version
DROP FUNCTION IF EXISTS redeem_coupon(uuid, uuid, uuid);

CREATE OR REPLACE FUNCTION redeem_coupon(
  p_coupon_id   uuid,
  p_order_id    uuid,
  p_user_id     uuid,
  p_guest_email text DEFAULT NULL
)
RETURNS boolean LANGUAGE plpgsql AS $$
DECLARE affected integer;
BEGIN
  UPDATE coupons SET used_count = used_count + 1
  WHERE id = p_coupon_id AND (max_uses IS NULL OR used_count < max_uses);
  GET DIAGNOSTICS affected = ROW_COUNT;
  IF affected = 0 THEN RETURN false; END IF;
  INSERT INTO coupon_uses (coupon_id, order_id, user_id, guest_email)
  VALUES (p_coupon_id, p_order_id, p_user_id, lower(p_guest_email));
  RETURN true;
END;
$$;

GRANT EXECUTE ON FUNCTION redeem_coupon(uuid, uuid, uuid, text) TO service_role;

CREATE INDEX IF NOT EXISTS idx_coupon_uses_guest_email
  ON coupon_uses (coupon_id, guest_email)
  WHERE guest_email IS NOT NULL;


-- ═══════════════════════════════════════════════════════════════════════════
-- SECTION 021b — sort_weight for Best Sellers ordering
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE products ADD COLUMN IF NOT EXISTS sort_weight INTEGER NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS idx_products_sort_weight ON products (sort_weight DESC);


-- ═══════════════════════════════════════════════════════════════════════════
-- SECTION 022 — Footer brand settings (Instagram, WhatsApp)
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE store_settings
  ADD COLUMN IF NOT EXISTS footer_instagram_url TEXT NOT NULL DEFAULT 'https://www.instagram.com/kalokea.fashion',
  ADD COLUMN IF NOT EXISTS footer_whatsapp_url  TEXT NOT NULL DEFAULT 'https://wa.me/918799610432';
GRANT ALL ON TABLE store_settings TO service_role;


-- ═══════════════════════════════════════════════════════════════════════════
-- SECTION 023 — Footer Facebook + Pinterest URLs
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE store_settings
  ADD COLUMN IF NOT EXISTS footer_facebook_url  TEXT NOT NULL DEFAULT 'https://www.facebook.com/kalokea.in',
  ADD COLUMN IF NOT EXISTS footer_pinterest_url TEXT NOT NULL DEFAULT 'https://www.pinterest.com/kalokea';
GRANT ALL ON TABLE store_settings TO service_role;


-- ═══════════════════════════════════════════════════════════════════════════
-- SECTION 024 — Fabric & care instructions on products
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE products ADD COLUMN IF NOT EXISTS fabric_care TEXT;


-- ═══════════════════════════════════════════════════════════════════════════
-- SECTION 025 — Performance indexes
-- ═══════════════════════════════════════════════════════════════════════════

CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS idx_products_name_trgm
  ON products USING GIN (name gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_orders_guest_email
  ON orders (guest_email)
  WHERE guest_email IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_variants_is_active
  ON product_variants (product_id, is_active)
  WHERE is_active = true;

CREATE INDEX IF NOT EXISTS idx_orders_status_created
  ON orders (status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_order_items_variant_order
  ON order_items (variant_id, order_id);

CREATE INDEX IF NOT EXISTS idx_email_log_recipient_created
  ON email_log (recipient, created_at DESC);


-- ═══════════════════════════════════════════════════════════════════════════
-- SECTION 026 — Site content key-value store (About page + Footer columns)
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS site_content (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL DEFAULT '',
  updated_at TIMESTAMPTZ DEFAULT now()
);

INSERT INTO site_content (key, value) VALUES
  ('about_hero',
   '{"eyebrow":"Our Story","headline":"Fashion That","headline_italic":"Tells Your Story","subtext":"KALOKEA was born from a simple belief: every Indian woman deserves fashion that is both beautiful and accessible. We blend global trends with local sensibilities to create pieces that feel both timeless and distinctly yours.","image_url":""}'),
  ('about_values',
   '[{"title":"Inclusive Beauty","desc":"We design for every body, every skin tone, every occasion. Fashion has no one-size-fits-all formula."},{"title":"Ethical Sourcing","desc":"Our fabrics are sourced from certified mills. Our artisans are paid fair wages. We believe fashion can be both beautiful and responsible."},{"title":"Sustainable Future","desc":"Packaging made from recycled materials. Carbon-neutral shipping by 2026. Fashion that respects the planet."}]'),
  ('about_stats',
   '[{"num":"50K+","label":"Happy Customers"},{"num":"500+","label":"Styles Available"},{"num":"4.8★","label":"Average Rating"},{"num":"28","label":"States Delivered"}]'),
  ('about_team',      '[]'),
  ('footer_shop_col',
   '[{"label":"New Arrivals","href":"/shop/new-arrivals/"},{"label":"Dresses","href":"/shop/dresses/"},{"label":"Tops & Blouses","href":"/shop/tops/"},{"label":"Skirts & Pants","href":"/shop/bottoms/"},{"label":"Shoes","href":"/shop/shoes/"},{"label":"Bags","href":"/shop/bags/"},{"label":"Accessories","href":"/shop/accessories/"},{"label":"Sale","href":"/shop/sale/"}]'),
  ('footer_help_col',
   '[{"label":"Contact Us","href":"/contact/"},{"label":"Size Guide","href":"/size-guide/"},{"label":"Track Order","href":"/track-order/"},{"label":"Shipping Info","href":"/shipping-policy/"},{"label":"Returns & Refunds","href":"/refund-policy/"},{"label":"My Orders","href":"/account/orders/"}]'),
  ('footer_company_col',
   '[{"label":"About Us","href":"/about/"},{"label":"Privacy Policy","href":"/privacy-policy/"},{"label":"Terms of Use","href":"/terms/"},{"label":"Careers","href":"/about/"},{"label":"Sustainability","href":"/about/"},{"label":"Press","href":"/about/"}]'),
  ('footer_legal_links',
   '[{"label":"Privacy","href":"/privacy-policy/"},{"label":"Terms","href":"/terms/"},{"label":"Refunds","href":"/refund-policy/"},{"label":"Shipping","href":"/shipping-policy/"}]'),
  ('footer_copyright', 'KALOKEA. All rights reserved.')
ON CONFLICT (key) DO NOTHING;

GRANT ALL ON site_content TO service_role;


-- ═══════════════════════════════════════════════════════════════════════════
-- Final: re-broadcast schema change to PostgREST
-- ═══════════════════════════════════════════════════════════════════════════

NOTIFY pgrst, 'reload schema';

-- =============================================================================
-- End of 000_FULL_SCHEMA.sql — all 26 migrations applied
-- =============================================================================
