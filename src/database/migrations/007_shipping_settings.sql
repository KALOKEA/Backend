-- =============================================================================
-- 007 — Add shipping_fee and shipping_free_threshold and cod_fee to
--       store_settings so the admin can configure them from the panel.
--       Run in the Supabase SQL editor after 004_store_settings.sql.
-- =============================================================================

ALTER TABLE store_settings
  ADD COLUMN IF NOT EXISTS shipping_fee              integer NOT NULL DEFAULT 4900,
  ADD COLUMN IF NOT EXISTS shipping_free_threshold   integer NOT NULL DEFAULT 99900,
  ADD COLUMN IF NOT EXISTS cod_fee                   integer NOT NULL DEFAULT 4900;

-- Values are in paise (₹ × 100).
-- Default: ₹49 shipping, free above ₹999, ₹49 COD surcharge.

GRANT ALL ON store_settings TO service_role;
