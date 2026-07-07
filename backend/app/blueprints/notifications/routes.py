"""Notification HTTP routes (FR-10). Customer-only; every action is scoped to the
session user (SR-13) so a user only ever reads/updates their own alerts."""

from __future__ import annotations

import uuid

from flask import abort, g, jsonify, request

from ...security.decorators import require_role
from ...services.notifications import (
    list_notifications,
    mark_all_read,
    mark_read,
)
from . import bp


def _uuid(raw: str) -> uuid.UUID:
    try:
        return uuid.UUID(raw)
    except ValueError:
        abort(404)


@bp.get("")
@require_role("customer", touch=False)
def index():
    """List the current user's notifications (newest first) + unread count (FR-10).

    Query param: ``page`` (25/page default via the service). Ownership-scoped to
    the session user. ``touch=False``: the frontend bell polls this every 60s in
    the background regardless of whether the user is actually present, so it must
    not slide the SR-13 idle window — otherwise a session left open but genuinely
    unattended would never idle-timeout.
    """
    try:
        page = int(request.args.get("page", "1"))
    except ValueError:
        return jsonify(error="page must be an integer."), 400
    return jsonify(list_notifications(user_id=g.user_id, page=page)), 200


@bp.post("/<notification_id>/read")
@require_role("customer")
def read_one(notification_id: str):
    """Mark one notification read — only if it belongs to the session user (IDOR)."""
    mark_read(user_id=g.user_id, notification_id=_uuid(notification_id))
    return jsonify(status="ok"), 200


@bp.post("/read-all")
@require_role("customer")
def read_all():
    """Mark all of the session user's notifications read (FR-10)."""
    count = mark_all_read(user_id=g.user_id)
    return jsonify(status="ok", marked=count), 200
