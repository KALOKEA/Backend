-- Migration 024: Add fabric_care column to products
-- Stores fabric composition and care instruction text set by admin.

ALTER TABLE products
  ADD COLUMN IF NOT EXISTS fabric_care TEXT;

COMMENT ON COLUMN products.fabric_care IS 'Fabric composition and care instructions. Set by admin in product form. Displayed in product page accordion.';
