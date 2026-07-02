-- SecureBank — 04_audit.sql
-- `audit` schema (SR-14). Append-only: written via audit_writer
-- (INSERT only), read via admin_reader (SELECT only) — see 05_grants.sql. All
-- identifiers are SOFT references (NO FK) so an audit write can never fail on a
-- constraint and survives user deletion.

CREATE TABLE audit.audit_events (
  event_id         uuid PRIMARY KEY,
  event_timestamp  timestamptz NOT NULL DEFAULT NOW(),   -- UTC
  event_type       varchar(64) NOT NULL,                 -- e.g. LOGIN_SUCCESS, TRANSFER_INITIATED, ADMIN_SUSPEND_USER
  actor_user_id    uuid,                                 -- soft ref; NULL for unauthenticated events
  actor_role       varchar(16),
  target_user_id   uuid,                                 -- soft ref
  source_ip        inet        NOT NULL,                 -- real client IP from trusted X-Forwarded-For
  action_detail    jsonb,                                -- NRIC/PII masked before insertion (SR-03)
  outcome          varchar(16) NOT NULL
                     CHECK (outcome IN ('success','failure','denied'))
);
