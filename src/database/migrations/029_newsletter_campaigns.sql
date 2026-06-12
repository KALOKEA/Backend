-- Migration 029: Newsletter campaign log
-- Tracks campaigns sent by the admin (subject, body, stats)

CREATE TABLE IF NOT EXISTS newsletter_campaigns (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  subject          TEXT NOT NULL,
  body_html        TEXT NOT NULL,
  preview_text     TEXT,
  recipient_count  INTEGER NOT NULL DEFAULT 0,
  sent_count       INTEGER NOT NULL DEFAULT 0,
  failed_count     INTEGER NOT NULL DEFAULT 0,
  status           TEXT NOT NULL DEFAULT 'sending' CHECK (status IN ('sending', 'sent', 'failed')),
  sent_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index for listing campaigns newest-first
CREATE INDEX IF NOT EXISTS idx_newsletter_campaigns_sent_at ON newsletter_campaigns(sent_at DESC);

-- Also add retry_count to email_log if not already present (used by resend logic)
ALTER TABLE email_log
  ADD COLUMN IF NOT EXISTS retry_count  INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS metadata     JSONB,
  ADD COLUMN IF NOT EXISTS body_html    TEXT;

COMMENT ON TABLE newsletter_campaigns IS 'Admin-sent newsletter campaigns — one row per blast';
COMMENT ON COLUMN newsletter_campaigns.sent_count IS 'Successfully delivered emails';
COMMENT ON COLUMN newsletter_campaigns.failed_count IS 'Emails that failed to send';
