"""Tests for the periodic cleanup job."""

from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone

from sqlalchemy import select

from app.services.cleanup import run_cleanup, run_cleanup_if_leader


def test_cleanup_prunes_expired_rows(require_db, app):
    from app.extensions import db
    from app.models import (
        AuthAttempt,
        IdempotencyRecord,
        PendingEmailChange,
        User,
    )

    now = datetime.now(timezone.utc)
    s = db.app_session()
    try:
        u = User(email=f"clean-{uuid.uuid4().hex[:8]}@e.com", full_name="C",
                 nric_encrypted=b"x" * 16, nric_masked="S****1A", password_hash="h", role="customer")
        s.add(u)
        s.flush()
        uid = u.user_id

        expired_key = uuid.uuid4()
        s.add(IdempotencyRecord(idempotency_key=expired_key, user_id=uid, request_hash="h",
                                response_payload={}, created_at=now - timedelta(days=2),
                                expires_at=now - timedelta(hours=1)))
        fresh_key = uuid.uuid4()
        s.add(IdempotencyRecord(idempotency_key=fresh_key, user_id=uid, request_hash="h",
                                response_payload={}, created_at=now,
                                expires_at=now + timedelta(hours=1)))
        old_change = uuid.uuid4()
        s.add(PendingEmailChange(change_id=old_change, user_id=uid, new_email="x@e.com",
                                 verification_token_hash="h", expires_at=now - timedelta(minutes=1)))
        old_attempt = AuthAttempt(attempt_id=uuid.uuid4(), user_id=uid, attempt_type="totp",
                                  occurred_at=now - timedelta(hours=3))
        s.add(old_attempt)
        s.commit()
    finally:
        s.close()

    with app.app_context():
        counts = run_cleanup()

    assert counts["idempotency_records"] >= 1
    assert counts["pending_email_changes"] >= 1
    assert counts["auth_attempts"] >= 1

    s = db.app_session()
    try:
        assert s.get(IdempotencyRecord, expired_key) is None       # expired removed
        assert s.get(IdempotencyRecord, fresh_key) is not None      # fresh kept
        assert s.execute(
            select(PendingEmailChange).where(PendingEmailChange.change_id == old_change)
        ).scalar_one_or_none() is None
    finally:
        s.close()


def test_run_cleanup_if_leader_acquires_lock_and_runs(require_db, app):
    # With no competing holder, the leader path acquires the advisory lock and runs.
    with app.app_context():
        assert run_cleanup_if_leader() is True
