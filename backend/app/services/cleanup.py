"""Periodic cleanup / pruning of expired DB-backed state.

Bounds the growth of the stateless-safe tables:
* ``session.idempotency_records`` — removed past their 24-h ``expires_at`` (SR-08).
* ``application.pending_email_changes`` — removed past their 30-min ``expires_at``.
* ``session.auth_attempts`` — pruned beyond a short retention (the longest rate
  window is 1 h, SR-12; we keep a 2-h buffer).

Run via the ``flask cleanup`` CLI command (registered in the app factory),
scheduled out-of-band (e.g. cron). Uses the ``app_user`` engine, which holds
DELETE on the application + session schemas.
"""

from __future__ import annotations

import logging
import threading
import time
from datetime import datetime, timedelta, timezone

from sqlalchemy import delete, text

from ..extensions import db
from ..models import AuthAttempt, IdempotencyRecord, PendingEmailChange

# Keep auth_attempts a little past the longest rate-limit window (1 h, SR-12).
_AUTH_ATTEMPT_RETENTION = timedelta(hours=2)

# Cluster-wide advisory-lock key so only ONE worker/container prunes per tick.
_CLEANUP_LOCK_KEY = 0x53454342  # arbitrary constant ("SECB")

_log = logging.getLogger(__name__)


def _now() -> datetime:
    return datetime.now(timezone.utc)


def run_cleanup() -> dict[str, int]:
    """Prune all expired records in one transaction; return per-table delete counts."""
    now = _now()
    session = db.app_session()
    try:
        idem = session.execute(
            delete(IdempotencyRecord).where(IdempotencyRecord.expires_at < now)
        ).rowcount
        pending = session.execute(
            delete(PendingEmailChange).where(PendingEmailChange.expires_at < now)
        ).rowcount
        attempts = session.execute(
            delete(AuthAttempt).where(AuthAttempt.occurred_at < now - _AUTH_ATTEMPT_RETENTION)
        ).rowcount
        session.commit()
        return {
            "idempotency_records": int(idem or 0),
            "pending_email_changes": int(pending or 0),
            "auth_attempts": int(attempts or 0),
        }
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()


def run_cleanup_if_leader() -> bool:
    """Run cleanup only if we win a cluster-wide advisory lock (multi-container safe).

    Returns True if this process performed the prune, False if another already
    holds the lock. The lock is held only for the duration of the prune.
    """
    with db.app_engine.connect() as conn:
        acquired = conn.execute(
            text("SELECT pg_try_advisory_lock(:k)"), {"k": _CLEANUP_LOCK_KEY}
        ).scalar()
        if not acquired:
            return False
        try:
            counts = run_cleanup()
            if any(counts.values()):
                _log.info("cleanup pruned %s", counts)
            return True
        finally:
            conn.execute(text("SELECT pg_advisory_unlock(:k)"), {"k": _CLEANUP_LOCK_KEY})


def start_cleanup_scheduler(interval_seconds: int) -> threading.Thread:
    """Start a daemon thread that runs leader-gated cleanup every ``interval_seconds``.

    Safe to start in every gunicorn worker / container: the advisory lock ensures
    only one actually prunes each tick. Failures are logged, never fatal.
    """
    def _loop() -> None:
        while True:
            time.sleep(interval_seconds)
            try:
                run_cleanup_if_leader()
            except Exception:  # noqa: BLE001 - keep the loop alive
                _log.exception("periodic cleanup failed")

    thread = threading.Thread(target=_loop, name="securebank-cleanup", daemon=True)
    thread.start()
    return thread
