"""Superadmin HTTP routes (FR-08, SR-13/14).

Every route is gated by ``@require_role('superadmin')``; each action is audited in
the service layer with the superadmin as actor. Superadmin ≠ admin: these routes
manage roles and admin/superadmin accounts only, never customer data.
"""

from __future__ import annotations

import uuid

from flask import abort, g, jsonify, request

from ...security.decorators import require_role
from ...services.audit import client_ip
from . import bp
from .service import (
    SuperadminError,
    list_directory,
    reactivate_admin,
    set_role,
    suspend_admin,
)


def _json() -> dict:
    data = request.get_json(silent=True)
    return data if isinstance(data, dict) else {}


def _uuid(raw: str) -> uuid.UUID:
    try:
        return uuid.UUID(raw)
    except ValueError:
        abort(404)


@bp.get("/users")
@require_role("superadmin")
def directory():
    """List users with roles for role management; ``?q=`` search, ``?role=`` filter."""
    return jsonify(users=list_directory(
        search=request.args.get("q"), role=request.args.get("role"))), 200


@bp.post("/users/<user_id>/role")
@require_role("superadmin")
def assign_role(user_id: str):
    """Assign a role (``customer``/``admin``/``superadmin``) to a user — FR-08."""
    try:
        result = set_role(
            actor_id=g.user_id,
            target_user_id=_uuid(user_id),
            new_role=(_json().get("role") or "").strip(),
            source_ip=client_ip(),
        )
    except SuperadminError as exc:
        return jsonify(error=exc.message), exc.status
    return jsonify(result), 200


@bp.post("/users/<user_id>/suspend")
@require_role("superadmin")
def suspend(user_id: str):
    """Suspend an admin/superadmin account (reason required) — FR-08."""
    try:
        result = suspend_admin(
            actor_id=g.user_id,
            target_user_id=_uuid(user_id),
            reason=_json().get("reason", ""),
            source_ip=client_ip(),
        )
    except SuperadminError as exc:
        return jsonify(error=exc.message), exc.status
    return jsonify(result), 200


@bp.post("/users/<user_id>/reactivate")
@require_role("superadmin")
def reactivate(user_id: str):
    """Reactivate a suspended/locked admin/superadmin account — FR-08."""
    try:
        result = reactivate_admin(
            actor_id=g.user_id,
            target_user_id=_uuid(user_id),
            source_ip=client_ip(),
        )
    except SuperadminError as exc:
        return jsonify(error=exc.message), exc.status
    return jsonify(result), 200
