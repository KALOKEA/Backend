-- Migration 014: add fulfillment_status column to orders
-- Run in Supabase SQL editor (Settings → SQL editor).
-- orders.service.ts cancelOrder() references fulfillment_status but the column
-- was not in the original migration 001. Without this column the check
-- `order.fulfillment_status !== 'pending'` always evaluates to `undefined !== 'pending'`
-- (true), providing no protection against cancelling shipped orders.

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS fulfillment_status TEXT DEFAULT 'pending'
    CHECK (fulfillment_status IN ('pending', 'processing', 'shipped', 'delivered', 'cancelled'));

-- Backfill: map existing status values to fulfillment_status where sensible.
UPDATE orders
  SET fulfillment_status = CASE
    WHEN status IN ('shipped', 'delivered', 'cancelled') THEN status
    ELSE 'pending'
  END
WHERE fulfillment_status IS NULL OR fulfillment_status = 'pending';

COMMENT ON COLUMN orders.fulfillment_status IS
  'Physical fulfilment state: pending → processing → shipped → delivered (or cancelled). '
  'Separate from payment_status to allow status transitions independently.';
