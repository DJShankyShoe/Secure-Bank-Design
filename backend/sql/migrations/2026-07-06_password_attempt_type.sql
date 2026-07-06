-- Migration (2026-07-06): allow the 'password' attempt_type in session.auth_attempts.
--
-- FR-10: in-session password re-verify failures on password-gated features (change
-- password / change email / change transaction PIN) are throttled with a feature-only
-- cooldown (5 fails / 30 min) recorded as attempt_type='password'. This widens the
-- existing CHECK; it never locks the account (that stays SR-09 / users.failed_login_count).
--
-- Run once as a role that owns session.auth_attempts (e.g. the postgres superuser or
-- the schema owner). Safe to re-run: the DROP ... IF EXISTS makes it idempotent.
-- Fresh installs already get the widened CHECK from sql/03_session.sql.

-- The existing CHECK was declared inline (unnamed) in sql/03_session.sql, so
-- PostgreSQL auto-named it 'auth_attempts_attempt_type_check'. We drop that exact
-- name and re-add it (same name) so a migrated DB matches a fresh install.
ALTER TABLE session.auth_attempts
    DROP CONSTRAINT IF EXISTS auth_attempts_attempt_type_check;

ALTER TABLE session.auth_attempts
    ADD CONSTRAINT auth_attempts_attempt_type_check
    CHECK (attempt_type IN ('totp', 'pin', 'email', 'password'));
