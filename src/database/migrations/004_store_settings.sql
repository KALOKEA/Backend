-- =============================================================================
-- 004 — Store settings (single-row) for admin-editable business / GST config.
-- Lets the admin set GSTIN, business details and GST rate from the panel instead
-- of env vars. Run in the Supabase SQL editor.
-- =============================================================================

CREATE TABLE IF NOT EXISTS store_settings (
  id                  integer PRIMARY KEY DEFAULT 1,
  seller_name         text    NOT NULL DEFAULT 'KALOKEA',
  seller_address      text    NOT NULL DEFAULT '',
  seller_gstin        text    NOT NULL DEFAULT '',
  seller_state        text    NOT NULL DEFAULT '',
  gst_rate            numeric NOT NULL DEFAULT 5,
  admin_email         text    NOT NULL DEFAULT '',
  updated_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT store_settings_singleton CHECK (id = 1)
);

-- Seed the single row.
INSERT INTO store_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

-- Service-role uses the API key and bypasses RLS in code; it still needs the
-- table-level GRANT (re-run this after any manual table creation).
GRANT ALL ON store_settings TO service_role;
