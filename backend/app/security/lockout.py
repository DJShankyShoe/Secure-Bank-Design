"""Per-account lockout and TOTP/PIN attempt windows (SR-09/11/12).

Two distinct mechanisms, both DB-backed so they survive load balancing (NFR-04):

* **Account lockout (SR-09)** — ``users.failed_login_count`` is a *consecutive*
  counter; at ``ACCOUNT_LOCKOUT_THRESHOLD`` the account is ``locked`` with a
  ``locked_until`` 30-min window (also unlockable by email link / admin).
* **Rate-limit windows (SR-11/12)** — rows in ``session.auth_attempts`` are
  COUNTed within a sliding window: TOTP 5/min, PIN 3 per transaction + 5/hour.

All functions take an app_user-bound :class:`Session`; the caller owns the
transaction (commit/rollback), except the read-only counters.
"""

from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone
from typing import Optional

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..config import Config
from ..models import AuthAttempt, User


def _now() -> datetime:
    return datetime.now(timezone.utc)


# --------------------------------------------------------------------------- #
# Attempt windows (SR-11/12)
# --------------------------------------------------------------------------- #

def record_auth_attempt(
    session: Session,
    user_id: uuid.UUID,
    attempt_type: str,
    transaction_ref: Optional[str] = None,
) -> None:
    """Insert one TOTP/PIN attempt row (caller commits)."""
    session.add(
        AuthAttempt(
            user_id=user_id, attempt_type=attempt_type, transaction_ref=transaction_ref
        )
    )


def _count_attempts(
    session: Session,
    user_id: uuid.UUID,
    attempt_type: str,
    *,
    since: Optional[datetime] = None,
    transaction_ref: Optional[str] = None,
) -> int:
    stmt = select(func.count()).select_from(AuthAttempt).where(
        AuthAttempt.user_id == user_id, AuthAttempt.attempt_type == attempt_type
    )
    if since is not None:
        stmt = stmt.where(AuthAttempt.occurred_at >= since)
    if transaction_ref is not None:
        stmt = stmt.where(AuthAttempt.transaction_ref == transaction_ref)
    return int(session.execute(stmt).scalar_one())


def is_totp_rate_limited(session: Session, user_id: uuid.UUID) -> bool:
    """True if TOTP attempts in the last minute meet/exceed the limit (SR-11, 5/min)."""
    window = _now() - timedelta(minutes=1)
    return _count_attempts(session, user_id, "totp", since=window) >= Config.TOTP_RATE_LIMIT_PER_MIN


def is_pin_rate_limited(
    session: Session, user_id: uuid.UUID, transaction_ref: str
) -> bool:
    """True if PIN attempts breach either window (SR-12: 3/transaction or 5/hour)."""
    per_txn = _count_attempts(session, user_id, "pin", transaction_ref=transaction_ref)
    if per_txn >= Config.PIN_ATTEMPTS_PER_TXN:
        return True
    hour = _now() - timedelta(hours=1)
    return _count_attempts(session, user_id, "pin", since=hour) >= Config.PIN_ATTEMPTS_PER_HOUR


def is_email_action_rate_limited(session: Session, user_id: uuid.UUID) -> bool:
    """True if email-send actions (email-change / unlock) breach the hourly limit.

    Throttles per-account abuse of endpoints that send mail (anti-spam / SMTP
    quota / sender-reputation protection). Caller records the attempt via
    ``record_auth_attempt(..., "email")``.
    """
    hour = _now() - timedelta(hours=1)
    count = _count_attempts(session, user_id, "email", since=hour)
    return count >= Config.EMAIL_ACTION_LIMIT_PER_HOUR


# --------------------------------------------------------------------------- #
# Account lockout (SR-09)
# --------------------------------------------------------------------------- #

def is_account_locked(user: User) -> bool:
    """True while the account is in a live brute-force lock window (SR-09)."""
    if user.account_status != "locked":
        return False
    return user.locked_until is not None and user.locked_until > _now()


def clear_expired_lock(user: User) -> None:
    """Reactivate a previously locked account whose ``locked_until`` has passed."""
    if user.account_status == "locked" and (
        user.locked_until is None or user.locked_until <= _now()
    ):
        user.account_status = "active"
        user.failed_login_count = 0
        user.locked_until = None


def register_failed_auth(user: User) -> None:
    """Count one failed auth toward the lockout; lock at the threshold (SR-09).

    Counts password/TOTP/PIN failures alike. Caller commits.
    """
    user.failed_login_count = (user.failed_login_count or 0) + 1
    if user.failed_login_count >= Config.ACCOUNT_LOCKOUT_THRESHOLD:
        user.account_status = "locked"
        user.locked_until = _now() + Config.LOCKOUT_UNLOCK_TTL


def reset_failed_auth(user: User) -> None:
    """Clear the consecutive-failure counter after a successful auth (SR-09)."""
    user.failed_login_count = 0
    user.locked_until = None
