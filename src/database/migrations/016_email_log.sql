-- Migration 016: email delivery log
-- Tracks every outbound email attempt. Allows replay of failed order
-- confirmation emails without digging through Railway logs.

CREATE TABLE IF NOT EXISTS email_log (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  recipient     TEXT NOT NULL,
  subject       TEXT NOT NULL,
  email_type    TEXT NOT NULL DEFAULT 'unknown',
  status        TEXT NOT NULL DEFAULT 'sent'
                  CHECK (status IN ('sent', 'failed', 'retried_ok', 'retried_fail')),
  error_message TEXT,
  retry_count   SMALLINT NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Indexes for admin queries
CREATE INDEX IF NOT EXISTS email_log_recipient_idx  ON email_log (recipient);
CREATE INDEX IF NOT EXISTS email_log_type_idx       ON email_log (email_type);
CREATE INDEX IF NOT EXISTS email_log_status_idx     ON email_log (status);
CREATE INDEX IF NOT EXISTS email_log_created_at_idx ON email_log (created_at DESC);

-- service_role can INSERT/SELECT; no UPDATE or DELETE (append-only audit log)
-- No sequence grant needed — PK is UUID (gen_random_uuid()), not SERIAL.
GRANT INSERT, SELECT ON email_log TO service_role;

COMMENT ON TABLE email_log IS
  'Append-only log of every outbound email. Failed rows can be replayed manually.';
