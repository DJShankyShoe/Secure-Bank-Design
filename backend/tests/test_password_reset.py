"""FR-09 forgot-password / password-reset tests.

Covers: link sent only to a registered address (anti-enumeration), the new
password takes effect while the old one stops working, the TOTP/backup-code
step-up (second factor), single-use token, new-password policy re-validation,
per-account rate-limiting, that a reset unlocks a brute-force-locked account, and
that a reset revokes existing sessions (SR-13).
"""

from __future__ import annotations

import uuid
from urllib.parse import parse_qs, urlparse

import pyotp
import pytest

from app.blueprints.auth.login_service import (
    InvalidCredentials,
    login_mfa,
    login_password,
)
from app.blueprints.auth.service import confirm_totp_enrolment, register_customer
from conftest import activate_signup_email

_HTTPS = "https://localhost"
_IP = "203.0.113.21"
_PW = "Str0ng!Passw0rd"
_NEW_PW = "N3w!Str0ngPassw0rd"
_NRIC = "S1234567D"   # the NRIC every test user registers with


@pytest.fixture(scope="module")
def reset_app():
    from app import create_app

    a = create_app()
    a.config.update(TESTING=True, WTF_CSRF_ENABLED=False)
    return a


def _email() -> str:
    return f"reset-{uuid.uuid4().hex[:12]}@example.com"


def _register_active(app) -> dict:
    email = _email()
    with app.app_context():
        res = register_customer(full_name="Reset User", nric="S1234567D", email=email,
                                password=_PW, source_ip=_IP)
        secret = parse_qs(urlparse(res.provisioning_uri).query)["secret"][0]
        confirm_totp_enrolment(email=email, code=pyotp.TOTP(secret).now(), source_ip=_IP)
        activate_signup_email(app, email)  # FR-01: verify signup email
    return {"email": email, "secret": secret, "user_id": res.user_id,
            "backup_codes": res.backup_codes}


def _totp(u) -> str:
    return pyotp.TOTP(u["secret"]).now()


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
    # token now lives inside a clickable link: .../reset-password?token=<tok>
    return body.split("token=")[1].split()[0].strip()


def _request_token(app, c, email, nric=_NRIC) -> str:
    _outbox(app).clear()
    r = c.post("/auth/password/reset/request",
               json={"email": email, "nric": nric}, base_url=_HTTPS)
    assert r.status_code == 200
    return _token_from(_to(app, email)[0]["body"])


def _verify(c, token, new_password, totp_code):
    return c.post("/auth/password/reset/verify",
                  json={"token": token, "new_password": new_password,
                        "totp_code": totp_code},
                  base_url=_HTTPS)


# --------------------------------------------------------------------------- #

def test_request_and_reset_changes_password(require_db, reset_app):
    u = _register_active(reset_app)
    c = reset_app.test_client()
    token = _request_token(reset_app, c, u["email"])

    assert _verify(c, token, _NEW_PW, _totp(u)).status_code == 200
    with reset_app.app_context():
        # New password works...
        assert isinstance(login_password(email=u["email"], password=_NEW_PW, source_ip=_IP), str)
        # ...and the old password no longer does.
        with pytest.raises(InvalidCredentials):
            login_password(email=u["email"], password=_PW, source_ip=_IP)


def test_reset_requires_valid_second_factor(require_db, reset_app):
    u = _register_active(reset_app)
    c = reset_app.test_client()
    token = _request_token(reset_app, c, u["email"])

    # Valid link + valid new password but WRONG code -> 401, no change.
    assert _verify(c, token, _NEW_PW, "000000").status_code == 401
    with reset_app.app_context():
        assert isinstance(login_password(email=u["email"], password=_PW, source_ip=_IP), str)


def test_request_with_wrong_nric_sends_nothing(require_db, reset_app):
    # A link is issued only when email AND NRIC match; wrong NRIC -> generic 200,
    # no email (so it can't be used to enumerate accounts either).
    u = _register_active(reset_app)
    c = reset_app.test_client()
    _outbox(reset_app).clear()
    r = c.post("/auth/password/reset/request",
               json={"email": u["email"], "nric": "S9999999Z"}, base_url=_HTTPS)
    assert r.status_code == 200
    assert _to(reset_app, u["email"]) == []   # correct email but wrong NRIC -> silent


def test_reset_accepts_backup_code_as_second_factor(require_db, reset_app):
    u = _register_active(reset_app)
    c = reset_app.test_client()
    token = _request_token(reset_app, c, u["email"])

    assert _verify(c, token, _NEW_PW, u["backup_codes"][0]).status_code == 200
    with reset_app.app_context():
        assert isinstance(login_password(email=u["email"], password=_NEW_PW, source_ip=_IP), str)


def test_reset_second_factor_is_rate_limited(require_db, reset_app):
    from app.config import Config

    u = _register_active(reset_app)
    c = reset_app.test_client()
    token = _request_token(reset_app, c, u["email"])

    # Hammer the step-up with wrong codes: early tries are 401 (bad code); once the
    # shared 5/min TOTP window fills, further tries are 429 (SR-11) — and this does
    # NOT trip the account lockout, so a link-holder can't DoS the real user.
    statuses = [_verify(c, token, _NEW_PW, "000000").status_code
                for _ in range(Config.TOTP_RATE_LIMIT_PER_MIN + 1)]
    assert 401 in statuses and 429 in statuses
    # A correct code is also refused while the window is exhausted.
    assert _verify(c, token, _NEW_PW, _totp(u)).status_code == 429
    # Password was never changed (the original still logs in).
    with reset_app.app_context():
        assert isinstance(login_password(email=u["email"], password=_PW, source_ip=_IP), str)


def test_reset_token_is_single_use(require_db, reset_app):
    u = _register_active(reset_app)
    c = reset_app.test_client()
    token = _request_token(reset_app, c, u["email"])

    assert _verify(c, token, _NEW_PW, _totp(u)).status_code == 200
    # Re-using the same link after the password changed is rejected.
    assert _verify(c, token, "An0ther!Passw0rd", _totp(u)).status_code == 400


def test_reset_weak_password_rejected_400(require_db, reset_app):
    u = _register_active(reset_app)
    c = reset_app.test_client()
    token = _request_token(reset_app, c, u["email"])
    assert _verify(c, token, "weak", _totp(u)).status_code == 400
    with reset_app.app_context():
        assert isinstance(login_password(email=u["email"], password=_PW, source_ip=_IP), str)


def test_request_unknown_email_is_generic_and_silent(require_db, reset_app):
    c = reset_app.test_client()
    _outbox(reset_app).clear()
    unknown = _email()
    r = c.post("/auth/password/reset/request", json={"email": unknown}, base_url=_HTTPS)
    assert r.status_code == 200            # generic
    assert _to(reset_app, unknown) == []   # no link for a non-existent account


def test_verify_bad_token_400(require_db, reset_app):
    c = reset_app.test_client()
    assert _verify(c, "garbage", _NEW_PW, "123456").status_code == 400


def test_reset_check_token(require_db, reset_app):
    u = _register_active(reset_app)
    c = reset_app.test_client()
    token = _request_token(reset_app, c, u["email"])

    def _valid(tok):
        return c.get(f"/auth/password/reset/check?token={tok}",
                     base_url=_HTTPS).get_json()["valid"]

    assert _valid(token) is True          # fresh token is valid
    assert _valid("garbage") is False     # junk token is not
    # after the reset consumes it, the same token is no longer valid (single-use)
    assert _verify(c, token, _NEW_PW, _totp(u)).status_code == 200
    assert _valid(token) is False


def test_request_is_rate_limited(require_db, reset_app):
    from app.config import Config

    u = _register_active(reset_app)
    c = reset_app.test_client()
    _outbox(reset_app).clear()
    for _ in range(Config.EMAIL_ACTION_LIMIT_PER_HOUR + 2):
        assert c.post("/auth/password/reset/request",
                      json={"email": u["email"], "nric": _NRIC},
                      base_url=_HTTPS).status_code == 200
    assert len(_to(reset_app, u["email"])) == Config.EMAIL_ACTION_LIMIT_PER_HOUR


def test_locked_account_can_reset_and_unlocks(require_db, reset_app):
    u = _register_active(reset_app)
    _lock(reset_app, u["email"])
    c = reset_app.test_client()
    token = _request_token(reset_app, c, u["email"])
    assert _verify(c, token, _NEW_PW, _totp(u)).status_code == 200
    # Account is active again and the new password logs in.
    with reset_app.app_context():
        assert isinstance(login_password(email=u["email"], password=_NEW_PW, source_ip=_IP), str)


def test_reset_revokes_existing_sessions(require_db, reset_app):
    from app.extensions import db
    from app.security.sessions import validate_session

    u = _register_active(reset_app)
    with reset_app.app_context():
        mfa = login_password(email=u["email"], password=_PW, source_ip=_IP)
        sid = login_mfa(mfa_token=mfa, code=_totp(u), source_ip=_IP)

    c = reset_app.test_client()
    token = _request_token(reset_app, c, u["email"])
    assert _verify(c, token, _NEW_PW, _totp(u)).status_code == 200

    # The pre-reset session is now revoked (SR-13).
    s = db.app_session()
    try:
        assert validate_session(s, sid) is None
    finally:
        s.close()
