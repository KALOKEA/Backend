-- 040_fix_stock_rpcs.sql
-- Restores the atomic stock RPCs and reloads the PostgREST schema cache.
-- Run this if COD checkout fails with "Could not reserve stock for this order".
-- Root cause: MASTER_SETUP.sql did not (re)create these functions, so a DB whose
-- stock functions were missing or whose PostgREST cache was stale kept erroring.
-- Fully idempotent — safe to run any number of times.

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

-- Critical: clears the "function not found in schema cache" error.
NOTIFY pgrst, 'reload schema';
