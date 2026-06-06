-- Migration 019: Add live_chat_widget to store_settings
ALTER TABLE store_settings
  ADD COLUMN IF NOT EXISTS live_chat_widget TEXT DEFAULT '';

GRANT ALL ON TABLE store_settings TO service_role;
