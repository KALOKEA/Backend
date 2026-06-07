-- Migration 021: Add guest_email support to coupon_uses + redeem_coupon RPC
-- Allows per-user coupon caps to be enforced for guest checkout (via email identity).

-- 1. Add guest_email column if not already present.
ALTER TABLE coupon_uses ADD COLUMN IF NOT EXISTS guest_email text;

-- 2. Replace redeem_coupon with a version that accepts an optional guest_email.
--    The old 3-arg signature is dropped so NestJS can call the new 4-arg version
--    without overload ambiguity. Existing callers passing NULL for p_guest_email
--    are unaffected.
DROP FUNCTION IF EXISTS redeem_coupon(uuid, uuid, uuid);

CREATE OR REPLACE FUNCTION redeem_coupon(
  p_coupon_id  uuid,
  p_order_id   uuid,
  p_user_id    uuid,
  p_guest_email text DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
AS $$
DECLARE
  affected integer;
BEGIN
  UPDATE coupons
     SET used_count = used_count + 1
   WHERE id = p_coupon_id
     AND (max_uses IS NULL OR used_count < max_uses);
  GET DIAGNOSTICS affected = ROW_COUNT;
  IF affected = 0 THEN
    RETURN false;
  END IF;
  INSERT INTO coupon_uses (coupon_id, order_id, user_id, guest_email)
  VALUES (p_coupon_id, p_order_id, p_user_id, lower(p_guest_email));
  RETURN true;
END;
$$;

-- Grant the service_role execute on the new signature.
GRANT EXECUTE ON FUNCTION redeem_coupon(uuid, uuid, uuid, text) TO service_role;

-- Index to speed up per-guest-email usage queries on large tables.
CREATE INDEX IF NOT EXISTS idx_coupon_uses_guest_email
  ON coupon_uses (coupon_id, guest_email)
  WHERE guest_email IS NOT NULL;

NOTIFY pgrst, 'reload schema';
