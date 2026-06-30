-- Migration 045: Advanced coupon enhancements
-- Adds: is_permanent, new_users_only, valid_from columns
-- Sets WELCOME15 as permanent new-user-only coupon

-- Add is_permanent: when true, the coupon cannot be disabled via toggle
ALTER TABLE coupons ADD COLUMN IF NOT EXISTS is_permanent BOOLEAN NOT NULL DEFAULT false;

-- Add new_users_only: when true, only customers with zero prior confirmed orders may use it
ALTER TABLE coupons ADD COLUMN IF NOT EXISTS new_users_only BOOLEAN NOT NULL DEFAULT false;

-- Add valid_from: optional start date for scheduled coupons (already partially supported in bestOffer)
ALTER TABLE coupons ADD COLUMN IF NOT EXISTS valid_from TIMESTAMPTZ NULL;

-- Upsert WELCOME15 as the permanent new-user welcome coupon
-- 15% off, no minimum order, max 1 use per customer, permanent and always active
INSERT INTO coupons (code, type, value, min_order_value, max_per_user, is_active, is_featured, is_permanent, new_users_only)
VALUES ('WELCOME15', 'percent', 15, 0, 1, true, false, true, true)
ON CONFLICT (code) DO UPDATE SET
  type          = EXCLUDED.type,
  value         = EXCLUDED.value,
  min_order_value = EXCLUDED.min_order_value,
  max_per_user  = EXCLUDED.max_per_user,
  is_active     = true,         -- permanent coupons are always active
  is_permanent  = true,
  new_users_only = true;
