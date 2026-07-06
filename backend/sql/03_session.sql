-- SecureBank — 03_session.sql
-- `session` schema tables. All shared, load-balancer-safe state
-- lives here (NFR-04). user_id columns are real FKs to application.users; the
-- transactions→idempotency link is intentionally a SOFT ref (no FK).

-- sessions (SR-13) — opaque server-side sessions; 15-min idle / 8-h absolute.
CREATE TABLE session.sessions (
  session_id       varchar(64) PRIMARY KEY,                              -- opaque random (secrets.token_urlsafe)
  user_id          uuid NOT NULL REFERENCES application.users (user_id),
  created_at       timestamptz NOT NULL DEFAULT NOW(),
  last_active_at   timestamptz NOT NULL,                                 -- updated each request (idle timeout)
  absolute_expiry  timestamptz NOT NULL,                                 -- 8-h hard cap
  source_ip        inet        NOT NULL,
  revoked          boolean     NOT NULL DEFAULT FALSE                    -- TRUE on logout / privilege change
);
CREATE INDEX idx_sessions_user_id ON session.sessions (user_id);

-- idempotency_records (SR-08) — replay protection for transfers/bill payments.
CREATE TABLE session.idempotency_records (
  idempotency_key   uuid PRIMARY KEY,                                    -- client UUIDv4
  user_id           uuid NOT NULL REFERENCES application.users (user_id),
  request_hash      varchar(64) NOT NULL,                               -- SHA-256 of canonical body (conflict detection)
  response_payload  jsonb       NOT NULL,                               -- original response replayed on retry
  created_at        timestamptz NOT NULL DEFAULT NOW(),
  expires_at        timestamptz NOT NULL                                -- 24-h TTL; periodic cleanup
);
CREATE INDEX idx_idempotency_expires ON session.idempotency_records (expires_at);

-- auth_attempts (SR-11/SR-12/FR-10) — per-account feature-only rate-limit windows:
-- TOTP (5/min), PIN (3/txn, 5/hr), email sends (10/hr), and in-session password
-- re-verify (5/30-min). One row per attempt; COUNT within the window; prune old
-- rows. Distinct from users.failed_login_count (the SR-09 consecutive lockout).
CREATE TABLE session.auth_attempts (
  attempt_id       uuid PRIMARY KEY,
  user_id          uuid NOT NULL REFERENCES application.users (user_id),
  attempt_type     varchar(16) NOT NULL
                     CHECK (attempt_type IN ('totp','pin','email','password')),
  occurred_at      timestamptz NOT NULL DEFAULT NOW(),
  transaction_ref  varchar(32)                                          -- set for PIN (per-transaction 3/txn limit)
);
CREATE INDEX idx_auth_attempts_window
  ON session.auth_attempts (user_id, attempt_type, occurred_at);
