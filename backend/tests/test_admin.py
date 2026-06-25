"""FR-08 admin tests: RBAC, suspend/unlock, audit read, admin close, NRIC reveal."""

from __future__ import annotations

import uuid
from urllib.parse import parse_qs, urlparse

import pyotp
import pytest
from sqlalchemy import select, text

from app.blueprints.auth.login_service import InvalidCredentials, login_password
from app.blueprints.auth.service import confirm_totp_enrolment, register_customer

_HTTPS = "https://localhost"
_IP = "203.0.113.12"
_PW = "Str0ng!Passw0rd"


@pytest.fixture(scope="module")
def admin_app():
    from app import create_app

    a = create_app()
    a.config.update(TESTING=True, WTF_CSRF_ENABLED=False)
    return a


def _email() -> str:
    return f"adm-{uuid.uuid4().hex[:12]}@example.com"


def _register(app, role="customer") -> dict:
    email = _email()
    with app.app_context():
        res = register_customer(full_name="Adm User", nric="S1234567D", email=email,
                                password=_PW, source_ip=_IP)
        secret = parse_qs(urlparse(res.provisioning_uri).query)["secret"][0]
        confirm_totp_enrolment(email=email, code=pyotp.TOTP(secret).now(), source_ip=_IP)
        if role == "admin":
            from app.extensions import db
            from app.models import User

            s = db.app_session()
            try:
                u = s.execute(select(User).where(User.email == email)).scalar_one()
                u.role = "admin"
                s.commit()
            finally:
                s.close()
    return {"email": email, "secret": secret, "user_id": str(res.user_id)}


def _client(app, creds):
    with app.app_context():
        token = login_password(email=creds["email"], password=_PW, source_ip=_IP)
    c = app.test_client()
    c.post("/auth/login/mfa", json={"mfa_token": token, "code": pyotp.TOTP(creds["secret"]).now()},
           base_url=_HTTPS)
    return c


@pytest.fixture(scope="module")
def admin_client(admin_app):
    return _client(admin_app, _register(admin_app, role="admin"))


def _audit_count(app, **eq) -> int:
    from app.extensions import db

    where = " AND ".join(f"{k} = :{k}" for k in eq)
    with db.admin_reader_engine.connect() as conn:
        return conn.execute(
            text(f"SELECT count(*) FROM audit.audit_events WHERE {where}"), eq
        ).scalar_one()


# --------------------------------------------------------------------------- #

def test_customer_denied_admin_endpoints_403(require_db, admin_app):
    cust = _client(admin_app, _register(admin_app))
    assert cust.get("/admin/users", base_url=_HTTPS).status_code == 403


def test_admin_lists_users_and_accounts(require_db, admin_app, admin_client):
    target = _register(admin_app)
    r = admin_client.get("/admin/users", base_url=_HTTPS)
    assert r.status_code == 200
    assert any(u["user_id"] == target["user_id"] for u in r.get_json()["users"])
    assert admin_client.get("/admin/accounts", base_url=_HTTPS).status_code == 200


def test_admin_suspend_blocks_login_and_logs(require_db, admin_app, admin_client):
    target = _register(admin_app)
    r = admin_client.post(f"/admin/users/{target['user_id']}/suspend",
                          json={"reason": "fraud review"}, base_url=_HTTPS)
    assert r.status_code == 200
    with admin_app.app_context():
        with pytest.raises(InvalidCredentials):
            login_password(email=target["email"], password=_PW, source_ip=_IP)
    # Action audited with the admin as actor (FR-08 "admin access is logged").
    assert _audit_count(admin_app, event_type="ADMIN_SUSPEND_USER",
                        target_user_id=target["user_id"], actor_role="admin") == 1


def test_admin_suspend_requires_reason_400(require_db, admin_app, admin_client):
    target = _register(admin_app)
    r = admin_client.post(f"/admin/users/{target['user_id']}/suspend",
                          json={}, base_url=_HTTPS)
    assert r.status_code == 400


def test_admin_unlock_reactivates(require_db, admin_app, admin_client):
    target = _register(admin_app)
    with admin_app.app_context():
        for _ in range(5):  # lock the account
            with pytest.raises(InvalidCredentials):
                login_password(email=target["email"], password="WrongPass123!", source_ip=_IP)
    r = admin_client.post(f"/admin/users/{target['user_id']}/unlock", base_url=_HTTPS)
    assert r.status_code == 200
    with admin_app.app_context():
        assert isinstance(login_password(email=target["email"], password=_PW, source_ip=_IP), str)


def test_admin_reveal_nric_audited(require_db, admin_app, admin_client):
    target = _register(admin_app)
    r = admin_client.get(f"/admin/users/{target['user_id']}/nric", base_url=_HTTPS)
    assert r.status_code == 200
    body = r.get_json()
    assert body["nric"] == "S1234567D" and body["nric_masked"] == "S****567D"
    assert _audit_count(admin_app, event_type="NRIC_REVEAL",
                        target_user_id=target["user_id"]) == 1


def test_admin_close_account_with_reason(require_db, admin_app, admin_client):
    target = _register(admin_app)
    cust = _client(admin_app, target)
    acc = cust.post("/accounts", json={"account_type": "savings"}, base_url=_HTTPS).get_json()
    # Missing reason -> 400.
    assert admin_client.post(f"/admin/accounts/{acc['account_id']}/close", json={},
                            base_url=_HTTPS).status_code == 400
    r = admin_client.post(f"/admin/accounts/{acc['account_id']}/close",
                          json={"reason": "customer request"}, base_url=_HTTPS)
    assert r.status_code == 200 and r.get_json()["status"] == "closed"
    assert _audit_count(admin_app, event_type="ADMIN_CLOSE_ACCOUNT",
                        target_user_id=target["user_id"], outcome="success") == 1


def test_admin_close_nonzero_balance_400(require_db, admin_app, admin_client):
    from app.extensions import db
    from app.models import Account

    target = _register(admin_app)
    cust = _client(admin_app, target)
    acc = cust.post("/accounts", json={"account_type": "savings"}, base_url=_HTTPS).get_json()
    s = db.app_session()
    try:
        a = s.get(Account, uuid.UUID(acc["account_id"]))
        a.balance_cents = 1000
        s.commit()
    finally:
        s.close()
    assert admin_client.post(f"/admin/accounts/{acc['account_id']}/close",
                            json={"reason": "x"}, base_url=_HTTPS).status_code == 400


def test_admin_reads_audit_log(require_db, admin_client):
    r = admin_client.get("/admin/audit", base_url=_HTTPS)
    assert r.status_code == 200
    body = r.get_json()
    assert isinstance(body["items"], list) and len(body["items"]) >= 1
    assert "event_type" in body["items"][0]


def test_admin_endpoints_require_auth_401(require_db, admin_app):
    c = admin_app.test_client()
    assert c.get("/admin/users", base_url=_HTTPS).status_code == 401
