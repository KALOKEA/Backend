-- ───────────────────────────────────────────────────────────────────────────
-- 043 — Staff RBAC (role-based access control for the admin panel)
--
-- Adds a third role, 'staff', plus a per-user `permissions` array. Staff can
-- only access the admin sections their permissions list grants. Full admins
-- (role = 'admin') retain unrestricted access and ignore the permissions list.
--
-- Idempotent: safe to run multiple times.
-- ───────────────────────────────────────────────────────────────────────────

-- 1. Allow the new 'staff' role. The original CHECK was created inline on the
--    users table (auto-named, e.g. users_role_check). Drop whichever check
--    constraint references `role`, then re-add an explicit, named one.
DO $$
DECLARE
  c text;
BEGIN
  SELECT conname INTO c
  FROM pg_constraint
  WHERE conrelid = 'users'::regclass
    AND contype = 'c'
    AND pg_get_constraintdef(oid) ILIKE '%role%';

  IF c IS NOT NULL THEN
    EXECUTE format('ALTER TABLE users DROP CONSTRAINT %I', c);
  END IF;
END $$;

ALTER TABLE users
  ADD CONSTRAINT users_role_check CHECK (role IN ('customer', 'admin', 'staff'));

-- 2. Per-user permissions. JSON array of admin-section keys, e.g.
--    ["orders","products","reviews"]. Empty for customers and full admins
--    (full admins bypass the check entirely).
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS permissions jsonb NOT NULL DEFAULT '[]'::jsonb;

-- 3. Helpful partial index for listing staff accounts in the admin panel.
CREATE INDEX IF NOT EXISTS idx_users_role_staff
  ON users (created_at DESC)
  WHERE role IN ('admin', 'staff');
