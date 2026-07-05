"""FR-06 transfer tests: atomicity, PIN step-up, idempotency, IDOR, audit."""

from __future__ import annotations

import uuid
from urllib.parse import parse_qs, urlparse

import pyotp
import pytest

from app.blueprints.auth.login_service import login_password
from app.blueprints.auth.service import confirm_totp_enrolment, register_customer
from conftest import activate_signup_email, approve_account, unique_nric

_HTTPS = "https://localhost"
_IP = "203.0.113.6"
_PW = "Str0ng!Passw0rd"
_PIN = "135790"


@pytest.fixture(scope="module")
def txn_app():
    from app import create_app

    a = create_app()
    a.config.update(TESTING=True, WTF_CSRF_ENABLED=False)
    return a


def _email() -> str:
    return f"txn-{uuid.uuid4().hex[:12]}@example.com"


def _setup_user(app):
    email = _email()
    with app.app_context():
        res = register_customer(full_name="Txn User", nric=unique_nric(), email=email,
                                password=_PW, source_ip=_IP)
        secret = parse_qs(urlparse(res.provisioning_uri).query)["secret"][0]
        confirm_totp_enrolment(email=email, code=pyotp.TOTP(secret).now(), source_ip=_IP)
        activate_signup_email(app, email)  # FR-01: verify signup email
        token = login_password(email=email, password=_PW, source_ip=_IP)
    client = app.test_client()
    client.post("/auth/login/mfa", json={"mfa_token": token, "code": pyotp.TOTP(secret).now()},
                base_url=_HTTPS)
    return client, {"email": email, "secret": secret}


def _create_account(client, account_type="savings") -> dict:
    acc = client.post("/accounts", json={"account_type": account_type},
                      base_url=_HTTPS).get_json()
    approve_account(acc["account_id"])  # FR-02: new accounts need admin approval
    return acc


def _fund(app, account_id: str, cents: int) -> None:
    from app.extensions import db
    from app.models import Account

    s = db.app_session()
    try:
        acct = s.get(Account, uuid.UUID(account_id))
        acct.balance_cents = cents
        s.commit()
    finally:
        s.close()


def _balance(client, account_id: str) -> int:
    return client.get(f"/accounts/{account_id}", base_url=_HTTPS).get_json()["balance_cents"]


def _set_pin(client, pin=_PIN, password=_PW):
    return client.post("/transactions/pin", json={"password": password, "pin": pin}, base_url=_HTTPS)


def _transfer(client, src, dst, amount, *, key=None, pin=None, dst_external=None):
    body = {"source_account_number": src, "amount_cents": amount}
    if dst is not None:
        body["destination_account_number"] = dst
    if dst_external is not None:
        body["destination_external_ref"] = dst_external
    if pin is not None:
        body["pin"] = pin
    headers = {"Idempotency-Key": key or str(uuid.uuid4())}
    return client.post("/transactions/transfer", json=body, headers=headers, base_url=_HTTPS)


# --------------------------------------------------------------------------- #

def test_set_pin_success_and_wrong_password(require_db, txn_app):
    c, _ = _setup_user(txn_app)
    assert _set_pin(c).status_code == 200
    r = c.post("/transactions/pin", json={"password": "nope", "pin": _PIN}, base_url=_HTTPS)
    assert r.status_code == 401


def test_first_time_pin_set_needs_no_password(require_db, txn_app):
    # First-time setup omits the password entirely and still succeeds (2026-07-05).
    c, _ = _setup_user(txn_app)
    r = c.post("/transactions/pin", json={"pin": _PIN}, base_url=_HTTPS)
    assert r.status_code == 200
    assert c.get("/transactions/pin", base_url=_HTTPS).get_json()["pin_set"] is True
    # Replacing now DOES require the password: omitting it -> 401.
    r2 = c.post("/transactions/pin", json={"pin": "246810"}, base_url=_HTTPS)
    assert r2.status_code == 401
    # ...and succeeds with the correct password.
    r3 = c.post("/transactions/pin", json={"password": _PW, "pin": "246810"}, base_url=_HTTPS)
    assert r3.status_code == 200


def test_pin_status_reflects_whether_set(require_db, txn_app):
    c, _ = _setup_user(txn_app)
    assert c.get("/transactions/pin", base_url=_HTTPS).get_json()["pin_set"] is False
    _set_pin(c)
    assert c.get("/transactions/pin", base_url=_HTTPS).get_json()["pin_set"] is True


def test_transfer_below_threshold_moves_money(require_db, txn_app):
    c, _ = _setup_user(txn_app)
    src = _create_account(c)
    dst = _create_account(c, "current")
    _fund(txn_app, src["account_id"], 200_000)
    r = _transfer(c, src["account_number"], dst["account_number"], 50_000)
    assert r.status_code == 201
    body = r.get_json()
    assert body["status"] == "complete" and body["pin_verified"] is False
    assert _balance(c, src["account_id"]) == 150_000
    assert _balance(c, dst["account_id"]) == 50_000


def test_high_value_requires_pin(require_db, txn_app):
    c, _ = _setup_user(txn_app)
    src = _create_account(c)
    dst = _create_account(c, "current")
    _fund(txn_app, src["account_id"], 2_000_000)
    r = _transfer(c, src["account_number"], dst["account_number"], 100_000)  # SGD 1,000
    assert r.status_code == 403
    assert _balance(c, src["account_id"]) == 2_000_000  # unchanged


def test_high_value_with_pin_succeeds(require_db, txn_app):
    c, _ = _setup_user(txn_app)
    _set_pin(c)
    src = _create_account(c)
    dst = _create_account(c, "current")
    _fund(txn_app, src["account_id"], 2_000_000)
    r = _transfer(c, src["account_number"], dst["account_number"], 100_000, pin=_PIN)
    assert r.status_code == 201
    assert r.get_json()["pin_verified"] is True
    assert _balance(c, src["account_id"]) == 1_900_000


def test_high_value_wrong_pin_401(require_db, txn_app):
    c, _ = _setup_user(txn_app)
    _set_pin(c)
    src = _create_account(c)
    dst = _create_account(c, "current")
    _fund(txn_app, src["account_id"], 2_000_000)
    r = _transfer(c, src["account_number"], dst["account_number"], 100_000, pin="000000")
    assert r.status_code == 401
    assert _balance(c, src["account_id"]) == 2_000_000  # no money moved


def test_insufficient_funds_400_no_change(require_db, txn_app):
    c, _ = _setup_user(txn_app)
    src = _create_account(c)
    dst = _create_account(c, "current")
    _fund(txn_app, src["account_id"], 1_000)
    r = _transfer(c, src["account_number"], dst["account_number"], 50_000)
    assert r.status_code == 400
    assert _balance(c, src["account_id"]) == 1_000
    assert _balance(c, dst["account_id"]) == 0


def test_idempotent_replay_executes_once(require_db, txn_app):
    c, _ = _setup_user(txn_app)
    src = _create_account(c)
    dst = _create_account(c, "current")
    _fund(txn_app, src["account_id"], 200_000)
    key = str(uuid.uuid4())
    r1 = _transfer(c, src["account_number"], dst["account_number"], 50_000, key=key)
    r2 = _transfer(c, src["account_number"], dst["account_number"], 50_000, key=key)
    assert r1.status_code == 201 and r2.status_code == 201
    assert r1.get_json()["reference_number"] == r2.get_json()["reference_number"]
    assert _balance(c, src["account_id"]) == 150_000  # moved exactly once


def test_idempotency_conflict_409(require_db, txn_app):
    c, _ = _setup_user(txn_app)
    src = _create_account(c)
    dst = _create_account(c, "current")
    _fund(txn_app, src["account_id"], 200_000)
    key = str(uuid.uuid4())
    assert _transfer(c, src["account_number"], dst["account_number"], 50_000, key=key).status_code == 201
    r = _transfer(c, src["account_number"], dst["account_number"], 60_000, key=key)  # different body
    assert r.status_code == 409


def test_idempotency_key_scoped_per_user_no_cross_user_replay(require_db, txn_app):
    # User A performs a transfer with key K (creates the idempotency record).
    a, _ = _setup_user(txn_app)
    a_src = _create_account(a)
    a_dst = _create_account(a, "current")
    _fund(txn_app, a_src["account_id"], 200_000)
    key = str(uuid.uuid4())
    assert _transfer(a, a_src["account_number"], a_dst["account_number"],
                     50_000, key=key).status_code == 201

    # User B replays A's key with the SAME body: must NOT receive A's receipt.
    b, _ = _setup_user(txn_app)
    r = _transfer(b, a_src["account_number"], a_dst["account_number"], 50_000, key=key)
    assert r.status_code == 409                       # conflict, not a replay (SR-08 + ownership)
    assert "reference_number" not in r.get_json()     # A's receipt not leaked


def test_transfer_source_not_owned_404(require_db, txn_app):
    owner, _ = _setup_user(txn_app)
    src = _create_account(owner)
    _fund(txn_app, src["account_id"], 200_000)
    attacker, _ = _setup_user(txn_app)
    a_dst = _create_account(attacker)
    r = _transfer(attacker, src["account_number"], a_dst["account_number"], 10_000)
    assert r.status_code == 404


def test_transfer_requires_auth_401(require_db, txn_app):
    c = txn_app.test_client()
    r = _transfer(c, "0123456789", "9876543210", 1000)
    assert r.status_code == 401


def test_transfer_emits_audit(require_db, txn_app):
    from sqlalchemy import text

    from app.extensions import db

    c, _ = _setup_user(txn_app)
    src = _create_account(c)
    dst = _create_account(c, "current")
    _fund(txn_app, src["account_id"], 200_000)
    ref = _transfer(c, src["account_number"], dst["account_number"], 50_000).get_json()["reference_number"]
    with db.admin_reader_engine.connect() as conn:
        n = conn.execute(
            text("SELECT count(*) FROM audit.audit_events WHERE event_type='TRANSFER' "
                 "AND outcome='success' AND action_detail->>'reference_number' = :r"),
            {"r": ref},
        ).scalar_one()
    assert n == 1
