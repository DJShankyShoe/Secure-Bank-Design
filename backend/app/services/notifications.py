"""In-app notification service (FR-10).

Creates and reads the user-facing alerts shown in the customer notification bell.
Writes via the ``app_user`` engine (``application.notifications``). This is the
customer-visible channel and is deliberately separate from the ``audit`` schema,
which is append-only and NOT readable by the customer role (SR-14).

Notification creation is best-effort and isolated on its own session: an alert is
a side effect of a business action, so a failure to record it must never roll back
or break that action (mirrors the audit emitter's independence).
"""

from __future__ import annotations

import logging
import uuid
from datetime import datetime, timezone
from typing import Any, Optional

from sqlalchemy import func, select, update

from ..extensions import db
from ..models import Notification

logger = logging.getLogger(__name__)

# Newest-first; a generous cap keeps the bell payload bounded (history stays in DB).
_PAGE_SIZE = 50


def create_notification(*, user_id: uuid.UUID, category: str, title: str, body: str) -> None:
    """Record an in-app alert for ``user_id`` (FR-10).

    Best-effort and self-contained: runs on its own session and never raises to the
    caller, so a logging failure can't undo the business action that triggered it.
    """
    session = db.app_session()
    try:
        session.add(Notification(
            user_id=user_id, category=category[:32], title=title[:120], body=body[:1000],
        ))
        session.commit()
    except Exception:  # pragma: no cover - defensive; alert is non-critical
        session.rollback()
        logger.exception("Failed to record notification for user %s", user_id)
    finally:
        session.close()


def list_notifications(*, user_id: uuid.UUID, page: int = 1) -> dict[str, Any]:
    """Return a user's notifications (newest first) + the unread count (FR-10).

    Ownership-scoped to ``user_id`` (SR-13): a user only ever sees their own.
    """
    page = max(page, 1)
    session = db.app_session()
    try:
        rows = session.execute(
            select(Notification)
            .where(Notification.user_id == user_id)
            .order_by(Notification.created_at.desc())
            .limit(_PAGE_SIZE).offset((page - 1) * _PAGE_SIZE)
        ).scalars().all()
        unread = session.execute(
            select(func.count()).select_from(Notification)
            .where(Notification.user_id == user_id, Notification.read_at.is_(None))
        ).scalar_one()
        items = [{
            "notification_id": str(n.notification_id),
            "category": n.category,
            "title": n.title,
            "body": n.body,
            "read": n.read_at is not None,
            "created_at": n.created_at.isoformat() if n.created_at else None,
        } for n in rows]
        return {"items": items, "unread_count": unread, "page": page, "page_size": _PAGE_SIZE}
    finally:
        session.close()


def mark_read(*, user_id: uuid.UUID, notification_id: uuid.UUID) -> bool:
    """Mark one notification read — only if it belongs to ``user_id`` (IDOR-safe).

    Returns True if a row was updated. The ``user_id`` predicate is the ownership
    check (SR-13): another user's id simply matches nothing.
    """
    now = datetime.now(timezone.utc)
    session = db.app_session()
    try:
        result = session.execute(
            update(Notification)
            .where(Notification.notification_id == notification_id,
                   Notification.user_id == user_id,
                   Notification.read_at.is_(None))
            .values(read_at=now)
        )
        session.commit()
        return result.rowcount > 0
    finally:
        session.close()


def mark_all_read(*, user_id: uuid.UUID) -> int:
    """Mark all of a user's unread notifications read. Returns how many were updated."""
    now = datetime.now(timezone.utc)
    session = db.app_session()
    try:
        result = session.execute(
            update(Notification)
            .where(Notification.user_id == user_id, Notification.read_at.is_(None))
            .values(read_at=now)
        )
        session.commit()
        return result.rowcount
    finally:
        session.close()


def notify(user_id: Optional[uuid.UUID], category: str, title: str, body: str) -> None:
    """Convenience wrapper: record a notification when ``user_id`` is known.

    No-op for a missing user id so callers can fire unconditionally.
    """
    if user_id is None:
        return
    create_notification(user_id=user_id, category=category, title=title, body=body)
