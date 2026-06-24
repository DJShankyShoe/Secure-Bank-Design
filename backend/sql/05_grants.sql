-- SecureBank — 05_grants.sql
-- Least-privilege GRANT/REVOKE — the DB-level enforcement of SR-14.
-- Run LAST, as the same OWNER/migration role that created the objects.
--
-- Boundary summary:
--   app_user     -> application + session : SELECT/INSERT/UPDATE/DELETE ; NO audit access
--   audit_writer -> audit                 : INSERT ONLY (append-only)
--   admin_reader -> audit                 : SELECT ONLY
-- Because the three roles are NOT owners, none can bypass these grants.

-- 1) Strip default PUBLIC access on every schema and its tables.
REVOKE ALL ON SCHEMA application, session, audit FROM PUBLIC;
REVOKE ALL ON ALL TABLES IN SCHEMA application FROM PUBLIC;
REVOKE ALL ON ALL TABLES IN SCHEMA session     FROM PUBLIC;
REVOKE ALL ON ALL TABLES IN SCHEMA audit       FROM PUBLIC;

-- 2) app_user: business + session state (CRUD). No audit privilege at all.
GRANT USAGE ON SCHEMA application, session TO app_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA application TO app_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA session     TO app_user;

-- 3) audit_writer: append-only. USAGE on schema + INSERT on the single table.
--    Deliberately NO SELECT/UPDATE/DELETE -> audit cannot be read or altered here.
GRANT USAGE  ON SCHEMA audit            TO audit_writer;
GRANT INSERT ON audit.audit_events      TO audit_writer;

-- 4) admin_reader: read-only audit review.
GRANT USAGE  ON SCHEMA audit            TO admin_reader;
GRANT SELECT ON audit.audit_events      TO admin_reader;

-- 5) Keep the boundary for any tables added later (applies to objects created by
--    the role running this script). Mirrors the grants above.
ALTER DEFAULT PRIVILEGES IN SCHEMA application
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_user;
ALTER DEFAULT PRIVILEGES IN SCHEMA session
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_user;
ALTER DEFAULT PRIVILEGES IN SCHEMA audit
  GRANT INSERT ON TABLES TO audit_writer;
ALTER DEFAULT PRIVILEGES IN SCHEMA audit
  GRANT SELECT ON TABLES TO admin_reader;
