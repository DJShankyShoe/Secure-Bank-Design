"""Server-side session management (SR-13).

Opaque random session IDs stored in ``session.sessions``; validated on every
protected request with a 15-min idle and 8-h absolute expiry. Logout / privilege
change revokes immediately and rotates the ID. The cookie carries only the opaque
token and is always Secure (when behind HTTPS) + HttpOnly + SameSite=Strict.

Functions take an app_user-bound :class:`Session`; the caller owns the transaction.
"""

from __future__ import annotations

import secrets
import uuid
from datetime import datetime, timezone
from typing import Optional

from flask import Response
from sqlalchemy.orm import Session

from ..config import Config
from ..models import SessionRecord

# 32 bytes -> ~43 url-safe chars, comfortably within session_id VARCHAR(64).
_TOKEN_BYTES = 32


def _now() -> datetime:
    return datetime.now(timezone.utc)


def create_session(db_session: Session, user_id: uuid.UUID, source_ip: str) -> str:
    """Create a server-side session and return its opaque ID (caller commits).

    Generating a fresh ID here is what regenerates the session on login /
    privilege change (SR-13) — there is no reuse of any pre-auth identifier.
    """
    token = secrets.token_urlsafe(_TOKEN_BYTES)
    now = _now()
    db_session.add(
        SessionRecord(
            session_id=token,
            user_id=user_id,
            last_active_at=now,
            absolute_expiry=now + Config.SESSION_ABSOLUTE_LIFETIME,
            source_ip=source_ip,
            revoked=False,
        )
    )
    return token


def validate_session(db_session: Session, session_id: str) -> Optional[SessionRecord]:
    """Return the live session for ``session_id`` or ``None`` (SR-13).

    Rejects revoked sessions, those past the 8-h absolute expiry, and those idle
    longer than 15 min (which are also revoked). On success ``last_active_at`` is
    refreshed (caller commits) to slide the idle window.
    """
    if not session_id:
        return None
    record = db_session.get(SessionRecord, session_id)
    if record is None or record.revoked:
        return None
    now = _now()
    if record.absolute_expiry <= now:
        return None
    if now - record.last_active_at > Config.SESSION_IDLE_TIMEOUT:
        record.revoked = True  # idle timeout -> kill it
        return None
    record.last_active_at = now
    return record


def revoke_session(db_session: Session, session_id: str) -> None:
    """Immediately revoke a session (logout / privilege change), idempotently."""
    record = db_session.get(SessionRecord, session_id)
    if record is not None:
        record.revoked = True


def set_session_cookie(response: Response, session_id: str, *, secure: bool) -> None:
    """Attach the session cookie with Secure/HttpOnly/SameSite=Strict flags (SR-13)."""
    response.set_cookie(
        Config.SESSION_COOKIE_NAME,
        session_id,
        max_age=int(Config.SESSION_ABSOLUTE_LIFETIME.total_seconds()),
        secure=secure,
        httponly=True,
        samesite=Config.SESSION_COOKIE_SAMESITE,
    )


def clear_session_cookie(response: Response, *, secure: bool) -> None:
    """Remove the session cookie on logout."""
    response.delete_cookie(
        Config.SESSION_COOKIE_NAME,
        secure=secure,
        httponly=True,
        samesite=Config.SESSION_COOKIE_SAMESITE,
    )
