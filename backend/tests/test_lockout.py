"""Tests for lockout helpers (SR-09/11). Account-lockout counters run
in-memory on a User instance; rate-limit windows need the DB (auth_attempts)."""

from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone

from app.config import Config
from app.models import User
from app.security import lockout


def _user() -> User:
    return User(account_status="active", failed_login_count=0)


def test_register_failed_auth_locks_at_threshold():
    u = _user()
    for _ in range(Config.ACCOUNT_LOCKOUT_THRESHOLD):
        lockout.register_failed_auth(u)
    assert u.failed_login_count == Config.ACCOUNT_LOCKOUT_THRESHOLD
    assert u.account_status == "locked"
    assert u.locked_until is not None and u.locked_until > datetime.now(timezone.utc)


def test_reset_failed_auth_clears_counter():
    u = _user()
    lockout.register_failed_auth(u)
    lockout.reset_failed_auth(u)
    assert u.failed_login_count == 0
    assert u.locked_until is None


def test_is_account_locked_and_expiry():
    u = _user()
    u.account_status = "locked"
    u.locked_until = datetime.now(timezone.utc) + timedelta(minutes=10)
    assert lockout.is_account_locked(u) is True
    # Past expiry -> auto-reactivate.
    u.locked_until = datetime.now(timezone.utc) - timedelta(minutes=1)
    assert lockout.is_account_locked(u) is False
    lockout.clear_expired_lock(u)
    assert u.account_status == "active" and u.failed_login_count == 0


def test_totp_rate_limit_window(require_db):
    from app.extensions import db

    s = db.app_session()
    try:
        # auth_attempts has an FK to users, so create a real (transient) user first.
        u = User(
            email=f"lk-{uuid.uuid4().hex[:10]}@example.com",
            full_name="LK",
            nric_encrypted=b"x" * 16,
            nric_masked="S****1A",
            password_hash="argon2",
            role="customer",
        )
        s.add(u)
        s.flush()
        uid = u.user_id
        # Below the limit.
        for _ in range(Config.TOTP_RATE_LIMIT_PER_MIN - 1):
            lockout.record_auth_attempt(s, uid, "totp")
        s.flush()
        assert lockout.is_totp_rate_limited(s, uid) is False
        # Reach the limit.
        lockout.record_auth_attempt(s, uid, "totp")
        s.flush()
        assert lockout.is_totp_rate_limited(s, uid) is True
    finally:
        s.rollback()  # nothing persisted
        s.close()
