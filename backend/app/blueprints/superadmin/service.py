"""Superadmin domain logic (FR-08, SR-13/14).

A superadmin's remit is **role and admin management only** — it is a separate
role, not a superset of ``admin``: superadmins do not see customer-oversight
screens. They can:

* list the user directory with roles (to pick who to promote/demote),
* assign roles (``customer`` / ``admin`` / ``superadmin``),
* suspend / reactivate **admin and superadmin** accounts.

Guards enforced server-side and audited (SR-14):
* **No self-action** — a superadmin cannot change or suspend their own account;
  another superadmin must (prevents accidental self-lockout / self-demotion).
* **Last-superadmin guard** — the final *active* superadmin can never be demoted
  or suspended, so the system always retains a manageable superadmin.
* **Session revocation on privilege change** (SR-13) — changing a user's role or
  suspending them revokes all their sessions so stale privileges never linger.
"""

from __future__ import annotations

import uuid
from typing import Any, Optional

from sqlalchemy import func, or_, select, update

from ...extensions import db
from ...models import SessionRecord, User
from ...services.audit import emit_audit

_VALID_ROLES = ("customer", "admin", "superadmin")
# Accounts a superadmin may suspend/reactivate — admins are their remit; customers
# are the admin's job (a customer target returns 404, never confirming existence).
_MANAGEABLE_ROLES = ("admin", "superadmin")
_REASON_MAX = 500


class SuperadminError(Exception):
    status = 400
    message = "Action could not be completed."


class TargetNotFound(SuperadminError):
    status = 404
    message = "Not found."


class InvalidRole(SuperadminError):
    status = 400
    message = "Invalid role."


class SelfActionForbidden(SuperadminError):
    status = 403
    message = "You cannot change your own role or status; another superadmin must."


class LastSuperadmin(SuperadminError):
    status = 400
    message = "This is the last active superadmin and cannot be demoted or suspended."


def _validate_reason(raw: Any) -> str:
    reason = (raw or "").strip() if isinstance(raw, str) else ""
    if not reason:
        err = SuperadminError()
        err.message = "A reason is required."
        raise err
    return reason[:_REASON_MAX]


def _count_active_superadmins(session) -> int:
    return session.execute(
        select(func.count()).select_from(User)
        .where(User.role == "superadmin", User.account_status == "active")
    ).scalar_one()


def _is_last_active_superadmin(session, user: User) -> bool:
    """True if demoting/suspending ``user`` would leave zero active superadmins."""
    return (
        user.role == "superadmin"
        and user.account_status == "active"
        and _count_active_superadmins(session) <= 1
    )


def _revoke_sessions(session, user_id: uuid.UUID) -> None:
    session.execute(
        update(SessionRecord).where(SessionRecord.user_id == user_id).values(revoked=True)
    )


def list_directory(search: Optional[str] = None,
                   role: Optional[str] = None) -> list[dict[str, Any]]:
    """List users with their role/status for role management (FR-08).

    Identity + role + status only (masked NRIC included; no balances/transactions
    — superadmins do not get customer-oversight data). ``search`` filters email or
    name (parameterised ILIKE, SR-04); ``role`` filters to one role.
    """
    session = db.app_session()
    try:
        stmt = select(User).order_by(User.role.desc(), User.created_at.desc())
        if role and role in _VALID_ROLES:
            stmt = stmt.where(User.role == role)
        if search and search.strip():
            like = f"%{search.strip()}%"
            stmt = stmt.where(or_(User.email.ilike(like), User.full_name.ilike(like)))
        rows = session.execute(stmt).scalars().all()
        return [{
            "user_id": str(u.user_id),
            "email": u.email,
            "full_name": u.full_name,
            "nric_masked": u.nric_masked,
            "role": u.role,
            "account_status": u.account_status,
            "created_at": u.created_at.isoformat() if u.created_at else None,
        } for u in rows]
    finally:
        session.close()


def set_role(*, actor_id: uuid.UUID, target_user_id: uuid.UUID, new_role: str,
             source_ip: str) -> dict[str, Any]:
    """Assign ``new_role`` to a user (superadmin only, FR-08).

    Guards: valid role, not self, and the last active superadmin can't be demoted.
    On a real change the target's sessions are revoked (privilege change, SR-13)
    and the action is audited (SR-14).
    """
    if new_role not in _VALID_ROLES:
        raise InvalidRole()
    if actor_id == target_user_id:
        raise SelfActionForbidden()

    session = db.app_session()
    try:
        user = session.get(User, target_user_id)
        if user is None:
            raise TargetNotFound()
        old_role = user.role
        if old_role == new_role:
            return {"user_id": str(target_user_id), "role": new_role, "changed": False}
        if old_role == "superadmin" and _is_last_active_superadmin(session, user):
            raise LastSuperadmin()
        user.role = new_role
        _revoke_sessions(session, target_user_id)  # privilege change → drop sessions (SR-13)
        session.commit()
    finally:
        session.close()

    emit_audit("SUPERADMIN_SET_ROLE", "success", source_ip=source_ip, actor_user_id=actor_id,
               actor_role="superadmin", target_user_id=target_user_id,
               action_detail={"old_role": old_role, "new_role": new_role})
    return {"user_id": str(target_user_id), "role": new_role, "changed": True}


def suspend_admin(*, actor_id: uuid.UUID, target_user_id: uuid.UUID, reason: str,
                  source_ip: str) -> dict[str, Any]:
    """Suspend an admin/superadmin account and revoke its sessions (FR-08)."""
    reason = _validate_reason(reason)
    if actor_id == target_user_id:
        raise SelfActionForbidden()

    session = db.app_session()
    try:
        user = session.get(User, target_user_id)
        if user is None or user.role not in _MANAGEABLE_ROLES:
            raise TargetNotFound()
        if _is_last_active_superadmin(session, user):
            raise LastSuperadmin()
        user.account_status = "suspended"
        _revoke_sessions(session, target_user_id)
        session.commit()
    finally:
        session.close()

    emit_audit("SUPERADMIN_SUSPEND_ADMIN", "success", source_ip=source_ip, actor_user_id=actor_id,
               actor_role="superadmin", target_user_id=target_user_id,
               action_detail={"reason": reason})
    return {"user_id": str(target_user_id), "account_status": "suspended"}


def reactivate_admin(*, actor_id: uuid.UUID, target_user_id: uuid.UUID,
                     source_ip: str) -> dict[str, Any]:
    """Reactivate a suspended/locked admin/superadmin and clear lock counters (FR-08)."""
    session = db.app_session()
    try:
        user = session.get(User, target_user_id)
        if user is None or user.role not in _MANAGEABLE_ROLES:
            raise TargetNotFound()
        user.account_status = "active"
        user.failed_login_count = 0
        user.locked_until = None
        session.commit()
    finally:
        session.close()

    emit_audit("SUPERADMIN_REACTIVATE_ADMIN", "success", source_ip=source_ip,
               actor_user_id=actor_id, actor_role="superadmin", target_user_id=target_user_id)
    return {"user_id": str(target_user_id), "account_status": "active"}
