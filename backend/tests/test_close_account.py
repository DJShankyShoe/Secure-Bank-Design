"""FR-05 close account tests: zero-balance + fresh TOTP step-up, IDOR, audit."""

from __future__ import annotations

import uuid
from urllib.parse import parse_qs, urlparse

import pyotp
import pytest

from app.blueprints.auth.login_service import login_password
from app.blueprints.auth.service import confirm_totp_enrolment, register_customer
from conftest import activate_signup_email, approve_account

_HTTPS = "https://localhost"
_IP = "203.0.113.10"
_PW = "Str0ng!Passw0rd"


@pytest.fixture(scope="module")
def close_app():
    from app import create_app

    a = create_app()
    a.config.update(TESTING=True, WTF_CSRF_ENABLED=False)
    return a


def _email() -> str:
    return f"close-{uuid.uuid4().hex[:12]}@example.com"


def _login(app):
    email = _email()
    with app.app_context():
        res = register_customer(full_name="Close User", nric="S1234567D", email=email,
                                password=_PW, source_ip=_IP)
        secret = parse_qs(urlparse(res.provisioning_uri).query)["secret"][0]
        confirm_totp_enrolment(email=email, code=pyotp.TOTP(secret).now(), source_ip=_IP)
        activate_signup_email(app, email)  # FR-01: verify signup email
        token = login_password(email=email, password=_PW, source_ip=_IP)
    c = app.test_client()
    c.post("/auth/login/mfa", json={"mfa_token": token, "code": pyotp.TOTP(secret).now()},
           base_url=_HTTPS)
    return c, secret


def _account(c):
    a = c.post("/accounts", json={"account_type": "savings"}, base_url=_HTTPS).get_json()
    approve_account(a["account_id"])  # FR-02: new accounts need admin approval
    return a


def _fund(account_id: str, cents: int):
    from app.extensions import db
    from app.models import Account

    s = db.app_session()
    try:
        acct = s.get(Account, uuid.UUID(account_id))
        acct.balance_cents = cents
        s.commit()
    finally:
        s.close()


def _close(c, account_id, code):
    return c.post(f"/accounts/{account_id}/close", json={"totp_code": code}, base_url=_HTTPS)


def test_close_zero_balance_with_totp(require_db, close_app):
    c, secret = _login(close_app)
    acc = _account(c)
    r = _close(c, acc["account_id"], pyotp.TOTP(secret).now())
    assert r.status_code == 200
    # Close is now a REQUEST awaiting admin approval, not an immediate close.
    assert r.get_json()["status"] == "close_requested"
    assert c.get(f"/accounts/{acc['account_id']}",
                 base_url=_HTTPS).get_json()["status"] == "close_requested"


def test_close_nonzero_balance_400(require_db, close_app):
    c, secret = _login(close_app)
    acc = _account(c)
    _fund(acc["account_id"], 5_000)
    r = _close(c, acc["account_id"], pyotp.TOTP(secret).now())
    assert r.status_code == 400
    assert c.get(f"/accounts/{acc['account_id']}", base_url=_HTTPS).get_json()["status"] == "active"


def test_close_wrong_totp_401(require_db, close_app):
    c, _ = _login(close_app)
    acc = _account(c)
    r = _close(c, acc["account_id"], "000000")
    assert r.status_code == 401
    assert c.get(f"/accounts/{acc['account_id']}", base_url=_HTTPS).get_json()["status"] == "active"


def test_close_other_users_account_404(require_db, close_app):
    owner, _ = _login(close_app)
    acc = _account(owner)
    attacker, a_secret = _login(close_app)
    r = _close(attacker, acc["account_id"], pyotp.TOTP(a_secret).now())
    assert r.status_code == 404


def test_close_requires_auth_401(require_db, close_app):
    c = close_app.test_client()
    r = _close(c, str(uuid.uuid4()), "123456")
    assert r.status_code == 401


def test_close_already_closed_400(require_db, close_app):
    c, secret = _login(close_app)
    acc = _account(c)
    assert _close(c, acc["account_id"], pyotp.TOTP(secret).now()).status_code == 200
    r = _close(c, acc["account_id"], pyotp.TOTP(secret).now())
    assert r.status_code == 400  # already has a pending closure request (not active)


def test_close_emits_audit(require_db, close_app):
    from sqlalchemy import text

    from app.extensions import db

    c, secret = _login(close_app)
    acc = _account(c)
    _close(c, acc["account_id"], pyotp.TOTP(secret).now())
    with db.admin_reader_engine.connect() as conn:
        n = conn.execute(
            text("SELECT count(*) FROM audit.audit_events "
                 "WHERE event_type='ACCOUNT_CLOSURE_REQUEST' "
                 "AND outcome='success' AND action_detail->>'account_id' = :a"),
            {"a": acc["account_id"]},
        ).scalar_one()
    assert n == 1
