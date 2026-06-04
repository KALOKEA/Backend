-- Migration 008: stock_reservations
--
-- Solves the Razorpay race condition: two concurrent buyers can both pass the
-- stock check and both place orders for the last unit. With reservations:
--   1. Order created → reserve stock for 15 minutes
--   2. payment.captured → confirm reservation (decrement actual stock)
--   3. payment.failed / TTL expired → release reservation (no stock lost)
--
-- MUST run in Supabase SQL editor, then re-run GRANTs.

CREATE TABLE IF NOT EXISTS stock_reservations (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id        uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  variant_id      uuid NOT NULL REFERENCES product_variants(id) ON DELETE CASCADE,
  quantity        integer NOT NULL CHECK (quantity > 0),
  expires_at      timestamptz NOT NULL DEFAULT (now() + interval '15 minutes'),
  confirmed       boolean NOT NULL DEFAULT false,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_stock_reservations_order ON stock_reservations(order_id);
CREATE INDEX IF NOT EXISTS idx_stock_reservations_variant ON stock_reservations(variant_id);
CREATE INDEX IF NOT EXISTS idx_stock_reservations_expires ON stock_reservations(expires_at) WHERE confirmed = false;

-- RLS: service_role bypasses. No customer-facing API reads this table.
ALTER TABLE stock_reservations ENABLE ROW LEVEL SECURITY;

GRANT ALL ON stock_reservations TO service_role;

-- Helper function: how many units of a variant are currently soft-reserved
-- (pending, non-expired). Used in the stock-check before order creation.
CREATE OR REPLACE FUNCTION get_soft_reserved(p_variant_id uuid)
RETURNS integer
LANGUAGE sql STABLE AS $$
  SELECT COALESCE(SUM(quantity), 0)::integer
  FROM stock_reservations
  WHERE variant_id = p_variant_id
    AND confirmed = false
    AND expires_at > now();
$$;

-- Clean up expired (never-confirmed) reservations. Call this from a cron or
-- ad-hoc; entries are also ignored by get_soft_reserved above.
CREATE OR REPLACE FUNCTION expire_stock_reservations()
RETURNS integer
LANGUAGE plpgsql AS $$
DECLARE
  deleted integer;
BEGIN
  DELETE FROM stock_reservations
  WHERE confirmed = false AND expires_at <= now();
  GET DIAGNOSTICS deleted = ROW_COUNT;
  RETURN deleted;
END;
$$;

GRANT EXECUTE ON FUNCTION get_soft_reserved(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION expire_stock_reservations() TO service_role;
