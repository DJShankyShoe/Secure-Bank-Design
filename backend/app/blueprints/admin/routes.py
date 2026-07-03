"""Admin HTTP routes (FR-08). Every route is gated by @require_role('admin');
each customer-affecting action is audited in the service layer."""

from __future__ import annotations

import uuid

from flask import abort, g, jsonify, request

from ...security.decorators import require_role
from ...services.audit import client_ip
from . import bp
from .service import (
    AdminError,
    admin_close_account,
    approve_account_closure,
    list_all_accounts,
    list_user_accounts,
    list_users,
    read_audit_log,
    reject_account_closure,
    reveal_nric,
    suspend_account,
    suspend_user,
    unlock_user,
    unsuspend_account,
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
@require_role("admin")
def users():
    """List users (masked NRIC); optional ``?q=`` searches email/name — FR-08."""
    return jsonify(users=list_users(search=request.args.get("q"))), 200


@bp.get("/accounts")
@require_role("admin")
def accounts():
    """List all accounts — FR-08."""
    return jsonify(accounts=list_all_accounts()), 200


@bp.get("/users/<user_id>/accounts")
@require_role("admin")
def user_accounts(user_id: str):
    """List one user's accounts (user-directory drill-down) — FR-08."""
    return jsonify(accounts=list_user_accounts(user_id=_uuid(user_id))), 200


@bp.get("/audit")
@require_role("admin")
def audit():
    """Read the audit log via the SELECT-only admin_reader engine (FR-08, SR-14).

    Query params (optional): ``page``, ``type`` (event type), ``user`` (a UUID —
    returns events where that user is the actor or the target).
    """
    try:
        page = int(request.args.get("page", "1"))
    except ValueError:
        return jsonify(error="page must be an integer."), 400
    user_arg = request.args.get("user")
    user_id = None
    if user_arg:
        try:
            user_id = uuid.UUID(user_arg)
        except ValueError:
            return jsonify(error="user must be a valid UUID."), 400
    return jsonify(read_audit_log(page=page, event_type=request.args.get("type"),
                                  user_id=user_id)), 200


@bp.post("/users/<user_id>/suspend")
@require_role("admin")
def suspend(user_id: str):
    """Suspend a user (reason required, logged) — FR-08."""
    try:
        suspend_user(admin_id=g.user_id, target_user_id=_uuid(user_id),
                     reason=_json().get("reason", ""), source_ip=client_ip())
    except AdminError as exc:
        return jsonify(error=exc.message), exc.status
    return jsonify(status="suspended"), 200


@bp.post("/users/<user_id>/unlock")
@require_role("admin")
def unlock(user_id: str):
    """Reactivate a locked/suspended user — FR-08."""
    try:
        unlock_user(admin_id=g.user_id, target_user_id=_uuid(user_id), source_ip=client_ip())
    except AdminError as exc:
        return jsonify(error=exc.message), exc.status
    return jsonify(status="active"), 200


@bp.get("/users/<user_id>/nric")
@require_role("admin")
def nric(user_id: str):
    """Reveal a user's FULL NRIC (audited) — SR-03."""
    try:
        result = reveal_nric(admin_id=g.user_id, target_user_id=_uuid(user_id),
                             source_ip=client_ip())
    except AdminError as exc:
        return jsonify(error=exc.message), exc.status
    return jsonify(result), 200


@bp.post("/accounts/<account_id>/close")
@require_role("admin")
def close(account_id: str):
    """Admin-close an account with a logged reason — FR-05/08."""
    try:
        result = admin_close_account(admin_id=g.user_id, account_id=_uuid(account_id),
                                     reason=_json().get("reason", ""), source_ip=client_ip())
    except AdminError as exc:
        return jsonify(error=exc.message), exc.status
    return jsonify(result), 200


@bp.post("/accounts/<account_id>/closure/approve")
@require_role("admin")
def closure_approve(account_id: str):
    """Approve a pending customer closure request -> close the account (FR-05/08)."""
    try:
        result = approve_account_closure(admin_id=g.user_id, account_id=_uuid(account_id),
                                         source_ip=client_ip())
    except AdminError as exc:
        return jsonify(error=exc.message), exc.status
    return jsonify(result), 200


@bp.post("/accounts/<account_id>/closure/reject")
@require_role("admin")
def closure_reject(account_id: str):
    """Reject a pending customer closure request -> reactivate it (FR-05/08). Reason required."""
    try:
        result = reject_account_closure(admin_id=g.user_id, account_id=_uuid(account_id),
                                        reason=_json().get("reason", ""), source_ip=client_ip())
    except AdminError as exc:
        return jsonify(error=exc.message), exc.status
    return jsonify(result), 200


@bp.post("/accounts/<account_id>/suspend")
@require_role("admin")
def account_suspend(account_id: str):
    """Suspend (freeze) a single account (admin) — FR-08. Reason required."""
    try:
        result = suspend_account(admin_id=g.user_id, account_id=_uuid(account_id),
                                 reason=_json().get("reason", ""), source_ip=client_ip())
    except AdminError as exc:
        return jsonify(error=exc.message), exc.status
    return jsonify(result), 200


@bp.post("/accounts/<account_id>/unsuspend")
@require_role("admin")
def account_unsuspend(account_id: str):
    """Lift an account suspension -> active (admin) — FR-08."""
    try:
        result = unsuspend_account(admin_id=g.user_id, account_id=_uuid(account_id),
                                   source_ip=client_ip())
    except AdminError as exc:
        return jsonify(error=exc.message), exc.status
    return jsonify(result), 200
