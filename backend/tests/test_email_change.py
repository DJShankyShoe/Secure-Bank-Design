"""FR-04 email change + 30-min re-verification tests."""

from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone
from urllib.parse import parse_qs, urlparse

import pyotp
import pytest

from app.blueprints.auth.login_service import InvalidCredentials, login_password
from app.blueprints.auth.service import confirm_totp_enrolment, register_customer

_HTTPS = "https://localhost"
_IP = "203.0.113.11"
_PW = "Str0ng!Passw0rd"


@pytest.fixture(scope="module")
def em_app():
    from app import create_app

    a = create_app()
    a.config.update(TESTING=True, WTF_CSRF_ENABLED=False)
    return a


def _email() -> str:
    return f"em-{uuid.uuid4().hex[:12]}@example.com"


def _register_active(app) -> str:
    email = _email()
    with app.app_context():
        res = register_customer(full_name="Em User", nric="S1234567D", email=email,
                                password=_PW, source_ip=_IP)
        secret = parse_qs(urlparse(res.provisioning_uri).query)["secret"][0]
        confirm_totp_enrolment(email=email, code=pyotp.TOTP(secret).now(), source_ip=_IP)
    return email, secret


def _login(app):
    email, secret = _register_active(app)
    with app.app_context():
        token = login_password(email=email, password=_PW, source_ip=_IP)
    c = app.test_client()
    c.post("/auth/login/mfa", json={"mfa_token": token, "code": pyotp.TOTP(secret).now()},
           base_url=_HTTPS)
    return c, email


def _outbox(app):
    return app.extensions.setdefault("email_outbox", [])


def _to(app, address):
    return [m for m in _outbox(app) if m["to"] == address]


def _token_from(body: str) -> str:
    # token now lives inside a clickable link: .../verify-email?token=<tok>
    return body.split("token=")[1].split()[0].strip()


# --------------------------------------------------------------------------- #

def test_request_sends_link_to_new_address(require_db, em_app):
    c, _ = _login(em_app)
    new = _email()
    _outbox(em_app).clear()
    r = c.post("/auth/email", json={"new_email": new}, base_url=_HTTPS)
    assert r.status_code == 200
    msgs = _to(em_app, new)
    assert len(msgs) == 1 and "token=" in msgs[0]["body"]


def test_old_address_gets_security_alert(require_db, em_app):
    c, old = _login(em_app)
    new = _email()
    _outbox(em_app).clear()
    c.post("/auth/email", json={"new_email": new}, base_url=_HTTPS)
    alerts = _to(em_app, old)
    assert len(alerts) == 1                      # the old address is alerted
    assert new in alerts[0]["body"]              # tells them the target address
    assert "token=" not in alerts[0]["body"]     # but carries no confirm token


def test_verify_swaps_email_and_login_follows(require_db, em_app):
    c, old = _login(em_app)
    new = _email()
    _outbox(em_app).clear()
    c.post("/auth/email", json={"new_email": new}, base_url=_HTTPS)
    token = _token_from(_to(em_app, new)[0]["body"])

    r = c.post("/auth/email/verify", json={"token": token}, base_url=_HTTPS)
    assert r.status_code == 200 and r.get_json()["email"] == new

    with em_app.app_context():
        assert isinstance(login_password(email=new, password=_PW, source_ip=_IP), str)
        with pytest.raises(InvalidCredentials):
            login_password(email=old, password=_PW, source_ip=_IP)


def test_request_same_email_400(require_db, em_app):
    c, old = _login(em_app)
    r = c.post("/auth/email", json={"new_email": old}, base_url=_HTTPS)
    assert r.status_code == 400


def test_request_to_taken_address_is_generic_and_silent(require_db, em_app):
    other_email, _ = _register_active(em_app)
    c, _ = _login(em_app)
    _outbox(em_app).clear()
    r = c.post("/auth/email", json={"new_email": other_email}, base_url=_HTTPS)
    assert r.status_code == 200  # generic, no leak
    assert _to(em_app, other_email) == []  # no email sent to the third party


def test_verify_bad_token_400(require_db, em_app):
    c, _ = _login(em_app)
    r = c.post("/auth/email/verify", json={"token": "not-a-real-token"}, base_url=_HTTPS)
    assert r.status_code == 400


def test_verify_expired_token_400(require_db, em_app):
    from sqlalchemy import select

    from app.extensions import db
    from app.models import PendingEmailChange, User

    c, old = _login(em_app)
    new = _email()
    _outbox(em_app).clear()
    c.post("/auth/email", json={"new_email": new}, base_url=_HTTPS)
    token = _token_from(_to(em_app, new)[0]["body"])

    # Force the pending row to be expired.
    s = db.app_session()
    try:
        uid = s.execute(select(User.user_id).where(User.email == old)).scalar_one()
        pend = s.execute(
            select(PendingEmailChange).where(PendingEmailChange.user_id == uid)
        ).scalar_one()
        pend.expires_at = datetime.now(timezone.utc) - timedelta(minutes=1)
        s.commit()
    finally:
        s.close()

    r = c.post("/auth/email/verify", json={"token": token}, base_url=_HTTPS)
    assert r.status_code == 400


def test_request_requires_auth_401(require_db, em_app):
    c = em_app.test_client()
    r = c.post("/auth/email", json={"new_email": _email()}, base_url=_HTTPS)
    assert r.status_code == 401


def test_email_change_is_rate_limited(require_db, em_app):
    from app.config import Config

    c, _ = _login(em_app)
    statuses = []
    for _ in range(Config.EMAIL_ACTION_LIMIT_PER_HOUR + 1):
        r = c.post("/auth/email", json={"new_email": _email()}, base_url=_HTTPS)
        statuses.append(r.status_code)
    assert statuses[:-1] == [200] * Config.EMAIL_ACTION_LIMIT_PER_HOUR
    assert statuses[-1] == 429   # over the per-account hourly cap
