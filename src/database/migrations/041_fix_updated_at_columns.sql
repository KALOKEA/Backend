-- 041_fix_updated_at_columns.sql
-- ROOT CAUSE of COD "Stock reserve failed: record \"new\" has no field \"updated_at\"".
--
-- The set_updated_at() trigger function does `NEW.updated_at = now()` and is
-- attached (trg_*_updated_at) to: users, products, product_variants, carts,
-- orders, returns, exchanges. If any of those tables was created on the live DB
-- WITHOUT an updated_at column (product_variants was — MASTER_SETUP never added
-- it), then EVERY UPDATE on that table raises:
--     record "new" has no field "updated_at"
-- For product_variants that means stock can never be decremented, so COD (and any
-- admin stock edit) 500s.
--
-- Fix: guarantee every trigger-bearing table has the column the trigger needs.
-- Fully idempotent — ADD COLUMN IF NOT EXISTS is a no-op when already present.
-- Run this in Supabase → SQL Editor. No redeploy required to take effect.

ALTER TABLE product_variants ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE users            ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE products         ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE carts            ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE orders           ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE returns          ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

-- exchanges only exists once the GST migration (005) has run; guard it.
DO $$
BEGIN
  IF to_regclass('public.exchanges') IS NOT NULL THEN
    ALTER TABLE exchanges ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
  END IF;
END $$;

-- Refresh PostgREST so the new column is visible to the API layer immediately.
NOTIFY pgrst, 'reload schema';
