"""Shared pytest fixtures for the SecureBank backend test suite.

Required env vars are seeded with sensible local defaults *only if absent*, so the
suite runs out-of-the-box against the local dev DB but honours real env/CI values.
DB-backed tests are gated on :func:`db_available` and skip cleanly without a DB.
"""

from __future__ import annotations

import base64
import os
import secrets

import pytest

# Local-dev defaults; overridden by anything already in the environment / CI.
_DEFAULTS = {
    "FLASK_SECRET_KEY": secrets.token_urlsafe(48),
    "AES_ENCRYPTION_KEY": base64.b64encode(os.urandom(32)).decode(),
    "DATABASE_URL_APP": "postgresql+psycopg2://app_user:app_pw@127.0.0.1:5432/securebank_ddltest",
    "DATABASE_URL_AUDIT_WRITER": "postgresql+psycopg2://audit_writer:aw_pw@127.0.0.1:5432/securebank_ddltest",
    "DATABASE_URL_ADMIN_READER": "postgresql+psycopg2://admin_reader:ar_pw@127.0.0.1:5432/securebank_ddltest",
    "SMTP_HOST": "localhost",
    "SMTP_PORT": "587",
    "SMTP_FROM": "no-reply@securebank.example",
    "TOTP_ISSUER": "SecureBank",
    "FORCE_HTTPS": "true",  # exercise HSTS + redirect; tests pass XFP=https where they need 200
    "CLEANUP_INTERVAL_SECONDS": "0",  # don't spawn the background cleanup thread in tests
}
for _k, _v in _DEFAULTS.items():
    os.environ.setdefault(_k, _v)


@pytest.fixture(scope="session")
def app():
    """A fully wired application built by the factory (engines built, not connected)."""
    from app import create_app

    application = create_app()
    application.config.update(TESTING=True)

    # Test-only state-changing route to exercise CSRF (real routes arrive with FRs).
    @application.post("/__csrf_probe")
    def _csrf_probe():  # pragma: no cover - trivial
        return "ok"

    return application


@pytest.fixture()
def client(app):
    """A Flask test client."""
    return app.test_client()


@pytest.fixture(scope="session")
def db_available(app) -> bool:
    """True if the live DB answers; DB-backed tests skip when it doesn't."""
    from sqlalchemy import text

    from app.extensions import db

    try:
        with db.app_engine.connect() as conn:
            conn.execute(text("SELECT 1"))
        return True
    except Exception:
        return False


@pytest.fixture()
def require_db(db_available):
    """Skip a test unless the live DB is reachable."""
    if not db_available:
        pytest.skip("live database not reachable")


@pytest.fixture(scope="session")
def api_client():
    """Client for endpoint logic tests with CSRF disabled (CSRF is tested separately).

    Requests should still send ``X-Forwarded-Proto: https`` to satisfy force_https.
    """
    from app import create_app

    application = create_app()
    application.config.update(TESTING=True, WTF_CSRF_ENABLED=False)
    return application.test_client()
