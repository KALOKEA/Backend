-- Migration 027: stock_notifications
-- Stores customer email subscriptions for out-of-stock product variants.
-- When admin restocks a variant, the cron job checks this table and sends
-- "Back in Stock" emails to all pending subscribers, then marks them sent.

CREATE TABLE IF NOT EXISTS stock_notifications (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  variant_id  UUID NOT NULL REFERENCES product_variants(id) ON DELETE CASCADE,
  email       TEXT NOT NULL,
  sent        BOOLEAN NOT NULL DEFAULT false,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  sent_at     TIMESTAMPTZ
);

-- One pending subscription per (variant, email) — prevents duplicate sign-ups.
CREATE UNIQUE INDEX IF NOT EXISTS stock_notifications_variant_email_pending_idx
  ON stock_notifications (variant_id, email)
  WHERE sent = false;

-- Fast lookup by variant for the cron job (find all pending for a given variant).
CREATE INDEX IF NOT EXISTS stock_notifications_variant_idx
  ON stock_notifications (variant_id)
  WHERE sent = false;
