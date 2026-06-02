-- =============================================================================
-- 002 — Refresh-token revocation support
-- Adds users.token_version. Refresh tokens embed the value at issue time;
-- bumping it (on logout / forced revoke) invalidates all outstanding refresh
-- tokens for that user. Run this in the Supabase SQL editor.
-- =============================================================================

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS token_version integer NOT NULL DEFAULT 0;

-- token_version is covered by the existing table-level GRANT on users, so no
-- additional GRANT is required (column-level grants inherit from the table).
