"""FR-01 registration + TOTP enrolment tests.

Covers: pending user creation with hashed/encrypted secrets, duplicate-email and
weak-password rejection, TOTP confirm activating the account, wrong-code failure +
lockout, TOTP rate-limit, and the HTTP endpoints. Unique emails per run keep tests
idempotent against the shared dev DB.
"""

from __future__ import annotations

import uuid
from urllib.parse import parse_qs, urlparse

import pyotp
import pytest
from sqlalchemy import func, select

from app.blueprints.auth.service import (
    DuplicateRegistration,
    EnrolmentError,
    RateLimited,
    confirm_totp_enrolment,
    register_customer,
)
from app.security import crypto
from app.security.validation import ValidationError


def _email() -> str:
    return f"reg-{uuid.uuid4().hex[:12]}@example.com"


def _secret_from_uri(uri: str) -> str:
    return parse_qs(urlparse(uri).query)["secret"][0]


def _register(app, **over):
    kwargs = dict(
        full_name="Tan Ah Kow",
        nric="S1234567D",
        email=_email(),
        password="Str0ng!Passw0rd",
        source_ip="203.0.113.5",
    )
    kwargs.update(over)
    with app.app_context():
        return kwargs, register_customer(**kwargs)


# --------------------------------------------------------------------------- #
# Service: register
# --------------------------------------------------------------------------- #

def test_register_creates_pending_user_with_protected_secrets(require_db, app):
    from app.extensions import db
    from app.models import ContactPreference, MfaBackupCode, User

    kwargs, result = _register(app)
    assert len(result.backup_codes) == 10
    assert result.provisioning_uri.startswith("otpauth://totp/")

    s = db.app_session()
    try:
        user = s.execute(select(User).where(User.email == kwargs["email"])).scalar_one()
        assert user.account_status == "pending"
        assert user.email_verified is False
        assert user.transaction_pin_hash is None  # PIN set later
        # Password hashed (not plaintext) and verifies.
        assert user.password_hash != kwargs["password"]
        assert crypto.verify_password(user.password_hash, kwargs["password"]) is True
        # NRIC encrypted (decrypts back) and masked.
        assert user.nric_masked == "S****567D"
        key = app.extensions["securebank_config"].aes_encryption_key
        assert crypto.aes_decrypt(user.nric_encrypted, key).decode() == "S1234567D"
        # TOTP seed stored encrypted (not the bare base32).
        assert user.totp_seed_encrypted is not None
        # Backup codes hashed, count 10, none stored in plaintext.
        codes = s.execute(
            select(MfaBackupCode).where(MfaBackupCode.user_id == user.user_id)
        ).scalars().all()
        assert len(codes) == 10
        assert all(c.code_hash not in result.backup_codes for c in codes)
        # A returned plaintext code verifies against exactly one stored hash.
        first = result.backup_codes[0]
        assert sum(crypto.verify_backup_code(c.code_hash, first) for c in codes) == 1
        # Contact preferences row created.
        assert s.execute(
            select(func.count()).select_from(ContactPreference).where(
                ContactPreference.user_id == user.user_id
            )
        ).scalar_one() == 1
    finally:
        s.close()


def test_register_duplicate_email_rejected(require_db, app):
    kwargs, _ = _register(app)
    with app.app_context():
        with pytest.raises(DuplicateRegistration):
            register_customer(**kwargs)


def test_register_weak_password_rejected(require_db, app):
    with app.app_context():
        with pytest.raises(ValidationError):
            register_customer(
                full_name="A B", nric="S1234567D", email=_email(),
                password="weak", source_ip="203.0.113.5",
            )


# --------------------------------------------------------------------------- #
# Service: confirm TOTP
# --------------------------------------------------------------------------- #

def test_confirm_totp_activates_account(require_db, app):
    from app.extensions import db
    from app.models import User

    kwargs, result = _register(app)
    code = pyotp.TOTP(_secret_from_uri(result.provisioning_uri)).now()
    with app.app_context():
        confirm_totp_enrolment(email=kwargs["email"], code=code, source_ip="203.0.113.5")

    s = db.app_session()
    try:
        user = s.execute(select(User).where(User.email == kwargs["email"])).scalar_one()
        assert user.account_status == "active"
    finally:
        s.close()


def test_confirm_totp_wrong_code_fails_and_locks(require_db, app):
    from app.config import Config
    from app.extensions import db
    from app.models import User

    kwargs, result = _register(app)
    with app.app_context():
        for _ in range(Config.ACCOUNT_LOCKOUT_THRESHOLD):
            with pytest.raises(EnrolmentError):
                confirm_totp_enrolment(email=kwargs["email"], code="000000",
                                       source_ip="203.0.113.5")
    s = db.app_session()
    try:
        user = s.execute(select(User).where(User.email == kwargs["email"])).scalar_one()
        assert user.failed_login_count >= Config.ACCOUNT_LOCKOUT_THRESHOLD
        assert user.account_status == "locked"
    finally:
        s.close()


def test_confirm_totp_rate_limited(require_db, app):
    from app.config import Config
    from app.extensions import db
    from app.models import User
    from app.security import lockout

    kwargs, result = _register(app)
    s = db.app_session()
    try:
        user = s.execute(select(User).where(User.email == kwargs["email"])).scalar_one()
        # Pre-seed the TOTP window to the limit WITHOUT tripping the lockout.
        for _ in range(Config.TOTP_RATE_LIMIT_PER_MIN):
            lockout.record_auth_attempt(s, user.user_id, "totp")
        s.commit()
    finally:
        s.close()
    code = pyotp.TOTP(_secret_from_uri(result.provisioning_uri)).now()
    with app.app_context():
        with pytest.raises(RateLimited):
            confirm_totp_enrolment(email=kwargs["email"], code=code, source_ip="203.0.113.5")


# --------------------------------------------------------------------------- #
# Endpoints
# --------------------------------------------------------------------------- #

_HTTPS = {"X-Forwarded-Proto": "https"}


def test_register_endpoint_201(require_db, api_client):
    r = api_client.post(
        "/auth/register",
        json={"full_name": "Lim Bee", "nric": "S7654321A",
              "email": _email(), "password": "Str0ng!Passw0rd"},
        headers=_HTTPS,
    )
    assert r.status_code == 201
    body = r.get_json()
    assert body["provisioning_uri"].startswith("otpauth://totp/")
    assert len(body["backup_codes"]) == 10
    # No secret material leaked beyond the one-time enrolment payload.
    assert "password" not in body and "totp_seed" not in body


def test_register_endpoint_validation_400(require_db, api_client):
    r = api_client.post(
        "/auth/register",
        json={"full_name": "X", "nric": "BAD", "email": "not-an-email", "password": "weak"},
        headers=_HTTPS,
    )
    assert r.status_code == 400
    assert "error" in r.get_json()


def test_verify_endpoint_200(require_db, api_client):
    email = _email()
    r1 = api_client.post(
        "/auth/register",
        json={"full_name": "Goh Tan", "nric": "S1112223J",
              "email": email, "password": "Str0ng!Passw0rd"},
        headers=_HTTPS,
    )
    secret = _secret_from_uri(r1.get_json()["provisioning_uri"])
    r2 = api_client.post(
        "/auth/register/verify-totp",
        json={"email": email, "code": pyotp.TOTP(secret).now()},
        headers=_HTTPS,
    )
    assert r2.status_code == 200
    assert r2.get_json()["status"] == "active"
