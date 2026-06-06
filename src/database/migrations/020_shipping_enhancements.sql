-- Migration 020: Shipping enhancements — packaging profiles + NDR tracking

-- Packaging profiles (saved box sizes for quick selection)
CREATE TABLE IF NOT EXISTS packaging_profiles (
  id          SERIAL PRIMARY KEY,
  name        TEXT NOT NULL,
  weight      NUMERIC(8,2) NOT NULL DEFAULT 0.5,  -- kg
  length      NUMERIC(8,2) NOT NULL DEFAULT 10,    -- cm
  breadth     NUMERIC(8,2) NOT NULL DEFAULT 10,    -- cm
  height      NUMERIC(8,2) NOT NULL DEFAULT 10,    -- cm
  is_default  BOOLEAN NOT NULL DEFAULT FALSE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- NDR and tracking sync columns on orders
ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS ndr_reason      TEXT,
  ADD COLUMN IF NOT EXISTS ndr_action      TEXT,
  ADD COLUMN IF NOT EXISTS tracking_synced_at TIMESTAMPTZ;

GRANT ALL ON TABLE packaging_profiles TO service_role;
GRANT USAGE, SELECT ON SEQUENCE packaging_profiles_id_seq TO service_role;
GRANT ALL ON TABLE orders TO service_role;

-- Seed 2 default profiles
INSERT INTO packaging_profiles (name, weight, length, breadth, height, is_default) VALUES
  ('Small Packet', 0.3, 15, 12, 5, false),
  ('Standard Box', 0.5, 25, 20, 10, true)
ON CONFLICT DO NOTHING;
