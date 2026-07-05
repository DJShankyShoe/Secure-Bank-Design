-- SecureBank — 01_schemas_roles.sql
-- Schemas + least-privilege roles (SR-14).
-- Run order: 01 → 02 → 03 → 04 → 05. Execute as a privileged OWNER/migration
-- role (e.g. the DB superuser or a dedicated `securebank_owner`). That owner —
-- NOT the three roles below — owns every schema/table, so ownership can never be
-- used to bypass the INSERT-only audit boundary (a table owner ignores GRANTs).
--
-- The three application roles are created LOGIN but WITHOUT passwords here:
-- passwords are set out-of-band at provisioning and must match the DATABASE_URL_*
-- DSNs in .env (SR-07). Never commit real passwords.
--   ALTER ROLE app_user      PASSWORD '...';   -- application + session (CRUD)
--   ALTER ROLE audit_writer  PASSWORD '...';   -- audit (INSERT only)
--   ALTER ROLE admin_reader  PASSWORD '...';   -- audit (SELECT only)

CREATE SCHEMA IF NOT EXISTS application;
CREATE SCHEMA IF NOT EXISTS session;
CREATE SCHEMA IF NOT EXISTS audit;

-- Idempotent role creation (no-op if the role already exists).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_user') THEN
    CREATE ROLE app_user LOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'audit_writer') THEN
    CREATE ROLE audit_writer LOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'admin_reader') THEN
    CREATE ROLE admin_reader LOGIN;
  END IF;
END$$;
