#!/usr/bin/env bash
#
# SecureBank — production first-time setup.
#
# Creates the database, the three least-privilege roles with STRONG, UNIQUE,
# generated passwords, applies the schema/grants/seed (sql/01..06), and writes a
# locked-down backend/.env (chmod 600, gitignored). Secrets are generated here and
# NEVER printed.
#
# Connects to PostgreSQL as an ADMIN/superuser over TCP using standard libpq env
# vars (so it works against a managed/remote prod DB, not just a local socket):
#     PGHOST, PGPORT, PGUSER (e.g. postgres), PGPASSWORD     (or ~/.pgpass)
#
# REQUIRED env vars (your production values):
#     SMTP_HOST          e.g. mail.smtp2go.com
#     SMTP_FROM          a VERIFIED sender address/domain
#     TOTP_ISSUER        e.g. SecureBank
# OPTIONAL env vars:
#     SMTP_PORT=587            (STARTTLS; do NOT use 465 — the app uses STARTTLS)
#     SMTP_USER, SMTP_PASSWORD (omit for an unauthenticated relay)
#     DB_NAME=securebank
#     APP_DB_HOST=$PGHOST   APP_DB_PORT=$PGPORT   (host:port the APP uses in its DSNs)
#     FORCE_HTTPS=true         (keep true in prod behind nginx)
#     ENV_FILE=backend/.env
#     RECREATE_DB=0            (set 1 to DROP+recreate an existing DB — DESTRUCTIVE)
#
# NOTE: the three roles are CLUSTER-GLOBAL. This script (re)sets their passwords,
# which affects every database using them — run it only on a DEDICATED production
# cluster, not one shared with dev/test.
#
# Usage:
#   PGHOST=db.internal PGUSER=postgres PGPASSWORD=*** \
#   SMTP_HOST=mail.smtp2go.com SMTP_USER=*** SMTP_PASSWORD=*** \
#   SMTP_FROM=no-reply@yourbank.com TOTP_ISSUER=SecureBank \
#   ./backend/scripts/setup_production.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
SQL_DIR="$BACKEND_DIR/sql"

DB_NAME="${DB_NAME:-securebank}"
APP_DB_HOST="${APP_DB_HOST:-${PGHOST:-localhost}}"
APP_DB_PORT="${APP_DB_PORT:-${PGPORT:-5432}}"
FORCE_HTTPS="${FORCE_HTTPS:-true}"
SMTP_PORT="${SMTP_PORT:-587}"
RECREATE_DB="${RECREATE_DB:-0}"
ENV_FILE="${ENV_FILE:-$BACKEND_DIR/.env}"

# ---- 1. Preconditions --------------------------------------------------------
command -v psql    >/dev/null || { echo "ERROR: psql not found on PATH"; exit 1; }
command -v python3 >/dev/null || { echo "ERROR: python3 not found on PATH"; exit 1; }
[ -d "$SQL_DIR" ] || { echo "ERROR: sql/ not found at $SQL_DIR"; exit 1; }
: "${PGUSER:?ERROR: set PGUSER to a PostgreSQL admin/superuser}"
: "${SMTP_HOST:?ERROR: set SMTP_HOST}"
: "${SMTP_FROM:?ERROR: set SMTP_FROM (a verified sender)}"
: "${TOTP_ISSUER:?ERROR: set TOTP_ISSUER}"

if [ -e "$ENV_FILE" ]; then
  echo "ERROR: $ENV_FILE already exists. Back it up / remove it before re-running."
  exit 1
fi

psql_admin() { psql -v ON_ERROR_STOP=1 -X -q "$@"; }

# ---- 2. Generate secrets (never echoed) -------------------------------------
gen() { python3 -c "import secrets;print(secrets.token_urlsafe(${1}))"; }   # URL-safe: [A-Za-z0-9_-]
FLASK_SECRET_KEY="$(gen 64)"
AES_ENCRYPTION_KEY="$(python3 -c "import os,base64;print(base64.b64encode(os.urandom(32)).decode())")"
APP_PW="$(gen 24)"; AW_PW="$(gen 24)"; AR_PW="$(gen 24)"

# ---- 3. Database -------------------------------------------------------------
DB_EXISTS="$(psql_admin -tAc "SELECT 1 FROM pg_database WHERE datname='${DB_NAME}'" postgres || true)"
if [ "$DB_EXISTS" = "1" ]; then
  if [ "$RECREATE_DB" = "1" ]; then
    echo "WARNING: RECREATE_DB=1 — dropping existing database '${DB_NAME}'"
    psql_admin -c "DROP DATABASE \"${DB_NAME}\"" postgres
  else
    echo "ERROR: database '${DB_NAME}' already exists. Use a fresh DB_NAME, or set"
    echo "       RECREATE_DB=1 to drop and recreate it (DESTRUCTIVE)."
    exit 1
  fi
fi
psql_admin -c "CREATE DATABASE \"${DB_NAME}\"" postgres
echo "Created database '${DB_NAME}'."

# ---- 4. Schema, roles, grants, seed -----------------------------------------
for f in 01_schemas_roles 02_application 03_session 04_audit 05_grants 06_seed_billers; do
  psql_admin -d "$DB_NAME" -f "$SQL_DIR/$f.sql"
done
echo "Applied schema + grants + biller seed."

# ---- 5. Strong, unique role passwords ---------------------------------------
psql_admin -d "$DB_NAME" \
  -c "ALTER ROLE app_user     PASSWORD '${APP_PW}';" \
  -c "ALTER ROLE audit_writer PASSWORD '${AW_PW}';" \
  -c "ALTER ROLE admin_reader PASSWORD '${AR_PW}';"
echo "Set strong, unique passwords for the three DB roles."

# ---- 6. Write .env (0600) ----------------------------------------------------
umask 077
cat > "$ENV_FILE" <<EOF
# SecureBank PRODUCTION .env — generated $(date -u +%FT%TZ). DO NOT COMMIT (gitignored).
# Consider loading these from your secret manager instead of a file on disk.
FLASK_SECRET_KEY=${FLASK_SECRET_KEY}
AES_ENCRYPTION_KEY=${AES_ENCRYPTION_KEY}

DATABASE_URL_APP=postgresql+psycopg2://app_user:${APP_PW}@${APP_DB_HOST}:${APP_DB_PORT}/${DB_NAME}
DATABASE_URL_AUDIT_WRITER=postgresql+psycopg2://audit_writer:${AW_PW}@${APP_DB_HOST}:${APP_DB_PORT}/${DB_NAME}
DATABASE_URL_ADMIN_READER=postgresql+psycopg2://admin_reader:${AR_PW}@${APP_DB_HOST}:${APP_DB_PORT}/${DB_NAME}

SMTP_HOST=${SMTP_HOST}
SMTP_PORT=${SMTP_PORT}
SMTP_USER=${SMTP_USER:-}
SMTP_PASSWORD=${SMTP_PASSWORD:-}
SMTP_FROM=${SMTP_FROM}

TOTP_ISSUER=${TOTP_ISSUER}
FORCE_HTTPS=${FORCE_HTTPS}

# In-app periodic cleanup (§9.2); advisory-lock-gated so it's multi-container safe.
# Set 0 to disable and use cron (flask --app app cleanup) instead.
CLEANUP_INTERVAL_SECONDS=${CLEANUP_INTERVAL_SECONDS:-3600}
EOF
chmod 600 "$ENV_FILE"

# ---- 7. Optional config validation (if app deps are importable) --------------
if (cd "$BACKEND_DIR" && python3 -c "import flask, sqlalchemy" >/dev/null 2>&1); then
  (cd "$BACKEND_DIR" && python3 -c "
from app import create_app
from sqlalchemy import text
from app.extensions import db
app = create_app()  # fails fast if .env is incomplete
with db.app_engine.connect() as c:
    c.execute(text('SELECT 1'))
print('Config + DB connectivity validated.')")
else
  echo "NOTE: app dependencies not importable here; skipped boot validation."
  echo "      Install them on the app host: pip install -r ${BACKEND_DIR}/requirements.txt"
fi

cat <<EOF

Production setup complete.
  Database : ${DB_NAME} @ ${APP_DB_HOST}:${APP_DB_PORT}
  Env file : ${ENV_FILE}  (chmod 600, gitignored; secrets generated, not printed)

Next steps (infra — outside this script's scope):
  1. Install runtime deps on the app host:  pip install -r ${BACKEND_DIR}/requirements.txt
  2. Serve via a production WSGI server (e.g. gunicorn) behind nginx terminating TLS
     (TLS >= 1.2 + HTTP->HTTPS redirect at nginx; FORCE_HTTPS=${FORCE_HTTPS} so Talisman
     emits HSTS and honours X-Forwarded-Proto via ProxyFix).
  3. Schedule the cleanup job:  flask --app app cleanup   (e.g. hourly cron).
  4. Back up FLASK_SECRET_KEY and AES_ENCRYPTION_KEY securely — losing the AES key makes
     stored NRIC / TOTP seeds undecryptable.
EOF
