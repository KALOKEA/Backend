-- Migration 034: allow admin-seeded reviews
-- Reviews previously required a verified-purchase user (user_id NOT NULL) and
-- showed the reviewer name from the users join. To let admins add reviews
-- (e.g. imported / off-platform feedback) so ratings can display on new
-- products, user_id becomes optional and a guest_name holds the display name.

ALTER TABLE reviews ALTER COLUMN user_id DROP NOT NULL;
ALTER TABLE reviews ADD COLUMN IF NOT EXISTS guest_name TEXT;

-- Refresh PostgREST schema cache so the new column is exposed immediately.
NOTIFY pgrst, 'reload schema';
