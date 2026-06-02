-- =============================================================================
-- 005 — GST: per-product HSN/rate, immutable GST ledger, exchanges.
-- Run in the Supabase SQL editor. Re-run the GRANTs after any manual table
-- creation (service-role uses the API key and still needs table-level GRANTs).
--
-- Model: GST is EXCLUSIVE (added on top of the variant price at checkout).
-- Each product carries an HSN code + its own gst_rate; the store-wide rate in
-- store_settings.gst_rate is the fallback when a product has none.
-- All money is integer PAISE (matches the rest of the schema / Razorpay).
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Per-product HSN code + GST rate (nullable → fall back to store rate).
-- ---------------------------------------------------------------------------
ALTER TABLE products ADD COLUMN IF NOT EXISTS hsn_code text;
ALTER TABLE products ADD COLUMN IF NOT EXISTS gst_rate numeric;  -- e.g. 5, 12, 18; NULL = use store default

-- ---------------------------------------------------------------------------
-- 2. Per-order GST snapshot (so invoices/ledger never recompute historically).
--    taxable_value = subtotal - discount (the value GST is charged on).
--    total = taxable_value + total_gst + shipping(+cod fee).
-- ---------------------------------------------------------------------------
ALTER TABLE orders ADD COLUMN IF NOT EXISTS place_of_supply  text;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS is_intra_state   boolean;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS taxable_value    numeric(10,2) NOT NULL DEFAULT 0;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS cgst             numeric(10,2) NOT NULL DEFAULT 0;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS sgst             numeric(10,2) NOT NULL DEFAULT 0;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS igst             numeric(10,2) NOT NULL DEFAULT 0;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS total_gst        numeric(10,2) NOT NULL DEFAULT 0;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS gstin            text;          -- buyer GSTIN (B2B invoice)
ALTER TABLE orders ADD COLUMN IF NOT EXISTS company_name     text;

-- ---------------------------------------------------------------------------
-- 3. Per-line GST snapshot (taxable_value is post-discount, paise).
-- ---------------------------------------------------------------------------
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS hsn_code       text;
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS gst_rate       numeric NOT NULL DEFAULT 0;
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS taxable_value  numeric(10,2) NOT NULL DEFAULT 0;
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS gst_amount     numeric(10,2) NOT NULL DEFAULT 0;

-- ---------------------------------------------------------------------------
-- 4. gst_ledger — the immutable, append-only accounting record.
--    ONE row per taxable line event. Sales are positive; returns are negative;
--    an exchange writes a negative line (returned item) + a positive line (new
--    item). Net GST for any period = SUM(total_gst) over the date range.
--    This is the table the CA exports for GSTR / ITR filing.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS gst_ledger (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  txn_type        text NOT NULL CHECK (txn_type IN ('sale', 'return', 'exchange')),
  txn_date        timestamptz NOT NULL DEFAULT now(),

  order_id        uuid REFERENCES orders(id)       ON DELETE SET NULL,
  order_item_id   uuid REFERENCES order_items(id)  ON DELETE SET NULL,
  return_id       uuid,
  exchange_id     uuid,
  order_number    text,

  -- Line detail (snapshot — never changes once written).
  hsn_code        text,
  description     text,
  quantity        integer NOT NULL DEFAULT 0,        -- signed (negative for returns)
  gst_rate        numeric NOT NULL DEFAULT 0,

  -- Place of supply drives the CGST+SGST vs IGST split.
  place_of_supply text,
  is_intra_state  boolean NOT NULL DEFAULT true,

  -- All paise, signed (negative reverses a prior sale).
  taxable_value   numeric(12,2) NOT NULL DEFAULT 0,
  cgst            numeric(12,2) NOT NULL DEFAULT 0,
  sgst            numeric(12,2) NOT NULL DEFAULT 0,
  igst            numeric(12,2) NOT NULL DEFAULT 0,
  total_gst       numeric(12,2) NOT NULL DEFAULT 0,
  gross           numeric(12,2) NOT NULL DEFAULT 0,  -- taxable_value + total_gst

  customer_name   text,
  customer_gstin  text,

  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_gst_ledger_txn_date ON gst_ledger (txn_date);
CREATE INDEX IF NOT EXISTS idx_gst_ledger_type     ON gst_ledger (txn_type);
CREATE INDEX IF NOT EXISTS idx_gst_ledger_order    ON gst_ledger (order_id);
CREATE INDEX IF NOT EXISTS idx_gst_ledger_rate     ON gst_ledger (gst_rate);
-- Idempotency guards: never double-post a sale line, a return, or an exchange.
CREATE UNIQUE INDEX IF NOT EXISTS uq_gst_ledger_sale
  ON gst_ledger (order_item_id) WHERE txn_type = 'sale';
CREATE UNIQUE INDEX IF NOT EXISTS uq_gst_ledger_return
  ON gst_ledger (return_id) WHERE txn_type = 'return';

-- ---------------------------------------------------------------------------
-- 5. exchanges — swap an ordered item for a different variant.
--    GST impact is recorded in gst_ledger when status → 'completed'.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS exchanges (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id            uuid NOT NULL REFERENCES orders(id)            ON DELETE CASCADE,
  order_item_id       uuid NOT NULL REFERENCES order_items(id)       ON DELETE CASCADE,
  user_id             uuid REFERENCES users(id)                      ON DELETE SET NULL,
  new_variant_id      uuid REFERENCES product_variants(id)          ON DELETE SET NULL,

  reason              text NOT NULL,
  status              text NOT NULL DEFAULT 'requested'
                        CHECK (status IN ('requested', 'approved', 'rejected', 'completed')),

  -- Snapshots (paise). price_difference = new_price - original_price (signed).
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

-- ---------------------------------------------------------------------------
-- 6. GRANTs (service-role bypasses RLS in code but needs table grants).
-- ---------------------------------------------------------------------------
GRANT ALL ON gst_ledger TO service_role;
GRANT ALL ON exchanges  TO service_role;
