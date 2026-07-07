"""Server-side session tests (SR-13)."""

from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone

from app.models import SessionRecord, User
from app.security.sessions import create_session, revoke_session, validate_session


def _make_user(s) -> User:
    u = User(
        email=f"sess-{uuid.uuid4().hex[:10]}@example.com",
        full_name="Sess",
        nric_encrypted=b"x" * 16,
        nric_masked="S****1A",
        password_hash="h",
        role="customer",
        account_status="active",
    )
    s.add(u)
    s.flush()
    return u


def test_session_create_validate_revoke(require_db):
    from app.extensions import db

    s = db.app_session()
    try:
        u = _make_user(s)
        sid = create_session(s, u.user_id, "203.0.113.1")
        s.commit()
        assert 0 < len(sid) <= 64
        rec = validate_session(s, sid)
        assert rec is not None and rec.user_id == u.user_id
        s.commit()
        revoke_session(s, sid)
        s.commit()
        assert validate_session(s, sid) is None
    finally:
        s.close()


def test_session_absolute_expiry(require_db):
    from app.extensions import db

    s = db.app_session()
    try:
        u = _make_user(s)
        sid = create_session(s, u.user_id, "203.0.113.1")
        rec = s.get(SessionRecord, sid)
        rec.absolute_expiry = datetime.now(timezone.utc) - timedelta(seconds=1)
        s.commit()
        assert validate_session(s, sid) is None
    finally:
        s.close()


def test_session_idle_timeout(require_db):
    from app.extensions import db

    s = db.app_session()
    try:
        u = _make_user(s)
        sid = create_session(s, u.user_id, "203.0.113.1")
        rec = s.get(SessionRecord, sid)
        rec.last_active_at = datetime.now(timezone.utc) - timedelta(minutes=16)
        s.commit()
        assert validate_session(s, sid) is None
        # idle timeout also revokes it
        assert s.get(SessionRecord, sid).revoked is True
    finally:
        s.close()


def test_validate_unknown_session_returns_none(require_db):
    from app.extensions import db

    s = db.app_session()
    try:
        assert validate_session(s, "does-not-exist") is None
    finally:
        s.close()


def test_validate_session_touch_false_does_not_slide_idle_window(require_db):
    """touch=False (the notification-bell poll) must not extend last_active_at —
    otherwise a session left open but genuinely unattended never idles out (SR-13)."""
    from app.extensions import db

    s = db.app_session()
    try:
        u = _make_user(s)
        sid = create_session(s, u.user_id, "203.0.113.1")
        rec = s.get(SessionRecord, sid)
        stale = datetime.now(timezone.utc) - timedelta(minutes=5)
        rec.last_active_at = stale
        s.commit()

        result = validate_session(s, sid, touch=False)
        assert result is not None
        assert s.get(SessionRecord, sid).last_active_at == stale  # unchanged
    finally:
        s.close()


def test_validate_session_touch_false_still_enforces_idle_timeout(require_db):
    """touch=False skips sliding the window, but an already-idle session must
    still be rejected/revoked — it's not an exemption from the timeout itself."""
    from app.extensions import db

    s = db.app_session()
    try:
        u = _make_user(s)
        sid = create_session(s, u.user_id, "203.0.113.1")
        rec = s.get(SessionRecord, sid)
        rec.last_active_at = datetime.now(timezone.utc) - timedelta(minutes=16)
        s.commit()

        assert validate_session(s, sid, touch=False) is None
        assert s.get(SessionRecord, sid).revoked is True
    finally:
        s.close()
