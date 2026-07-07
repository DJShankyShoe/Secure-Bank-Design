"""FR-08 superadmin tests: role assignment, admin management, and the guards
(no self-action, last-superadmin, session revocation on privilege change), plus
the admin↔superadmin RBAC separation (admins can't see/act on other admins)."""

from __future__ import annotations

import uuid
from urllib.parse import parse_qs, urlparse

import pyotp
import pytest
from sqlalchemy import select, text

from app.blueprints.auth.login_service import login_password
from app.blueprints.auth.service import confirm_totp_enrolment, register_customer
from conftest import activate_signup_email, unique_nric

_HTTPS = "https://localhost"
_IP = "203.0.113.44"
_PW = "Str0ng!Passw0rd"


@pytest.fixture(scope="module")
def sa_app():
    from app import create_app

    a = create_app()
    a.config.update(TESTING=True, WTF_CSRF_ENABLED=False)
    return a


def _email() -> str:
    return f"sa-{uuid.uuid4().hex[:12]}@example.com"


def _set_role_db(app, email: str, role: str) -> None:
    from app.extensions import db
    from app.models import User

    with app.app_context():
        s = db.app_session()
        try:
            u = s.execute(select(User).where(User.email == email)).scalar_one()
            u.role = role
            s.commit()
        finally:
            s.close()


def _register(app, role="customer") -> dict:
    email = _email()
    nric = unique_nric()
    with app.app_context():
        res = register_customer(full_name="SA User", nric=nric, email=email,
                                password=_PW, source_ip=_IP)
        secret = parse_qs(urlparse(res.provisioning_uri).query)["secret"][0]
        confirm_totp_enrolment(email=email, code=pyotp.TOTP(secret).now(), source_ip=_IP)
        activate_signup_email(app, email)
    if role != "customer":
        _set_role_db(app, email, role)
    return {"email": email, "nric": nric, "secret": secret, "user_id": str(res.user_id)}


def _client(app, creds):
    with app.app_context():
        token = login_password(email=creds["email"], password=_PW, source_ip=_IP)
    c = app.test_client()
    c.post("/auth/login/mfa", json={"mfa_token": token, "code": pyotp.TOTP(creds["secret"]).now()},
           base_url=_HTTPS)
    return c


def _audit_count(app, **eq) -> int:
    from app.extensions import db

    where = " AND ".join(f"{k} = :{k}" for k in eq)
    with db.admin_reader_engine.connect() as conn:
        return conn.execute(
            text(f"SELECT count(*) FROM audit.audit_events WHERE {where}"), eq
        ).scalar_one()


@pytest.fixture(scope="module")
def super_client(sa_app):
    return _client(sa_app, _register(sa_app, role="superadmin"))


# --------------------------------------------------------------------------- #
# RBAC gating
# --------------------------------------------------------------------------- #

def test_customer_denied_superadmin_endpoints_403(require_db, sa_app):
    cust = _client(sa_app, _register(sa_app))
    assert cust.get("/superadmin/users", base_url=_HTTPS).status_code == 403


def test_admin_denied_superadmin_endpoints_403(require_db, sa_app):
    admin = _client(sa_app, _register(sa_app, role="admin"))
    assert admin.get("/superadmin/users", base_url=_HTTPS).status_code == 403


def test_superadmin_lists_directory(require_db, sa_app, super_client):
    assert super_client.get("/superadmin/users", base_url=_HTTPS).status_code == 200


# --------------------------------------------------------------------------- #
# Role assignment
# --------------------------------------------------------------------------- #

def test_superadmin_promotes_customer_to_admin_and_audits(require_db, sa_app, super_client):
    target = _register(sa_app)
    r = super_client.post(f"/superadmin/users/{target['user_id']}/role",
                          json={"role": "admin"}, base_url=_HTTPS)
    assert r.status_code == 200 and r.get_json()["role"] == "admin"
    assert _audit_count(sa_app, event_type="SUPERADMIN_SET_ROLE",
                        target_user_id=target["user_id"]) == 1


def test_role_change_revokes_target_sessions(require_db, sa_app, super_client):
    target = _register(sa_app)
    tclient = _client(sa_app, target)
    assert tclient.get("/auth/me", base_url=_HTTPS).status_code == 200   # logged in
    super_client.post(f"/superadmin/users/{target['user_id']}/role",
                      json={"role": "admin"}, base_url=_HTTPS)
    # Privilege change revoked the session (SR-13) → the old cookie is now dead.
    assert tclient.get("/auth/me", base_url=_HTTPS).status_code == 401


def test_superadmin_cannot_change_own_role_403(require_db, sa_app):
    sa = _register(sa_app, role="superadmin")
    client = _client(sa_app, sa)
    r = client.post(f"/superadmin/users/{sa['user_id']}/role",
                    json={"role": "admin"}, base_url=_HTTPS)
    assert r.status_code == 403


def test_invalid_role_400(require_db, sa_app, super_client):
    target = _register(sa_app)
    r = super_client.post(f"/superadmin/users/{target['user_id']}/role",
                          json={"role": "root"}, base_url=_HTTPS)
    assert r.status_code == 400


def test_last_active_superadmin_cannot_be_demoted(require_db, sa_app, monkeypatch):
    # The guard blocks demoting a superadmin when they are the last active one.
    # The shared test DB holds several superadmins, so force the active count to 1
    # to exercise the decision deterministically.
    from app.blueprints.superadmin import service as sa_service
    from app.blueprints.superadmin.service import LastSuperadmin, set_role

    only_sa = _register(sa_app, role="superadmin")
    monkeypatch.setattr(sa_service, "_count_active_superadmins", lambda session: 1)
    with sa_app.app_context():
        with pytest.raises(LastSuperadmin):
            set_role(actor_id=uuid.uuid4(), target_user_id=uuid.UUID(only_sa["user_id"]),
                     new_role="admin", source_ip=_IP)


# --------------------------------------------------------------------------- #
# Admin management + admin↔admin separation
# --------------------------------------------------------------------------- #

def test_admin_cannot_suspend_another_admin_404(require_db, sa_app):
    admin = _client(sa_app, _register(sa_app, role="admin"))
    other_admin = _register(sa_app, role="admin")
    r = admin.post(f"/admin/users/{other_admin['user_id']}/suspend",
                   json={"reason": "x"}, base_url=_HTTPS)
    assert r.status_code == 404  # admins can only act on customers


def test_admin_user_list_excludes_admins(require_db, sa_app):
    admin_creds = _register(sa_app, role="admin")
    admin = _client(sa_app, admin_creds)
    r = admin.get("/admin/users", base_url=_HTTPS)
    ids = {u["user_id"] for u in r.get_json()["users"]}
    assert admin_creds["user_id"] not in ids  # no admin/superadmin rows in the customer list


def test_superadmin_suspends_admin_blocks_login(require_db, sa_app, super_client):
    target = _register(sa_app, role="admin")
    r = super_client.post(f"/superadmin/users/{target['user_id']}/suspend",
                          json={"reason": "policy"}, base_url=_HTTPS)
    assert r.status_code == 200
    from app.blueprints.auth.login_service import AccountSuspended
    with sa_app.app_context():
        # Correct password on a suspended (admin) account -> AccountSuspended, not
        # the generic InvalidCredentials — only reachable with the right password
        # so it doesn't help account enumeration (SR-09).
        with pytest.raises(AccountSuspended):
            login_password(email=target["email"], password=_PW, source_ip=_IP)
    assert _audit_count(sa_app, event_type="SUPERADMIN_SUSPEND_ADMIN",
                        target_user_id=target["user_id"]) == 1


def _role_of(app, email: str) -> str:
    from app.extensions import db
    from app.models import User

    with app.app_context():
        s = db.app_session()
        try:
            return s.execute(select(User.role).where(User.email == email)).scalar_one()
        finally:
            s.close()


def test_first_account_becomes_superadmin(require_db, sa_app, monkeypatch):
    # Force the "empty users table" path (the shared DB is never actually empty).
    from app.blueprints.auth import service as auth_service
    monkeypatch.setattr(auth_service, "_count_users", lambda s: 0)
    creds = _register(sa_app)
    assert _role_of(sa_app, creds["email"]) == "superadmin"


def test_subsequent_account_is_customer(require_db, sa_app):
    # Real populated DB → not the first account → ordinary customer.
    creds = _register(sa_app)
    assert _role_of(sa_app, creds["email"]) == "customer"


def test_superadmin_reactivates_admin(require_db, sa_app, super_client):
    target = _register(sa_app, role="admin")
    super_client.post(f"/superadmin/users/{target['user_id']}/suspend",
                      json={"reason": "policy"}, base_url=_HTTPS)
    r = super_client.post(f"/superadmin/users/{target['user_id']}/reactivate", base_url=_HTTPS)
    assert r.status_code == 200 and r.get_json()["account_status"] == "active"


# --------------------------------------------------------------------------- #
# Audit-log visibility scope (FR-08): admin sees customer-related events only;
# superadmin sees everything, including staff-to-staff activity.
# --------------------------------------------------------------------------- #

def test_admin_denied_superadmin_audit_403(require_db, sa_app):
    admin = _client(sa_app, _register(sa_app, role="admin"))
    assert admin.get("/superadmin/audit", base_url=_HTTPS).status_code == 403


def test_admin_audit_hides_staff_to_staff_superadmin_sees_it(require_db, sa_app, super_client):
    admin = _client(sa_app, _register(sa_app, role="admin"))
    # A staff-to-staff event: a superadmin promotes a user (who thereby becomes
    # staff) — actor=superadmin, target=admin, no customer party involved.
    target = _register(sa_app)
    super_client.post(f"/superadmin/users/{target['user_id']}/role",
                      json={"role": "admin"}, base_url=_HTTPS)
    tid = target["user_id"]
    # Admin (customer-oversight scope) must NOT see the role-management event.
    r = admin.get(f"/admin/audit?type=SUPERADMIN_SET_ROLE&user={tid}", base_url=_HTTPS)
    assert r.status_code == 200 and r.get_json()["items"] == []
    # Superadmin (full scope) DOES see it.
    r2 = super_client.get(f"/superadmin/audit?type=SUPERADMIN_SET_ROLE&user={tid}", base_url=_HTTPS)
    assert r2.status_code == 200 and len(r2.get_json()["items"]) >= 1


def test_admin_audit_includes_admin_to_customer(require_db, sa_app):
    admin = _client(sa_app, _register(sa_app, role="admin"))
    customer = _register(sa_app)
    admin.post(f"/admin/users/{customer['user_id']}/suspend",
               json={"reason": "audit scope test"}, base_url=_HTTPS)
    # An admin→customer action stays visible in the admin (customer-oversight) view.
    r = admin.get(f"/admin/audit?type=ADMIN_SUSPEND_USER&user={customer['user_id']}",
                  base_url=_HTTPS)
    assert r.status_code == 200 and len(r.get_json()["items"]) >= 1


# --------------------------------------------------------------------------- #
# NRIC reveal (SR-03): superadmin can reveal any user's full NRIC (audited);
# customers/admins are denied the superadmin endpoint.
# --------------------------------------------------------------------------- #

def test_superadmin_reveals_customer_nric_audited(require_db, sa_app, super_client):
    target = _register(sa_app)
    r = super_client.get(f"/superadmin/users/{target['user_id']}/nric", base_url=_HTTPS)
    assert r.status_code == 200 and r.get_json()["nric"] == target["nric"]
    assert _audit_count(sa_app, event_type="NRIC_REVEAL",
                        target_user_id=target["user_id"], actor_role="superadmin") == 1


def test_superadmin_reveals_staff_nric(require_db, sa_app, super_client):
    # Unlike the admin reveal (customers only), a superadmin can reveal staff NRICs.
    target = _register(sa_app, role="admin")
    r = super_client.get(f"/superadmin/users/{target['user_id']}/nric", base_url=_HTTPS)
    assert r.status_code == 200 and r.get_json()["nric"] == target["nric"]


def test_admin_denied_superadmin_nric_403(require_db, sa_app):
    admin = _client(sa_app, _register(sa_app, role="admin"))
    other = _register(sa_app)
    assert admin.get(f"/superadmin/users/{other['user_id']}/nric",
                     base_url=_HTTPS).status_code == 403
