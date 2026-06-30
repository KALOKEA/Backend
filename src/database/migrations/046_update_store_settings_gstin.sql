-- Migration 046: Set real GSTIN and support email in store_settings
-- Run this in Supabase SQL Editor.
-- GSTIN: 24HRYPK5081F1Z8  |  Email: support@kalokea.com

UPDATE store_settings
SET
  seller_gstin = '24HRYPK5081F1Z8',
  admin_email  = 'support@kalokea.com'
WHERE id = (SELECT id FROM store_settings LIMIT 1);
