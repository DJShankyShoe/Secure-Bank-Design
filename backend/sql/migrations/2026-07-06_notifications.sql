-- Migration: add application.notifications (FR-10 — customer notification bell).
-- Run as the DB owner/superuser (the role that owns the `application` schema),
-- on every environment: securebank_ddltest (tests), securebank (dev), and prod.
--
--   psql -v ON_ERROR_STOP=1 -U <owner> -d <db> -f 2026-07-06_notifications.sql
--
-- Idempotent-ish: uses IF NOT EXISTS so re-running is safe.

CREATE TABLE IF NOT EXISTS application.notifications (
  notification_id  uuid PRIMARY KEY,
  user_id          uuid NOT NULL REFERENCES application.users (user_id),
  category         varchar(32)  NOT NULL,   -- e.g. account_locked, user_suspended
  title            varchar(120) NOT NULL,
  body             varchar(1000) NOT NULL,
  read_at          timestamptz,             -- NULL = unread
  created_at       timestamptz  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_notifications_user_id
  ON application.notifications (user_id, created_at DESC);

-- app_user runs all business CRUD (matches sql/05_grants.sql). ALTER DEFAULT
-- PRIVILEGES may already cover this, but grant explicitly to be safe.
GRANT SELECT, INSERT, UPDATE, DELETE ON application.notifications TO app_user;
