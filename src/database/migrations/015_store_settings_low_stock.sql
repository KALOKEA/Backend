-- Migration 015: add low_stock_threshold to store_settings
-- Run in Supabase SQL editor.
-- Allows admins to configure the inventory alert threshold from the admin panel
-- instead of having it hardcoded to 5 in cron.service.ts.

ALTER TABLE store_settings
  ADD COLUMN IF NOT EXISTS low_stock_threshold INTEGER DEFAULT 5
    CHECK (low_stock_threshold >= 1);

COMMENT ON COLUMN store_settings.low_stock_threshold IS
  'Variants with stock <= this number trigger the daily low-stock alert email.';
