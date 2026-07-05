"""Tests for idempotency + email services (SR-08, FR-04/06/07)."""

from __future__ import annotations

import uuid

import pytest

from app.models import ContactPreference, User
from app.services import idempotency
from app.services.email import notify_user, outbox, send_email
from app.services.idempotency import IdempotencyConflict
from app.security.validation import ValidationError


# --------------------------------------------------------------------------- #
# Idempotency
# --------------------------------------------------------------------------- #

def test_request_hash_is_order_independent_and_distinct():
    h1 = idempotency.compute_request_hash({"a": 1, "b": 2})
    h2 = idempotency.compute_request_hash({"b": 2, "a": 1})
    h3 = idempotency.compute_request_hash({"a": 1, "b": 3})
    assert h1 == h2 and len(h1) == 64
    assert h1 != h3


def test_parse_idempotency_key():
    k = uuid.uuid4()
    assert idempotency.parse_idempotency_key(str(k)) == k
    for bad in [None, "", "not-a-uuid"]:
        with pytest.raises(ValidationError):
            idempotency.parse_idempotency_key(bad)


def test_replay_and_conflict(require_db, app):
    from app.extensions import db

    s = db.app_session()
    try:
        u = User(email=f"idem-{uuid.uuid4().hex[:8]}@e.com", full_name="I",
                 nric_encrypted=b"x" * 16, nric_masked="S****1A", password_hash="h", role="customer")
        s.add(u)
        s.flush()
        key = uuid.uuid4()
        rec = idempotency.make_record(key, u.user_id, "hash-A", {"ok": True})
        s.add(rec)
        s.commit()

        # Same user + same hash -> replay stored payload.
        assert idempotency.replay_or_conflict(s, key, "hash-A", u.user_id) == {"ok": True}
        # Same user + different hash -> conflict.
        with pytest.raises(IdempotencyConflict):
            idempotency.replay_or_conflict(s, key, "hash-B", u.user_id)
        # Unknown key -> None (new).
        assert idempotency.replay_or_conflict(s, uuid.uuid4(), "hash-A", u.user_id) is None
        # DIFFERENT user, same key + hash -> conflict, NEVER replays another user's
        # receipt (SR-08 + ownership, SR-13).
        with pytest.raises(IdempotencyConflict):
            idempotency.replay_or_conflict(s, key, "hash-A", uuid.uuid4())
    finally:
        s.close()


# --------------------------------------------------------------------------- #
# Email
# --------------------------------------------------------------------------- #

def test_send_email_captured_under_testing(app):
    with app.app_context():
        before = len(outbox())
        send_email(to="a@b.com", subject="Hi", body="Body")
        box = outbox()
        assert len(box) == before + 1
        assert box[-1]["to"] == "a@b.com" and box[-1]["subject"] == "Hi"


def test_notify_user_respects_preference(require_db, app):
    from app.extensions import db

    s = db.app_session()
    try:
        u = User(email=f"notif-{uuid.uuid4().hex[:8]}@e.com", full_name="N",
                 nric_encrypted=b"x" * 16, nric_masked="S****1A", password_hash="h", role="customer")
        s.add(u)
        s.flush()
        s.add(ContactPreference(user_id=u.user_id, notify_on_transfer=False, notify_on_login=True))
        s.commit()
        uid = u.user_id
    finally:
        s.close()

    with app.app_context():
        # Preference off -> not sent.
        sent = notify_user(user_id=uid, pref_attr="notify_on_transfer",
                           subject="x", body="y")
        assert sent is False
        # Preference on -> sent (captured).
        before = len(outbox())
        sent2 = notify_user(user_id=uid, pref_attr="notify_on_login",
                            subject="login", body="hi")
        assert sent2 is True and len(outbox()) == before + 1
