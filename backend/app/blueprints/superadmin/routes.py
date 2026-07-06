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
from ..admin.service import read_audit_log
from . import bp
from .service import (
    SuperadminError,
    list_directory,
    reactivate_admin,
    reveal_nric,
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


@bp.get("/audit")
@require_role("superadmin")
def audit():
    """Read the FULL audit log (superadmin scope) via the admin_reader engine.

    Unlike the admin view (customer-oversight, customer-related events only), the
    superadmin sees every event — including staff-to-staff activity such as role
    changes and admin/superadmin logins (FR-08, SR-14).

    Query params (optional): ``page``, ``type`` (event type), ``user`` (a UUID —
    events where that user is the actor or the target).
    """
    try:
        page = int(request.args.get("page", "1"))
    except ValueError:
        return jsonify(error="page must be an integer."), 400
    user_arg = request.args.get("user")
    target = None
    if user_arg:
        try:
            target = uuid.UUID(user_arg)
        except ValueError:
            return jsonify(error="user must be a valid UUID."), 400
    return jsonify(read_audit_log(page=page, event_type=request.args.get("type"),
                                  user_id=target, restrict_to_customers=False)), 200


@bp.get("/users/<user_id>/nric")
@require_role("superadmin")
def nric(user_id: str):
    """Reveal a user's FULL NRIC — superadmin scope: any user (audited, SR-03)."""
    try:
        result = reveal_nric(actor_id=g.user_id, target_user_id=_uuid(user_id),
                             source_ip=client_ip())
    except SuperadminError as exc:
        return jsonify(error=exc.message), exc.status
    return jsonify(result), 200


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
