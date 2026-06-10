-- Migration 022: Footer brand settings (Instagram URL, WhatsApp URL, GSTIN display)
-- Adds editable footer fields to store_settings so admin can update without code deploys.

ALTER TABLE store_settings
  ADD COLUMN IF NOT EXISTS footer_instagram_url TEXT NOT NULL DEFAULT 'https://www.instagram.com/kalokea.fashion',
  ADD COLUMN IF NOT EXISTS footer_whatsapp_url  TEXT NOT NULL DEFAULT 'https://wa.me/918799610432';

-- seller_gstin already exists from migration 004 — used as the footer GSTIN display.

GRANT ALL ON TABLE store_settings TO service_role;

NOTIFY pgrst, 'reload schema';
