-- 038_order_payment_reminder.sql
-- Guard column for the pending-payment WhatsApp reminder cron.
-- Ensures each unpaid online order is reminded at most once.
-- Idempotent: safe to run multiple times.

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS payment_reminder_sent boolean NOT NULL DEFAULT false;

-- Optional: speeds up the cron's scan of pending online orders.
CREATE INDEX IF NOT EXISTS idx_orders_pending_payment
  ON orders (payment_status, status, payment_method, created_at)
  WHERE payment_reminder_sent = false;
