"""FR-02/03 account tests: create + view, behind auth with IDOR protection."""

from __future__ import annotations

import uuid
from urllib.parse import parse_qs, urlparse

import pyotp
import pytest

from app.blueprints.auth.login_service import login_password
from app.blueprints.auth.service import confirm_totp_enrolment, register_customer

_HTTPS = "https://localhost"
_IP = "203.0.113.4"


@pytest.fixture(scope="module")
def acc_app():
    from app import create_app

    a = create_app()
    a.config.update(TESTING=True, WTF_CSRF_ENABLED=False)
    return a


def _email() -> str:
    return f"acc-{uuid.uuid4().hex[:12]}@example.com"


def _logged_in_client(app):
    """Register + activate a user and return a client with its session cookie set."""
    email, password = _email(), "Str0ng!Passw0rd"
    with app.app_context():
        res = register_customer(full_name="Acc User", nric="S1234567D", email=email,
                                password=password, source_ip=_IP)
        secret = parse_qs(urlparse(res.provisioning_uri).query)["secret"][0]
        confirm_totp_enrolment(email=email, code=pyotp.TOTP(secret).now(), source_ip=_IP)
        token = login_password(email=email, password=password, source_ip=_IP)
    client = app.test_client()
    client.post("/auth/login/mfa", json={"mfa_token": token, "code": pyotp.TOTP(secret).now()},
                base_url=_HTTPS)
    return client


def test_create_account_201(require_db, acc_app):
    c = _logged_in_client(acc_app)
    r = c.post("/accounts", json={"account_type": "savings"}, base_url=_HTTPS)
    assert r.status_code == 201
    body = r.get_json()
    assert len(body["account_number"]) == 10 and body["account_number"].isdigit()
    assert body["balance_cents"] == 0
    assert body["account_type"] == "savings"
    assert body["status"] == "active"


def test_create_account_invalid_type_400(require_db, acc_app):
    c = _logged_in_client(acc_app)
    r = c.post("/accounts", json={"account_type": "gold"}, base_url=_HTTPS)
    assert r.status_code == 400


def test_create_account_requires_auth_401(require_db, acc_app):
    c = acc_app.test_client()
    r = c.post("/accounts", json={"account_type": "savings"}, base_url=_HTTPS)
    assert r.status_code == 401


def test_list_accounts(require_db, acc_app):
    c = _logged_in_client(acc_app)
    c.post("/accounts", json={"account_type": "savings"}, base_url=_HTTPS)
    c.post("/accounts", json={"account_type": "current"}, base_url=_HTTPS)
    r = c.get("/accounts", base_url=_HTTPS)
    assert r.status_code == 200
    accounts = r.get_json()["accounts"]
    assert len(accounts) == 2
    assert {a["account_type"] for a in accounts} == {"savings", "current"}


def test_account_numbers_unique_and_numeric(require_db, acc_app):
    c = _logged_in_client(acc_app)
    nums = set()
    for _ in range(5):
        r = c.post("/accounts", json={"account_type": "savings"}, base_url=_HTTPS)
        n = r.get_json()["account_number"]
        assert len(n) == 10 and n.isdigit()
        nums.add(n)
    assert len(nums) == 5  # all distinct


def test_view_own_account_200(require_db, acc_app):
    c = _logged_in_client(acc_app)
    acc_id = c.post("/accounts", json={"account_type": "savings"},
                    base_url=_HTTPS).get_json()["account_id"]
    r = c.get(f"/accounts/{acc_id}", base_url=_HTTPS)
    assert r.status_code == 200
    assert r.get_json()["account_id"] == acc_id


def test_view_other_users_account_404(require_db, acc_app):
    owner = _logged_in_client(acc_app)
    acc_id = owner.post("/accounts", json={"account_type": "savings"},
                        base_url=_HTTPS).get_json()["account_id"]
    attacker = _logged_in_client(acc_app)
    r = attacker.get(f"/accounts/{acc_id}", base_url=_HTTPS)
    assert r.status_code == 404  # IDOR: does not confirm existence


def test_create_account_emits_audit(require_db, acc_app):
    from sqlalchemy import text

    from app.extensions import db

    c = _logged_in_client(acc_app)
    acc_id = c.post("/accounts", json={"account_type": "current"},
                    base_url=_HTTPS).get_json()["account_id"]
    with db.admin_reader_engine.connect() as conn:
        n = conn.execute(
            text("SELECT count(*) FROM audit.audit_events "
                 "WHERE event_type='ACCOUNT_CREATE' AND action_detail->>'account_id' = :a"),
            {"a": acc_id},
        ).scalar_one()
    assert n == 1
