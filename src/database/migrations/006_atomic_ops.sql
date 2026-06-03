-- =============================================================================
-- 006 — Atomic operations (transaction safety).
-- Run in the Supabase SQL editor. Closes three concurrency races the forensic
-- audit flagged: overselling stock, coupon over-redemption, and lost stock on
-- restock. Each function is a single atomic statement, so concurrent checkouts
-- can't both "win" the last unit.
-- =============================================================================

-- Atomically decrement variant stock ONLY if enough is available.
-- Returns true if the decrement happened, false if there wasn't enough stock.
-- The `stock >= p_qty` guard in the UPDATE is the race-proof part: two
-- simultaneous orders for the last unit cannot both succeed.
CREATE OR REPLACE FUNCTION decrement_stock(p_variant_id uuid, p_qty integer)
RETURNS boolean
LANGUAGE plpgsql
AS $$
DECLARE
  affected integer;
BEGIN
  UPDATE product_variants
     SET stock = stock - p_qty
   WHERE id = p_variant_id
     AND stock >= p_qty;
  GET DIAGNOSTICS affected = ROW_COUNT;
  RETURN affected > 0;
END;
$$;

-- Atomically add stock back (returns, exchanges, rolled-back orders).
CREATE OR REPLACE FUNCTION restock_variant(p_variant_id uuid, p_qty integer)
RETURNS void
LANGUAGE sql
AS $$
  UPDATE product_variants
     SET stock = stock + p_qty
   WHERE id = p_variant_id;
$$;

-- Atomically redeem a coupon: bump used_count ONLY if under max_uses
-- (NULL max_uses = unlimited), then record the use. Returns false if the
-- usage limit was already reached (so two concurrent orders can't both take
-- the final allowed use).
CREATE OR REPLACE FUNCTION redeem_coupon(p_coupon_id uuid, p_order_id uuid, p_user_id uuid)
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
  INSERT INTO coupon_uses (coupon_id, order_id, user_id)
  VALUES (p_coupon_id, p_order_id, p_user_id);
  RETURN true;
END;
$$;

-- The backend calls these via the service role (PostgREST RPC).
GRANT EXECUTE ON FUNCTION decrement_stock(uuid, integer) TO service_role;
GRANT EXECUTE ON FUNCTION restock_variant(uuid, integer) TO service_role;
GRANT EXECUTE ON FUNCTION redeem_coupon(uuid, uuid, uuid)  TO service_role;
