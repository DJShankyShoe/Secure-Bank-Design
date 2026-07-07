"""Request-pipeline decorators: authentication, RBAC, IDOR.

Applied before protected handlers, in the order (session validation → CSRF is
global → role check → handler input validation → ownership). On every protected
request the role is re-verified server-side (FR-08) and the session re-validated
(SR-13). Failures use the generic error shape: 401 unauthenticated, 403
role/authorisation denied, 404 for IDOR (never confirm another user's resource).

``_authenticate`` populates ``flask.g`` once per request and is idempotent, so
``@require_authenticated`` and ``@require_role`` may be stacked in any order
without validating the session twice.
"""

from __future__ import annotations

import uuid
from functools import wraps
from typing import Callable, Optional

from flask import abort, g, jsonify, request

from ..config import Config
from ..extensions import db
from ..models import User
from ..security.sessions import revoke_session, validate_session
from ..services.audit import client_ip, emit_audit


def _unauthenticated():
    return jsonify(error="Authentication required."), 401


def _authenticate(*, touch: bool = True) -> Optional[tuple]:
    """Validate the session cookie and populate ``g`` (idempotent per request).

    Returns ``None`` on success (``g.user_id`` / ``g.user_role`` / ``g.session_id``
    set), or a ``(response, 401)`` tuple to short-circuit the handler. A session
    whose user is missing or no longer ``active`` is revoked and rejected.
    ``touch=False`` skips sliding the idle window (SR-13) — see
    :func:`require_role`.
    """
    if getattr(g, "_auth_done", False):
        return None

    session_id = request.cookies.get(Config.SESSION_COOKIE_NAME, "")
    session = db.app_session()
    try:
        record = validate_session(session, session_id, touch=touch)
        if record is None:
            session.commit()  # persist a possible idle-revoke
            return _unauthenticated()

        user = session.get(User, record.user_id)
        if user is None or user.account_status != "active":
            revoke_session(session, session_id)
            session.commit()
            return _unauthenticated()

        session.commit()  # persist the slid idle window (last_active_at)
        g.user_id = user.user_id
        g.user_role = user.role
        g.session_id = session_id
        g._auth_done = True
        return None
    finally:
        session.close()


def require_authenticated(fn: Callable) -> Callable:
    """Require a valid server-side session; else 401 (SR-13)."""

    @wraps(fn)
    def wrapper(*args, **kwargs):
        err = _authenticate()
        if err is not None:
            return err
        return fn(*args, **kwargs)

    return wrapper


def require_role(*roles: str, touch: bool = True) -> Callable:
    """Require an authenticated session whose role is in ``roles``; else 403 (FR-08).

    Role is checked server-side on every request. Denials are audited (SR-14).

    ``touch=False`` skips sliding the 15-min idle window (SR-13) for this route —
    use it only for passive/background requests that don't represent genuine user
    activity (e.g. the notification-bell's periodic poll). Without this, a session
    left open in a background tab would never idle-timeout, since the poll itself
    would keep resetting the clock every time it fires — defeating SR-13's intent
    of logging out a user who has actually stepped away.
    """

    def decorator(fn: Callable) -> Callable:
        @wraps(fn)
        def wrapper(*args, **kwargs):
            err = _authenticate(touch=touch)
            if err is not None:
                return err
            if g.user_role not in roles:
                emit_audit(
                    "AUTHZ_DENIED",
                    "denied",
                    source_ip=client_ip(),
                    actor_user_id=g.user_id,
                    actor_role=g.user_role,
                    action_detail={"required": list(roles), "path": request.path},
                )
                return jsonify(error="Forbidden."), 403
            return fn(*args, **kwargs)

        return wrapper

    return decorator


def ensure_owner(resource_user_id: Optional[uuid.UUID]) -> None:
    """Abort 404 unless the resource belongs to the current user (IDOR).

    Returns 404 (not 403) on mismatch or a missing resource so the response never
    confirms that another user's resource exists. Call after loading the resource.
    """
    if resource_user_id is None or resource_user_id != g.get("user_id"):
        abort(404)
