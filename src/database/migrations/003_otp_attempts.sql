-- =============================================================================
-- 003 — OTP per-session attempt lock
-- Adds otp_sessions.attempts. verifyOtp() increments it on each wrong guess and
-- consumes the session after 5 failures, independent of IP (closes the rotating-
-- IP bypass of the per-IP throttler). Run in the Supabase SQL editor.
-- =============================================================================

ALTER TABLE otp_sessions
  ADD COLUMN IF NOT EXISTS attempts integer NOT NULL DEFAULT 0;
