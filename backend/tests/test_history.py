"""FR-03 transaction history tests: pagination, filters, direction/counterparty, IDOR."""

from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone
from urllib.parse import parse_qs, urlparse

import pyotp
import pytest

from app.blueprints.auth.login_service import login_password
from app.blueprints.auth.service import confirm_totp_enrolment, register_customer

_HTTPS = "https://localhost"
_IP = "203.0.113.8"
_PW = "Str0ng!Passw0rd"


@pytest.fixture(scope="module")
def hist_app():
    from app import create_app

    a = create_app()
    a.config.update(TESTING=True, WTF_CSRF_ENABLED=False)
    return a


def _email() -> str:
    return f"hist-{uuid.uuid4().hex[:12]}@example.com"


def _login(app):
    email = _email()
    with app.app_context():
        res = register_customer(full_name="Hist User", nric="S1234567D", email=email,
                                password=_PW, source_ip=_IP)
        secret = parse_qs(urlparse(res.provisioning_uri).query)["secret"][0]
        confirm_totp_enrolment(email=email, code=pyotp.TOTP(secret).now(), source_ip=_IP)
        token = login_password(email=email, password=_PW, source_ip=_IP)
    c = app.test_client()
    c.post("/auth/login/mfa", json={"mfa_token": token, "code": pyotp.TOTP(secret).now()},
           base_url=_HTTPS)
    return c


def _account(c):
    return c.post("/accounts", json={"account_type": "savings"}, base_url=_HTTPS).get_json()


def _biller(c):
    return c.get("/transactions/billers", base_url=_HTTPS).get_json()["billers"][0]


def _seed(app, src, dst, biller_id):
    """Insert a known mix of transactions for `src` directly via the DB."""
    from app.extensions import db
    from app.models import Transaction

    s = db.app_session()
    try:
        def add(**kw):
            kw.setdefault("status", "complete")
            kw.setdefault("reference_number", "H" + uuid.uuid4().hex[:20])
            kw.setdefault("idempotency_key", uuid.uuid4())
            s.add(Transaction(**kw))

        src_id = uuid.UUID(src["account_id"])
        dst_id = uuid.UUID(dst["account_id"])
        # 26 debits src->dst, amount 1000 (today)
        for _ in range(26):
            add(source_account_id=src_id, destination_account_id=dst_id,
                amount_cents=1000, transaction_type="transfer")
        # 2 bill payments src->biller, amount 5000
        for _ in range(2):
            add(source_account_id=src_id, biller_id=uuid.UUID(biller_id),
                amount_cents=5000, transaction_type="bill_payment")
        # 1 credit dst->src, amount 2000
        add(source_account_id=dst_id, destination_account_id=src_id,
            amount_cents=2000, transaction_type="transfer")
        # 1 old debit src->dst (2020) for date filtering
        add(source_account_id=src_id, destination_account_id=dst_id,
            amount_cents=1000, transaction_type="transfer",
            created_at=datetime(2020, 1, 1, tzinfo=timezone.utc))
        s.commit()
    finally:
        s.close()


@pytest.fixture(scope="module")
def seeded(hist_app):
    c = _login(hist_app)
    src = _account(c)
    dst = _account(c)
    biller = _biller(c)
    _seed(hist_app, src, dst, biller["biller_id"])
    return {"client": c, "src": src, "dst": dst, "biller": biller}


def _hist(c, account_id, **params):
    return c.get(f"/accounts/{account_id}/transactions", query_string=params, base_url=_HTTPS)


def test_pagination_25_per_page(require_db, seeded):
    c, src = seeded["client"], seeded["src"]
    r = _hist(c, src["account_id"])
    body = r.get_json()
    assert r.status_code == 200
    assert body["page_size"] == 25
    assert body["total"] == 30  # 26 + 2 + 1 credit + 1 old
    assert len(body["items"]) == 25
    assert body["total_pages"] == 2
    p2 = _hist(c, src["account_id"], page=2).get_json()
    assert len(p2["items"]) == 5


def test_filter_by_type(require_db, seeded):
    c, src = seeded["client"], seeded["src"]
    body = _hist(c, src["account_id"], type="bill_payment").get_json()
    assert body["total"] == 2
    assert all(i["transaction_type"] == "bill_payment" for i in body["items"])


def test_filter_by_amount(require_db, seeded):
    c, src = seeded["client"], seeded["src"]
    body = _hist(c, src["account_id"], amount_min=5000).get_json()
    assert body["total"] == 2  # only the 5000 bill payments


def test_filter_by_date_excludes_recent(require_db, seeded):
    c, src = seeded["client"], seeded["src"]
    # Date filters are UTC-based; use the UTC calendar day.
    yesterday = (datetime.now(timezone.utc).date() - timedelta(days=1)).isoformat()
    body = _hist(c, src["account_id"], date_to=yesterday).get_json()
    assert body["total"] == 1  # only the 2020 transaction


def test_direction_and_counterparty(require_db, seeded):
    c, src, dst, biller = seeded["client"], seeded["src"], seeded["dst"], seeded["biller"]
    # Gather across pages (seeded rows tie on created_at, so page order is arbitrary).
    all_items = (_hist(c, src["account_id"], page=1).get_json()["items"]
                 + _hist(c, src["account_id"], page=2).get_json()["items"])
    debit_transfer = next(i for i in all_items
                          if i["transaction_type"] == "transfer" and i["direction"] == "debit")
    assert debit_transfer["counterparty"] == dst["account_number"]
    credit = next(i for i in all_items if i["direction"] == "credit")
    assert credit["counterparty"] == dst["account_number"]
    bill_items = _hist(c, src["account_id"], type="bill_payment").get_json()["items"]
    assert bill_items[0]["counterparty"] == biller["biller_name"]


def test_history_other_user_404(require_db, hist_app, seeded):
    attacker = _login(hist_app)
    r = _hist(attacker, seeded["src"]["account_id"])
    assert r.status_code == 404


def test_history_requires_auth_401(require_db, hist_app, seeded):
    c = hist_app.test_client()
    r = _hist(c, seeded["src"]["account_id"])
    assert r.status_code == 401


def test_history_invalid_page_400(require_db, seeded):
    c, src = seeded["client"], seeded["src"]
    assert _hist(c, src["account_id"], page=0).status_code == 400
    assert _hist(c, src["account_id"], type="bogus").status_code == 400
