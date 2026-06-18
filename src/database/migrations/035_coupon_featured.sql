-- Migration 035: feature a coupon as a public "Get it at ₹X" offer.
-- Only coupons explicitly marked is_featured are advertised on product pages,
-- so secret / targeted codes are never exposed via the public best-offer endpoint.

ALTER TABLE coupons ADD COLUMN IF NOT EXISTS is_featured BOOLEAN NOT NULL DEFAULT false;

NOTIFY pgrst, 'reload schema';
