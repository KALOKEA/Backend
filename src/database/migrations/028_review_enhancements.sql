-- Migration 028: Review enhancements
-- Adds admin_reply, admin_replied_at, flagged, flag_reason to reviews table

ALTER TABLE reviews
  ADD COLUMN IF NOT EXISTS admin_reply       TEXT,
  ADD COLUMN IF NOT EXISTS admin_replied_at  TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS flagged           BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS flag_reason       TEXT;

-- Index for flagged review admin queries
CREATE INDEX IF NOT EXISTS idx_reviews_flagged ON reviews(flagged) WHERE flagged = TRUE;

COMMENT ON COLUMN reviews.admin_reply IS 'Public admin reply shown below the review on the storefront';
COMMENT ON COLUMN reviews.admin_replied_at IS 'When the admin reply was posted';
COMMENT ON COLUMN reviews.flagged IS 'Admin-flagged for inappropriate content or spam';
COMMENT ON COLUMN reviews.flag_reason IS 'Reason for flagging (spam, inappropriate, fake, off_topic, other)';
