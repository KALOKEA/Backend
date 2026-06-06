-- Migration 017: ShipRocket shipping integration columns
-- Adds ShipRocket tracking metadata to orders table.
-- Run in Supabase SQL editor after deploying ShipRocket backend module.

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS shiprocket_order_id   BIGINT,
  ADD COLUMN IF NOT EXISTS shiprocket_shipment_id BIGINT,
  ADD COLUMN IF NOT EXISTS awb_code               TEXT,
  ADD COLUMN IF NOT EXISTS courier_id             INTEGER,
  ADD COLUMN IF NOT EXISTS courier_name           TEXT,
  ADD COLUMN IF NOT EXISTS label_url              TEXT,
  ADD COLUMN IF NOT EXISTS shiprocket_status      TEXT,
  ADD COLUMN IF NOT EXISTS pickup_scheduled_at    TIMESTAMPTZ;

-- Index for webhook lookups by AWB
CREATE INDEX IF NOT EXISTS idx_orders_awb_code ON orders(awb_code) WHERE awb_code IS NOT NULL;

-- Index for ShipRocket order ID lookups
CREATE INDEX IF NOT EXISTS idx_orders_shiprocket_order_id ON orders(shiprocket_order_id) WHERE shiprocket_order_id IS NOT NULL;

-- service_role already has UPDATE on orders from migration 001
