"""Two-stage login + MFA tests (: FR-01, SR-09/11/13)."""

from __future__ import annotations

import uuid
from urllib.parse import parse_qs, urlparse

import pyotp
import pytest
from sqlalchemy import select

from app.blueprints.auth.login_service import (
    InvalidCredentials,
    login_mfa,
    login_password,
)
from app.blueprints.auth.service import confirm_totp_enrolment, register_customer

_IP = "203.0.113.9"


def _email() -> str:
    return f"login-{uuid.uuid4().hex[:12]}@example.com"


def _secret(uri: str) -> str:
    return parse_qs(urlparse(uri).query)["secret"][0]


def _register_and_activate(app) -> dict:
    email, password = _email(), "Str0ng!Passw0rd"
    with app.app_context():
        res = register_customer(
            full_name="Login User", nric="S1234567D", email=email,
            password=password, source_ip=_IP,
        )
        secret = _secret(res.provisioning_uri)
        confirm_totp_enrolment(email=email, code=pyotp.TOTP(secret).now(), source_ip=_IP)
    return {"email": email, "password": password, "secret": secret,
            "user_id": res.user_id, "backup_codes": res.backup_codes}


# --------------------------------------------------------------------------- #
# Stage 1: password
# --------------------------------------------------------------------------- #

def test_login_password_success_returns_token(require_db, app):
    u = _register_and_activate(app)
    with app.app_context():
        token = login_password(email=u["email"], password=u["password"], source_ip=_IP)
    assert isinstance(token, str) and len(token) > 0


def test_login_password_wrong_is_generic(require_db, app):
    u = _register_and_activate(app)
    with app.app_context():
        with pytest.raises(InvalidCredentials):
            login_password(email=u["email"], password="WrongPass123!", source_ip=_IP)


def test_login_unknown_user_same_generic_error(require_db, app):
    # Anti-enumeration: unknown user and wrong password are indistinguishable.
    with app.app_context():
        with pytest.raises(InvalidCredentials) as e1:
            login_password(email=_email(), password="whatever123!A", source_ip=_IP)
    u = _register_and_activate(app)
    with app.app_context():
        with pytest.raises(InvalidCredentials) as e2:
            login_password(email=u["email"], password="WrongPass123!", source_ip=_IP)
    assert e1.value.message == e2.value.message
    assert e1.value.status == e2.value.status == 401


def test_login_pending_account_rejected(require_db, app):
    # Registered but not TOTP-confirmed -> not active -> generic failure.
    email, password = _email(), "Str0ng!Passw0rd"
    with app.app_context():
        register_customer(full_name="Pending P", nric="S1234567D", email=email,
                          password=password, source_ip=_IP)
        with pytest.raises(InvalidCredentials):
            login_password(email=email, password=password, source_ip=_IP)


# --------------------------------------------------------------------------- #
# Stage 2: MFA
# --------------------------------------------------------------------------- #

def test_login_mfa_totp_success_creates_session(require_db, app):
    from app.extensions import db
    from app.models import SessionRecord

    u = _register_and_activate(app)
    with app.app_context():
        token = login_password(email=u["email"], password=u["password"], source_ip=_IP)
        sid = login_mfa(mfa_token=token, code=pyotp.TOTP(u["secret"]).now(), source_ip=_IP)
    assert isinstance(sid, str)
    s = db.app_session()
    try:
        rec = s.get(SessionRecord, sid)
        assert rec is not None and str(rec.user_id) == str(u["user_id"]) and rec.revoked is False
    finally:
        s.close()


def test_login_mfa_backup_code_one_time(require_db, app):
    u = _register_and_activate(app)
    code = u["backup_codes"][0]
    with app.app_context():
        token = login_password(email=u["email"], password=u["password"], source_ip=_IP)
        sid = login_mfa(mfa_token=token, code=code, source_ip=_IP)
        assert isinstance(sid, str)
        # Re-use of the same backup code now fails.
        token2 = login_password(email=u["email"], password=u["password"], source_ip=_IP)
        with pytest.raises(InvalidCredentials):
            login_mfa(mfa_token=token2, code=code, source_ip=_IP)


def test_login_mfa_wrong_code_fails(require_db, app):
    u = _register_and_activate(app)
    with app.app_context():
        token = login_password(email=u["email"], password=u["password"], source_ip=_IP)
        with pytest.raises(InvalidCredentials):
            login_mfa(mfa_token=token, code="000000", source_ip=_IP)


def test_login_mfa_bad_token_fails(require_db, app):
    with app.app_context():
        with pytest.raises(InvalidCredentials):
            login_mfa(mfa_token="not-a-valid-token", code="123456", source_ip=_IP)


# --------------------------------------------------------------------------- #
# Lockout across the flow (SR-09)
# --------------------------------------------------------------------------- #

def test_five_failed_passwords_lock_account(require_db, app):
    from app.config import Config
    from app.extensions import db
    from app.models import User

    u = _register_and_activate(app)
    with app.app_context():
        for _ in range(Config.ACCOUNT_LOCKOUT_THRESHOLD):
            with pytest.raises(InvalidCredentials):
                login_password(email=u["email"], password="WrongPass123!", source_ip=_IP)
        # Even the correct password is now refused (account locked).
        with pytest.raises(InvalidCredentials):
            login_password(email=u["email"], password=u["password"], source_ip=_IP)
    s = db.app_session()
    try:
        user = s.execute(select(User).where(User.email == u["email"])).scalar_one()
        assert user.account_status == "locked"
    finally:
        s.close()


# --------------------------------------------------------------------------- #
# Endpoints
# --------------------------------------------------------------------------- #

_HTTPS = {"X-Forwarded-Proto": "https"}


def test_login_endpoints_set_secure_cookie(require_db, api_client, app):
    u = _register_and_activate(app)
    r1 = api_client.post("/auth/login",
                         json={"email": u["email"], "password": u["password"]}, headers=_HTTPS)
    assert r1.status_code == 200
    token = r1.get_json()["mfa_token"]
    r2 = api_client.post("/auth/login/mfa",
                         json={"mfa_token": token, "code": pyotp.TOTP(u["secret"]).now()},
                         headers=_HTTPS)
    assert r2.status_code == 200
    set_cookie = r2.headers.get("Set-Cookie", "")
    assert "sb_session=" in set_cookie
    assert "HttpOnly" in set_cookie
    assert "SameSite=Strict" in set_cookie
    assert "Secure" in set_cookie


def test_login_endpoint_wrong_password_401_generic(require_db, api_client, app):
    u = _register_and_activate(app)
    r = api_client.post("/auth/login",
                        json={"email": u["email"], "password": "WrongPass123!"}, headers=_HTTPS)
    assert r.status_code == 401
    assert r.get_json() == {"error": "Invalid credentials."}


def test_logout_endpoint_clears_cookie(require_db, api_client):
    r = api_client.post("/auth/logout", headers=_HTTPS)
    assert r.status_code == 200
    # delete_cookie emits an expired Set-Cookie for sb_session.
    assert "sb_session=" in r.headers.get("Set-Cookie", "")


# --------------------------------------------------------------------------- #
# Hardening: CSRF bootstrap endpoint + tokens don't leak user_id
# --------------------------------------------------------------------------- #

def test_csrf_endpoint_returns_token(require_db, api_client):
    r = api_client.get("/auth/csrf", headers=_HTTPS)
    assert r.status_code == 200
    tok = r.get_json().get("csrf_token")
    assert isinstance(tok, str) and len(tok) > 0


def test_mfa_token_does_not_expose_user_id(require_db, app):
    import base64
    from app.blueprints.auth.login_service import issue_mfa_token, read_mfa_token

    u = _register_and_activate(app)
    uid = u["user_id"]  # a uuid.UUID
    with app.app_context():
        token = issue_mfa_token(uid)
        # itsdangerous payload is the FIRST dot-segment; decode it and confirm the
        # raw user_id is NOT present (it's AES-encrypted now, not plaintext base64).
        seg = token.split(".")[0]
        decoded = base64.urlsafe_b64decode(seg + "=" * (-len(seg) % 4)).decode("latin-1")
        assert str(uid) not in decoded
        assert uid.hex not in decoded
        # still round-trips back to the real uid
        assert read_mfa_token(token) == uid
