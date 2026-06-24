"""Foundation regression tests.

Covers config fail-fast (SR-07), the factory's security gateway (SR-02/04/05,
), the ORM model round-trip, and the DB-level audit privilege boundary
(SR-14). DB-backed tests use the ``require_db`` gate and skip without a database.
"""

from __future__ import annotations

import base64
import os
import uuid

import pytest

from app.config import Config, ConfigError


def _good_env() -> dict[str, str]:
    """A complete, valid env mapping for Config.from_env()."""
    return {
        "FLASK_SECRET_KEY": "x" * 48,
        "DATABASE_URL_APP": "postgresql+psycopg2://app_user:p@localhost/db",
        "DATABASE_URL_AUDIT_WRITER": "postgresql+psycopg2://audit_writer:p@localhost/db",
        "DATABASE_URL_ADMIN_READER": "postgresql+psycopg2://admin_reader:p@localhost/db",
        "AES_ENCRYPTION_KEY": base64.b64encode(os.urandom(32)).decode(),
        "SMTP_HOST": "localhost",
        "SMTP_PORT": "587",
        "SMTP_FROM": "no-reply@sb.example",
        "TOTP_ISSUER": "SecureBank",
    }


# --------------------------------------------------------------------------- #
# Config — fail fast (SR-07)
# --------------------------------------------------------------------------- #

def test_config_empty_env_fails_fast():
    with pytest.raises(ConfigError) as exc:
        Config.from_env({})
    assert "Missing required" in str(exc.value)


def test_config_valid_env_builds():
    cfg = Config.from_env(_good_env())
    assert len(cfg.aes_encryption_key) == 32
    assert cfg.smtp_port == 587
    assert cfg.smtp_user is None  # optional, absent
    assert cfg.force_https is True  # default when unset


def test_config_rejects_short_aes_key():
    env = _good_env()
    env["AES_ENCRYPTION_KEY"] = base64.b64encode(os.urandom(16)).decode()
    with pytest.raises(ConfigError):
        Config.from_env(env)


def test_config_rejects_non_base64_aes_key():
    env = _good_env()
    env["AES_ENCRYPTION_KEY"] = "not base64!!"
    with pytest.raises(ConfigError):
        Config.from_env(env)


def test_config_rejects_non_integer_port():
    env = _good_env()
    env["SMTP_PORT"] = "abc"
    with pytest.raises(ConfigError):
        Config.from_env(env)


def test_config_thresholds_centralised():
    # The security knobs the spec pins (decisions).
    assert Config.PIN_THRESHOLD_CENTS == 100_000
    assert Config.ACCOUNT_LOCKOUT_THRESHOLD == 5
    assert Config.DB_STATEMENT_TIMEOUT_MS == 5000
    # Password and PIN Argon2 params must differ (SR-12).
    assert (Config.ARGON2_PASSWORD_MEMORY_KIB, Config.ARGON2_PASSWORD_TIME_COST) == (65536, 3)
    assert (Config.ARGON2_PIN_MEMORY_KIB, Config.ARGON2_PIN_TIME_COST) == (32768, 2)
    assert Config.ARGON2_PIN_MEMORY_KIB != Config.ARGON2_PASSWORD_MEMORY_KIB


# --------------------------------------------------------------------------- #
# Factory / security gateway (SR-02/04/05)
# --------------------------------------------------------------------------- #

def test_blueprints_registered(app):
    assert set(app.blueprints) == {"auth", "accounts", "transactions", "admin"}


def test_security_headers_present(client):
    r = client.get("/healthz", headers={"X-Forwarded-Proto": "https"})
    assert r.status_code == 200
    h = r.headers
    assert h["Strict-Transport-Security"] == "max-age=31536000; includeSubDomains"
    assert h["Content-Security-Policy"] == "default-src 'self'; script-src 'self'"
    assert h["X-Frame-Options"] == "DENY"
    assert h["X-Content-Type-Options"] == "nosniff"
    assert h["Referrer-Policy"] == "no-referrer"


def test_http_redirects_to_https(client):
    r = client.get("/healthz")  # no X-Forwarded-Proto -> insecure
    assert r.status_code in (301, 302)
    assert r.headers["Location"].startswith("https://")


def test_csrf_blocks_tokenless_post(client):
    r = client.post("/__csrf_probe", headers={"X-Forwarded-Proto": "https"})
    assert r.status_code == 403
    assert r.get_json() == {"error": "CSRF validation failed."}


def test_unknown_route_generic_json_404(client):
    r = client.get("/definitely-not-a-route", headers={"X-Forwarded-Proto": "https"})
    assert r.status_code == 404
    body = r.get_json()
    assert body == {"error": "Not Found"}
    # No stack trace / internal detail leaked (NFR-03).
    assert "Traceback" not in r.get_data(as_text=True)


# --------------------------------------------------------------------------- #
# ORM model round-trip — DB required
# --------------------------------------------------------------------------- #

def test_model_round_trip(require_db):
    from app.extensions import db
    from app.models import Account, Transaction, User

    s = db.app_session()
    try:
        u = User(
            email=f"rt-{uuid.uuid4().hex[:8]}@example.com",
            full_name="RT User",
            nric_encrypted=b"x" * 16,
            nric_masked="S****1A",
            password_hash="argon2",
            role="customer",
        )
        s.add(u)
        s.flush()
        # Server defaults applied by the DB.
        assert u.account_status == "active"
        assert u.email_verified is False
        assert u.created_at is not None

        a = Account(
            user_id=u.user_id,
            account_number=str(9_000_000_000 + (u.user_id.int % 1_000_000_000)),
            account_type="savings",
        )
        s.add(a)
        s.flush()
        assert a.balance_cents == 0

        t = Transaction(
            source_account_id=a.account_id,
            amount_cents=150_000,
            transaction_type="transfer",
            status="pending",
            reference_number=f"RT-{uuid.uuid4().hex[:10]}",
            idempotency_key=uuid.uuid4(),
        )
        s.add(t)
        s.flush()
        assert t.pin_verified is False
    finally:
        s.rollback()  # nothing persisted
        s.close()


# --------------------------------------------------------------------------- #
# Audit privilege boundary (SR-14) — DB required
# --------------------------------------------------------------------------- #

def test_audit_writer_is_insert_only(require_db):
    from sqlalchemy import text
    from sqlalchemy.exc import ProgrammingError

    from app.extensions import db

    insert = text(
        "INSERT INTO audit.audit_events(event_id,event_type,source_ip,outcome) "
        "VALUES (gen_random_uuid(),'TEST_EVENT','127.0.0.1','success')"
    )
    # INSERT is permitted (rolled back so nothing persists).
    with db.audit_writer_engine.connect() as conn:
        conn.execute(insert)
        conn.rollback()

    # SELECT / UPDATE / DELETE are denied at the DB level (append-only).
    for stmt in (
        "SELECT count(*) FROM audit.audit_events",
        "UPDATE audit.audit_events SET outcome='failure'",
        "DELETE FROM audit.audit_events",
    ):
        with db.audit_writer_engine.connect() as conn:
            with pytest.raises(ProgrammingError):
                conn.execute(text(stmt))


def test_app_user_has_no_audit_access(require_db):
    from sqlalchemy import text
    from sqlalchemy.exc import ProgrammingError

    from app.extensions import db

    with db.app_engine.connect() as conn:
        with pytest.raises(ProgrammingError):
            conn.execute(text("SELECT 1 FROM audit.audit_events"))


def test_admin_reader_can_select_not_write(require_db):
    from sqlalchemy import text
    from sqlalchemy.exc import DBAPIError

    from app.extensions import db

    with db.admin_reader_engine.connect() as conn:
        conn.execute(text("SELECT count(*) FROM audit.audit_events"))  # allowed
    # Writes are denied two ways: the SELECT-only grant (InsufficientPrivilege) and
    # the read-only transaction guard (ReadOnlySqlTransaction). Either is correct;
    # both derive from DBAPIError. The read-only guard fires first here.
    with db.admin_reader_engine.connect() as conn:
        with pytest.raises(DBAPIError):
            conn.execute(
                text(
                    "INSERT INTO audit.audit_events(event_id,event_type,source_ip,outcome) "
                    "VALUES (gen_random_uuid(),'X','127.0.0.1','success')"
                )
            )
