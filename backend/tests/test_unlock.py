"""SR-09 self-service account-unlock-link tests."""

from __future__ import annotations

import uuid
from urllib.parse import parse_qs, urlparse

import pyotp
import pytest

from app.blueprints.auth.login_service import InvalidCredentials, login_password
from app.blueprints.auth.service import confirm_totp_enrolment, register_customer
from conftest import activate_signup_email, unique_nric

_HTTPS = "https://localhost"
_IP = "203.0.113.13"
_PW = "Str0ng!Passw0rd"


@pytest.fixture(scope="module")
def unlock_app():
    from app import create_app

    a = create_app()
    a.config.update(TESTING=True, WTF_CSRF_ENABLED=False)
    return a


def _email() -> str:
    return f"unlock-{uuid.uuid4().hex[:12]}@example.com"


def _register_active(app) -> str:
    email = _email()
    with app.app_context():
        res = register_customer(full_name="Unlock User", nric=unique_nric(), email=email,
                                password=_PW, source_ip=_IP)
        secret = parse_qs(urlparse(res.provisioning_uri).query)["secret"][0]
        confirm_totp_enrolment(email=email, code=pyotp.TOTP(secret).now(), source_ip=_IP)
        activate_signup_email(app, email)  # FR-01: verify signup email
    return email


def _lock(app, email):
    with app.app_context():
        for _ in range(5):
            with pytest.raises(InvalidCredentials):
                login_password(email=email, password="WrongPass123!", source_ip=_IP)


def _outbox(app):
    return app.extensions.setdefault("email_outbox", [])


def _to(app, address):
    return [m for m in _outbox(app) if m["to"] == address]


def _token_from(body: str) -> str:
    # token now lives inside a clickable link: .../unlock?token=<tok>
    return body.split("token=")[1].split()[0].strip()


# --------------------------------------------------------------------------- #

def test_locked_account_can_request_and_unlock(require_db, unlock_app):
    email = _register_active(unlock_app)
    _lock(unlock_app, email)
    _outbox(unlock_app).clear()
    c = unlock_app.test_client()

    r = c.post("/auth/unlock/request", json={"email": email}, base_url=_HTTPS)
    assert r.status_code == 200
    msgs = _to(unlock_app, email)
    assert len(msgs) == 1
    token = _token_from(msgs[0]["body"])

    r2 = c.post("/auth/unlock/verify", json={"token": token}, base_url=_HTTPS)
    assert r2.status_code == 200
    # Account is active again: correct login now passes the password stage.
    with unlock_app.app_context():
        assert isinstance(login_password(email=email, password=_PW, source_ip=_IP), str)


def test_unlock_request_for_unlocked_account_sends_nothing(require_db, unlock_app):
    email = _register_active(unlock_app)  # active, not locked
    _outbox(unlock_app).clear()
    c = unlock_app.test_client()
    r = c.post("/auth/unlock/request", json={"email": email}, base_url=_HTTPS)
    assert r.status_code == 200  # generic
    assert _to(unlock_app, email) == []  # no link for a non-locked account


def test_unlock_request_unknown_email_generic(require_db, unlock_app):
    c = unlock_app.test_client()
    r = c.post("/auth/unlock/request", json={"email": _email()}, base_url=_HTTPS)
    assert r.status_code == 200


def test_unlock_verify_bad_token_400(require_db, unlock_app):
    c = unlock_app.test_client()
    r = c.post("/auth/unlock/verify", json={"token": "garbage"}, base_url=_HTTPS)
    assert r.status_code == 400


def test_unlock_request_is_rate_limited(require_db, unlock_app):
    from app.config import Config

    email = _register_active(unlock_app)
    _lock(unlock_app, email)
    _outbox(unlock_app).clear()
    c = unlock_app.test_client()
    for _ in range(Config.EMAIL_ACTION_LIMIT_PER_HOUR + 2):
        r = c.post("/auth/unlock/request", json={"email": email}, base_url=_HTTPS)
        assert r.status_code == 200
    # only the capped number of unlock emails actually went out
    assert len(_to(unlock_app, email)) == Config.EMAIL_ACTION_LIMIT_PER_HOUR
