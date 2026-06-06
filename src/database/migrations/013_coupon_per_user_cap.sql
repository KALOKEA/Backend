-- Migration 013: per-user coupon redemption cap
-- Run in Supabase SQL editor (Settings → SQL editor).
-- Adds max_per_user to coupons so a single user can't redeem the same coupon
-- unlimited times even when the global max_uses hasn't been hit yet.

ALTER TABLE coupons
  ADD COLUMN IF NOT EXISTS max_per_user INTEGER DEFAULT NULL
    CHECK (max_per_user IS NULL OR max_per_user >= 1);

COMMENT ON COLUMN coupons.max_per_user IS
  'Maximum times a single user can redeem this coupon. NULL = unlimited per user (only global max_uses applies).';
