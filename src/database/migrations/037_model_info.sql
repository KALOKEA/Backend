-- Migration 037: Add model_info column to products
-- Stores "Model is 5'6", 58kg, wearing S" style info shown on product page.
-- Safe + idempotent (IF NOT EXISTS).

ALTER TABLE products ADD COLUMN IF NOT EXISTS model_info TEXT;
