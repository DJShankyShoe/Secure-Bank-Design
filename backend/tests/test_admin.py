"""FR-08 admin tests: RBAC, suspend/unlock, audit read, admin close, NRIC reveal."""

from __future__ import annotations

import uuid
from urllib.parse import parse_qs, urlparse

import pyotp
import pytest
from sqlalchemy import select, text

from app.blueprints.auth.login_service import InvalidCredentials, login_password
from app.blueprints.auth.service import confirm_totp_enrolment, register_customer
from conftest import activate_signup_email, approve_account

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
        activate_signup_email(app, email)  # FR-01: verify signup email
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
    approve_account(acc["account_id"])  # FR-02: make it active first
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
    approve_account(acc["account_id"])  # FR-02: make it active first
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


# --------------------------------------------------------------------------- #
# Customer-requested closure -> admin approve / reject (FR-05)
# --------------------------------------------------------------------------- #

def _request_closure(app, creds) -> str:
    """Customer opens an account and requests its closure; returns the account_id."""
    cust = _client(app, creds)
    acc = cust.post("/accounts", json={"account_type": "savings"}, base_url=_HTTPS).get_json()
    approve_account(acc["account_id"])  # FR-02: make it active first
    r = cust.post(f"/accounts/{acc['account_id']}/close",
                  json={"totp_code": pyotp.TOTP(creds["secret"]).now()}, base_url=_HTTPS)
    assert r.status_code == 200 and r.get_json()["status"] == "close_requested"
    return acc["account_id"]


def test_admin_approves_closure_request(require_db, admin_app, admin_client):
    target = _register(admin_app)
    acc_id = _request_closure(admin_app, target)
    r = admin_client.post(f"/admin/accounts/{acc_id}/closure/approve", base_url=_HTTPS)
    assert r.status_code == 200 and r.get_json()["status"] == "closed"
    assert _audit_count(admin_app, event_type="ADMIN_CLOSURE_APPROVE",
                        target_user_id=target["user_id"], outcome="success") == 1


def test_admin_rejects_closure_request_reactivates(require_db, admin_app, admin_client):
    target = _register(admin_app)
    acc_id = _request_closure(admin_app, target)
    # Reason is required.
    assert admin_client.post(f"/admin/accounts/{acc_id}/closure/reject", json={},
                             base_url=_HTTPS).status_code == 400
    r = admin_client.post(f"/admin/accounts/{acc_id}/closure/reject",
                          json={"reason": "keep it open"}, base_url=_HTTPS)
    assert r.status_code == 200 and r.get_json()["status"] == "active"
    assert _audit_count(admin_app, event_type="ADMIN_CLOSURE_REJECT",
                        target_user_id=target["user_id"], outcome="success") == 1


def test_admin_approve_without_pending_request_404(require_db, admin_app, admin_client):
    # An active account with no closure request cannot be approved.
    target = _register(admin_app)
    cust = _client(admin_app, target)
    acc = cust.post("/accounts", json={"account_type": "savings"}, base_url=_HTTPS).get_json()
    approve_account(acc["account_id"])  # active, but no closure request pending
    assert admin_client.post(f"/admin/accounts/{acc['account_id']}/closure/approve",
                             base_url=_HTTPS).status_code == 404


def test_admin_audit_filter_by_user(require_db, admin_app, admin_client):
    target = _register(admin_app)
    tid = target["user_id"]
    # Generate an event that involves this user (admin suspends them).
    admin_client.post(f"/admin/users/{tid}/suspend",
                      json={"reason": "audit filter test"}, base_url=_HTTPS)
    r = admin_client.get(f"/admin/audit?user={tid}", base_url=_HTTPS)
    assert r.status_code == 200
    items = r.get_json()["items"]
    assert len(items) >= 1
    # Every returned event involves this user as actor or target — and none belongs
    # only to some other user.
    assert all(tid in (i["actor_user_id"], i["target_user_id"]) for i in items)
    assert any(i["event_type"] == "ADMIN_SUSPEND_USER" for i in items)


def test_admin_audit_invalid_user_400(require_db, admin_client):
    assert admin_client.get("/admin/audit?user=not-a-uuid",
                            base_url=_HTTPS).status_code == 400


def test_admin_search_users_by_email(require_db, admin_app, admin_client):
    target = _register(admin_app)
    r = admin_client.get(f"/admin/users?q={target['email']}", base_url=_HTTPS)
    assert r.status_code == 200
    emails = [u["email"] for u in r.get_json()["users"]]
    assert emails == [target["email"]]   # the unique email matches exactly one user


def test_admin_search_users_no_match_is_empty(require_db, admin_client):
    r = admin_client.get("/admin/users?q=zzz-no-such-user-zzz", base_url=_HTTPS)
    assert r.status_code == 200 and r.get_json()["users"] == []


def test_admin_suspend_and_unsuspend_account(require_db, admin_app, admin_client):
    target = _register(admin_app)
    cust = _client(admin_app, target)
    aid = cust.post("/accounts", json={"account_type": "savings"},
                    base_url=_HTTPS).get_json()["account_id"]
    approve_account(aid)  # FR-02: make it active first
    # reason required
    assert admin_client.post(f"/admin/accounts/{aid}/suspend", json={},
                             base_url=_HTTPS).status_code == 400
    r = admin_client.post(f"/admin/accounts/{aid}/suspend",
                          json={"reason": "fraud review"}, base_url=_HTTPS)
    assert r.status_code == 200 and r.get_json()["status"] == "suspended"
    # the owner sees the account frozen (can view it, but it's non-active)
    assert cust.get(f"/accounts/{aid}", base_url=_HTTPS).get_json()["status"] == "suspended"
    # lift it -> active again
    r2 = admin_client.post(f"/admin/accounts/{aid}/unsuspend", base_url=_HTTPS)
    assert r2.status_code == 200 and r2.get_json()["status"] == "active"
    assert _audit_count(admin_app, event_type="ADMIN_SUSPEND_ACCOUNT",
                        target_user_id=target["user_id"], outcome="success") == 1


def test_admin_unsuspend_active_account_404(require_db, admin_app, admin_client):
    # Can't unsuspend an account that isn't suspended.
    target = _register(admin_app)
    cust = _client(admin_app, target)
    aid = cust.post("/accounts", json={"account_type": "savings"},
                    base_url=_HTTPS).get_json()["account_id"]
    approve_account(aid)  # active (not suspended)
    assert admin_client.post(f"/admin/accounts/{aid}/unsuspend",
                             base_url=_HTTPS).status_code == 404


def test_admin_lists_one_users_accounts(require_db, admin_app, admin_client):
    target = _register(admin_app)
    cust = _client(admin_app, target)
    cust.post("/accounts", json={"account_type": "savings"}, base_url=_HTTPS)
    cust.post("/accounts", json={"account_type": "current"}, base_url=_HTTPS)
    r = admin_client.get(f"/admin/users/{target['user_id']}/accounts", base_url=_HTTPS)
    assert r.status_code == 200
    accts = r.get_json()["accounts"]
    assert len(accts) == 2
    assert {a["account_type"] for a in accts} == {"savings", "current"}
    assert all({"account_number", "balance_cents", "status"} <= a.keys() for a in accts)


def test_admin_approves_account_opening(require_db, admin_app, admin_client):
    target = _register(admin_app)
    cust = _client(admin_app, target)
    acc = cust.post("/accounts", json={"account_type": "savings"}, base_url=_HTTPS).get_json()
    assert acc["status"] == "open_requested"   # new accounts are frozen pending approval
    r = admin_client.post(f"/admin/accounts/{acc['account_id']}/opening/approve",
                          base_url=_HTTPS)
    assert r.status_code == 200 and r.get_json()["status"] == "active"
    assert _audit_count(admin_app, event_type="ADMIN_OPEN_APPROVE",
                        target_user_id=target["user_id"], outcome="success") == 1


def test_admin_rejects_account_opening(require_db, admin_app, admin_client):
    target = _register(admin_app)
    cust = _client(admin_app, target)
    acc = cust.post("/accounts", json={"account_type": "current"}, base_url=_HTTPS).get_json()
    assert admin_client.post(f"/admin/accounts/{acc['account_id']}/opening/reject", json={},
                             base_url=_HTTPS).status_code == 400   # reason required
    r = admin_client.post(f"/admin/accounts/{acc['account_id']}/opening/reject",
                          json={"reason": "kyc failed"}, base_url=_HTTPS)
    assert r.status_code == 200 and r.get_json()["status"] == "closed"
    assert _audit_count(admin_app, event_type="ADMIN_OPEN_REJECT",
                        target_user_id=target["user_id"], outcome="success") == 1


def test_admin_approve_opening_on_active_account_404(require_db, admin_app, admin_client):
    target = _register(admin_app)
    cust = _client(admin_app, target)
    acc = cust.post("/accounts", json={"account_type": "savings"}, base_url=_HTTPS).get_json()
    approve_account(acc["account_id"])   # already active -> no opening request pending
    assert admin_client.post(f"/admin/accounts/{acc['account_id']}/opening/approve",
                             base_url=_HTTPS).status_code == 404


def test_admin_endpoints_require_auth_401(require_db, admin_app):
    c = admin_app.test_client()
    assert c.get("/admin/users", base_url=_HTTPS).status_code == 401
