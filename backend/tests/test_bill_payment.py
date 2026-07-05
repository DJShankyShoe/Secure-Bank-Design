"""FR-07 bill payment tests: allowlist, balance check, no partial state, idempotency."""

from __future__ import annotations

import uuid
from urllib.parse import parse_qs, urlparse

import pyotp
import pytest

from app.blueprints.auth.login_service import login_password
from app.blueprints.auth.service import confirm_totp_enrolment, register_customer
from conftest import activate_signup_email, approve_account, unique_nric

_HTTPS = "https://localhost"
_IP = "203.0.113.7"
_PW = "Str0ng!Passw0rd"


@pytest.fixture(scope="module")
def bp_app():
    from app import create_app

    a = create_app()
    a.config.update(TESTING=True, WTF_CSRF_ENABLED=False)
    return a


def _email() -> str:
    return f"bill-{uuid.uuid4().hex[:12]}@example.com"


def _login(app):
    email = _email()
    with app.app_context():
        res = register_customer(full_name="Bill User", nric=unique_nric(), email=email,
                                password=_PW, source_ip=_IP)
        secret = parse_qs(urlparse(res.provisioning_uri).query)["secret"][0]
        confirm_totp_enrolment(email=email, code=pyotp.TOTP(secret).now(), source_ip=_IP)
        activate_signup_email(app, email)  # FR-01: verify signup email
        token = login_password(email=email, password=_PW, source_ip=_IP)
    c = app.test_client()
    c.post("/auth/login/mfa", json={"mfa_token": token, "code": pyotp.TOTP(secret).now()},
           base_url=_HTTPS)
    return c


def _account(c, fund=0):
    a = c.post("/accounts", json={"account_type": "savings"}, base_url=_HTTPS).get_json()
    approve_account(a["account_id"])  # FR-02: new accounts need admin approval
    if fund:
        _fund(a["account_id"], fund)
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


def _balance(c, account_id: str) -> int:
    return c.get(f"/accounts/{account_id}", base_url=_HTTPS).get_json()["balance_cents"]


def _a_biller(c) -> dict:
    return c.get("/transactions/billers", base_url=_HTTPS).get_json()["billers"][0]


def _pay(c, src, biller_id, amount, key=None):
    return c.post("/transactions/bill-payment",
                  json={"source_account_number": src, "biller_id": biller_id,
                        "amount_cents": amount},
                  headers={"Idempotency-Key": key or str(uuid.uuid4())}, base_url=_HTTPS)


# --------------------------------------------------------------------------- #

def test_list_billers(require_db, bp_app):
    c = _login(bp_app)
    r = c.get("/transactions/billers", base_url=_HTTPS)
    assert r.status_code == 200
    billers = r.get_json()["billers"]
    assert len(billers) >= 1
    assert {"biller_id", "biller_name", "biller_category"} <= set(billers[0])


def test_bill_payment_success(require_db, bp_app):
    c = _login(bp_app)
    acc = _account(c, fund=200_000)
    biller = _a_biller(c)
    r = _pay(c, acc["account_number"], biller["biller_id"], 30_000)
    assert r.status_code == 201
    body = r.get_json()
    assert body["transaction_type"] == "bill_payment"
    assert body["biller_name"] == biller["biller_name"]
    assert _balance(c, acc["account_id"]) == 170_000


def test_bill_payment_insufficient_funds_no_change(require_db, bp_app):
    c = _login(bp_app)
    acc = _account(c, fund=1_000)
    biller = _a_biller(c)
    r = _pay(c, acc["account_number"], biller["biller_id"], 30_000)
    assert r.status_code == 400
    assert _balance(c, acc["account_id"]) == 1_000  # no partial state


def test_bill_payment_invalid_biller_400(require_db, bp_app):
    c = _login(bp_app)
    acc = _account(c, fund=200_000)
    r = _pay(c, acc["account_number"], str(uuid.uuid4()), 1_000)
    assert r.status_code == 400
    assert _balance(c, acc["account_id"]) == 200_000


def test_bill_payment_idempotent_replay(require_db, bp_app):
    c = _login(bp_app)
    acc = _account(c, fund=200_000)
    biller = _a_biller(c)
    key = str(uuid.uuid4())
    r1 = _pay(c, acc["account_number"], biller["biller_id"], 30_000, key=key)
    r2 = _pay(c, acc["account_number"], biller["biller_id"], 30_000, key=key)
    assert r1.status_code == 201 and r2.status_code == 201
    assert r1.get_json()["reference_number"] == r2.get_json()["reference_number"]
    assert _balance(c, acc["account_id"]) == 170_000  # debited once


def test_bill_payment_source_not_owned_404(require_db, bp_app):
    owner = _login(bp_app)
    acc = _account(owner, fund=200_000)
    biller = _a_biller(owner)
    attacker = _login(bp_app)
    r = _pay(attacker, acc["account_number"], biller["biller_id"], 1_000)
    assert r.status_code == 404


def test_bill_payment_requires_auth_401(require_db, bp_app):
    c = bp_app.test_client()
    r = _pay(c, "0123456789", str(uuid.uuid4()), 1_000)
    assert r.status_code == 401


def test_bill_payment_emits_audit(require_db, bp_app):
    from sqlalchemy import text

    from app.extensions import db

    c = _login(bp_app)
    acc = _account(c, fund=200_000)
    biller = _a_biller(c)
    ref = _pay(c, acc["account_number"], biller["biller_id"], 30_000).get_json()["reference_number"]
    with db.admin_reader_engine.connect() as conn:
        n = conn.execute(
            text("SELECT count(*) FROM audit.audit_events WHERE event_type='BILL_PAYMENT' "
                 "AND outcome='success' AND action_detail->>'reference_number' = :r"),
            {"r": ref},
        ).scalar_one()
    assert n == 1
