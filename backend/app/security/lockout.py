"""Per-account lockout and TOTP/PIN attempt windows (SR-09/11/12).

Two distinct mechanisms, both DB-backed so they survive load balancing (NFR-04):

* **Account lockout (SR-09)** — ``users.failed_login_count`` is a *consecutive*
  counter; at ``ACCOUNT_LOCKOUT_THRESHOLD`` the account is ``locked`` with a
  ``locked_until`` 30-min window (auto-unlocks when it passes; an admin can also
  unlock). On locking, the owner is alerted by email + in-app notification (FR-10).
* **Rate-limit windows (SR-11/12, FR-10)** — rows in ``session.auth_attempts`` are
  COUNTed within a sliding window: TOTP 5/min, PIN 3 per transaction + 5/hour, and
  in-session password re-verify 5 per 30 min. These are *feature-only* throttles —
  they never lock the whole account (that is the SR-09 mechanism above), so a
  shoulder-surfer at an unlocked session can't DoS the real owner out of login.

All functions take an app_user-bound :class:`Session`; the caller owns the
transaction (commit/rollback), except the read-only counters.
"""

from __future__ import annotations

import logging
import uuid
from datetime import datetime, timedelta, timezone
from typing import Optional

from sqlalchemy import func, select, text
from sqlalchemy.orm import Session

from ..config import Config
from ..models import AuthAttempt, User

logger = logging.getLogger(__name__)


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _serialize_window(session: Session, user_id: uuid.UUID, attempt_type: str) -> None:
    """Take a transaction-scoped advisory lock for this ``(user, attempt_type)``.

    The rate-limit windows are enforced by COUNT-then-INSERT; under READ COMMITTED
    concurrent requests could each read a sub-threshold count and all proceed
    (TOCTOU), bursting past the limit. Acquiring this lock at the start of the
    check serialises the whole count→record→commit for the same key, so a blocked
    request sees the just-recorded attempt. The lock auto-releases at commit/rollback
    and is keyed per (user, type), so unrelated accounts never contend (SR-11/12).
    """
    session.execute(
        text("SELECT pg_advisory_xact_lock(hashtext(:k))"),
        {"k": f"ratelimit:{user_id}:{attempt_type}"},
    )


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
    _serialize_window(session, user_id, "totp")
    window = _now() - timedelta(minutes=1)
    return _count_attempts(session, user_id, "totp", since=window) >= Config.TOTP_RATE_LIMIT_PER_MIN


def is_pin_rate_limited(
    session: Session, user_id: uuid.UUID, transaction_ref: str
) -> bool:
    """True if PIN attempts breach either window (SR-12: 3/transaction or 5/hour)."""
    _serialize_window(session, user_id, "pin")
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
    _serialize_window(session, user_id, "email")
    hour = _now() - timedelta(hours=1)
    count = _count_attempts(session, user_id, "email", since=hour)
    return count >= Config.EMAIL_ACTION_LIMIT_PER_HOUR


def is_password_reverify_rate_limited(session: Session, user_id: uuid.UUID) -> bool:
    """True if in-session password re-verify failures breach the window (FR-10).

    Repeated wrong current-password entries on password-gated features (change
    password / change email / change PIN) temporarily lock **only those features**,
    never the whole account — so someone at an unlocked/unattended session can't
    lock the real owner out of login (self-DoS), while online password guessing is
    still throttled (5 fails / 30 min). The caller records each failure via
    ``record_auth_attempt(..., "password")``.
    """
    _serialize_window(session, user_id, "password")
    window = _now() - Config.PASSWORD_REVERIFY_WINDOW
    return (
        _count_attempts(session, user_id, "password", since=window)
        >= Config.PASSWORD_REVERIFY_LIMIT
    )


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

    Counts genuine authentication-gate failures — login password, login/step-up
    TOTP, and enrolment TOTP. Transaction-PIN failures are deliberately excluded
    (feature-only throttle, decided 2026-07-06) so a wrong PIN can't lock login.
    Caller commits. On the locking transition, alerts the owner (email + in-app
    notification, FR-10).
    """
    user.failed_login_count = (user.failed_login_count or 0) + 1
    if (user.failed_login_count >= Config.ACCOUNT_LOCKOUT_THRESHOLD
            and user.account_status != "locked"):
        user.account_status = "locked"
        user.locked_until = _now() + Config.LOCKOUT_UNLOCK_TTL
        _emit_lockout_alert(user)


def _emit_lockout_alert(user: User) -> None:
    """Tell the owner their account just locked — email + in-app alert (SR-09/FR-10).

    Best-effort and never raises: a delivery/logging failure must not break the
    auth flow. The email is dispatched async (see ``send_email``); the in-app
    notification is written on its own session.
    """
    from ..services.email import render_email, send_email
    from ..services.notifications import notify

    minutes = int(Config.LOCKOUT_UNLOCK_TTL.total_seconds() // 60)
    try:
        body = render_email("account_locked.txt", full_name=user.full_name, minutes=minutes)
        send_email(to=user.email,
                   subject="SecureBank security alert: your account has been locked",
                   body=body)
    except Exception:  # pragma: no cover - alert is non-critical
        logger.exception("Failed to send lockout email for user %s", user.user_id)
    notify(user.user_id, "account_locked", "Account locked",
           f"Your account was locked after multiple failed sign-in attempts. It will "
           f"unlock automatically in {minutes} minutes. If this wasn't you, contact support.")


def reset_failed_auth(user: User) -> None:
    """Clear the consecutive-failure counter after a successful auth (SR-09)."""
    user.failed_login_count = 0
    user.locked_until = None
