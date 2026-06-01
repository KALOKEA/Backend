-- =============================================================================
-- KALOKEA — 001_initial_schema.sql
-- Full Postgres / Supabase schema for the Kalokea e-commerce backend.
--
-- Derived from the NestJS + Supabase code (every table/column below is
-- referenced by a service query or DTO). Backend connects with the
-- SERVICE_ROLE key, so RLS is bypassed at runtime — authorization is enforced
-- in application code. RLS is still ENABLED on every table (Supabase best
-- practice / lockdown for the anon + authenticated keys), and explicit GRANTs
-- to service_role are included because manual SQL migrations do NOT grant
-- table privileges automatically (otherwise the API returns 403).
--
-- Idempotent: safe to re-run. Run in the Supabase SQL editor or via psql.
-- =============================================================================

-- Extensions -----------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS "pgcrypto";   -- gen_random_uuid()

-- updated_at trigger helper ---------------------------------------------------
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- =============================================================================
-- 1. users
-- =============================================================================
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

-- =============================================================================
-- 2. otp_sessions
-- =============================================================================
CREATE TABLE IF NOT EXISTS otp_sessions (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  identifier  text NOT NULL,                    -- phone or email
  otp_hash    text NOT NULL,                    -- bcrypt hash of the 6-digit OTP
  used        boolean NOT NULL DEFAULT false,
  expires_at  timestamptz NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_otp_identifier ON otp_sessions (identifier);
CREATE INDEX IF NOT EXISTS idx_otp_expires_at ON otp_sessions (expires_at);

-- =============================================================================
-- 3. categories
-- =============================================================================
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

-- =============================================================================
-- 4. products
-- =============================================================================
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

-- =============================================================================
-- 5. product_images
-- =============================================================================
CREATE TABLE IF NOT EXISTS product_images (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id  uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  url         text NOT NULL,
  alt_text    text,
  is_primary  boolean NOT NULL DEFAULT false,
  sort_order  integer NOT NULL DEFAULT 0,
  public_id   text,                              -- Cloudinary public_id (for deletes)
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_product_images_product ON product_images (product_id);

-- =============================================================================
-- 6. product_variants
-- =============================================================================
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

-- =============================================================================
-- 7. carts
-- =============================================================================
CREATE TABLE IF NOT EXISTS carts (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid REFERENCES users(id) ON DELETE CASCADE,
  session_id  text,                              -- guest cart identifier
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT carts_owner CHECK (user_id IS NOT NULL OR session_id IS NOT NULL)
);
-- One cart per user, one cart per guest session.
CREATE UNIQUE INDEX IF NOT EXISTS uq_carts_user_id    ON carts (user_id)    WHERE user_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_carts_session_id ON carts (session_id) WHERE session_id IS NOT NULL AND user_id IS NULL;
DROP TRIGGER IF EXISTS trg_carts_updated_at ON carts;
CREATE TRIGGER trg_carts_updated_at BEFORE UPDATE ON carts
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- =============================================================================
-- 8. cart_items
-- =============================================================================
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

-- =============================================================================
-- 9. addresses
-- =============================================================================
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

-- =============================================================================
-- 10. coupons
-- =============================================================================
CREATE TABLE IF NOT EXISTS coupons (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code             text NOT NULL UNIQUE,
  type             text NOT NULL CHECK (type IN ('percent', 'fixed')),
  value            numeric(10,2) NOT NULL CHECK (value >= 0),
  min_order_value  numeric(10,2) NOT NULL DEFAULT 0,
  max_uses         integer,                       -- NULL = unlimited
  used_count       integer NOT NULL DEFAULT 0,
  valid_from       timestamptz,
  valid_until      timestamptz,
  is_active        boolean NOT NULL DEFAULT true,
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_coupons_code ON coupons (code);

-- =============================================================================
-- 11. orders
-- =============================================================================
CREATE TABLE IF NOT EXISTS orders (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_number         text NOT NULL UNIQUE,
  user_id              uuid REFERENCES users(id) ON DELETE SET NULL,
  guest_phone          text,
  guest_email          text,
  subtotal             numeric(10,2) NOT NULL DEFAULT 0,
  shipping             numeric(10,2) NOT NULL DEFAULT 0,   -- includes COD fee
  discount             numeric(10,2) NOT NULL DEFAULT 0,   -- coupon discount (blocker #3)
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

-- =============================================================================
-- 12. order_items
-- =============================================================================
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

-- =============================================================================
-- 13. coupon_uses  (one row per redemption — drives used_count + per-user caps)
-- =============================================================================
CREATE TABLE IF NOT EXISTS coupon_uses (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  coupon_id   uuid NOT NULL REFERENCES coupons(id) ON DELETE CASCADE,
  user_id     uuid REFERENCES users(id) ON DELETE SET NULL,
  order_id    uuid REFERENCES orders(id) ON DELETE CASCADE,
  used_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_coupon_uses_coupon ON coupon_uses (coupon_id);
CREATE INDEX IF NOT EXISTS idx_coupon_uses_user   ON coupon_uses (user_id);

-- =============================================================================
-- 14. reviews
-- =============================================================================
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

-- =============================================================================
-- 15. wishlists
-- =============================================================================
CREATE TABLE IF NOT EXISTS wishlists (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  product_id  uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  added_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_wishlists_user_product UNIQUE (user_id, product_id)
);
CREATE INDEX IF NOT EXISTS idx_wishlists_user ON wishlists (user_id);

-- =============================================================================
-- 16. banners
-- =============================================================================
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

-- =============================================================================
-- 17. returns
-- =============================================================================
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

-- =============================================================================
-- 18. newsletter_subscribers
-- =============================================================================
CREATE TABLE IF NOT EXISTS newsletter_subscribers (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email       text NOT NULL UNIQUE,
  is_active   boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- =============================================================================
-- 19. admin_activity_log
-- =============================================================================
CREATE TABLE IF NOT EXISTS admin_activity_log (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id     uuid REFERENCES users(id) ON DELETE SET NULL,
  action       text NOT NULL,                     -- e.g. 'product.update', 'order.ship'
  entity_type  text,                              -- e.g. 'product', 'order'
  entity_id    text,
  details      jsonb,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_admin_log_admin   ON admin_activity_log (admin_id);
CREATE INDEX IF NOT EXISTS idx_admin_log_created ON admin_activity_log (created_at);

-- =============================================================================
-- Row Level Security
-- The backend uses the SERVICE_ROLE key which BYPASSES RLS. We enable RLS on
-- every table (so the anon / authenticated keys have NO direct access) and add
-- no permissive policies. All access goes through the NestJS API, which
-- enforces authorization in code.
-- =============================================================================
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

-- =============================================================================
-- GRANTs for service_role
-- Manual SQL migrations do NOT auto-grant table privileges to service_role,
-- which causes the API to return 403 / "permission denied". Grant explicitly
-- on existing objects AND set default privileges for future ones.
-- =============================================================================
GRANT USAGE ON SCHEMA public TO service_role;
GRANT ALL ON ALL TABLES    IN SCHEMA public TO service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO service_role;
GRANT ALL ON ALL FUNCTIONS IN SCHEMA public TO service_role;

ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES    TO service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON FUNCTIONS TO service_role;

-- =============================================================================
-- End of 001_initial_schema.sql
-- =============================================================================
