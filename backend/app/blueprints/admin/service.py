"""Admin domain logic (FR-08, SR-03/14).

Admin-only operations: list users/accounts, suspend/unlock users, admin-close an
account (with a logged reason), read the audit log (via the SELECT-only
``admin_reader`` engine), and the **audited full-NRIC reveal** (SR-03). Every
admin action that touches a customer is audited with the admin as actor (FR-08).
"""

from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Any, Optional

from flask import current_app
from sqlalchemy import or_, select, update

from ...extensions import db
from ...models import Account, AuditEvent, SessionRecord, User
from ...security import crypto
from ...services.audit import emit_audit

_AUDIT_PAGE_SIZE = 50


class AdminError(Exception):
    status = 400
    message = "Admin action could not be completed."


class TargetNotFound(AdminError):
    status = 404
    message = "Not found."


class CannotClose(AdminError):
    status = 400
    message = "Account balance must be zero to close."


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _validate_reason(raw: str) -> str:
    reason = (raw or "").strip()
    if not reason:
        err = AdminError()
        err.message = "A reason is required."
        raise err
    if len(reason) > 255:
        err = AdminError()
        err.message = "Reason is too long."
        raise err
    return reason


# --------------------------------------------------------------------------- #
# Read views
# --------------------------------------------------------------------------- #

def _require_customer(session, user_id: uuid.UUID) -> User:
    """Load a user and reject (404) unless they are a ``customer`` (FR-08).

    Admins may only view/act on customers — never other admins or superadmins.
    Returns 404 (TargetNotFound), not 403, so the response never confirms that a
    privileged account with that id exists.
    """
    user = session.get(User, user_id)
    if user is None or user.role != "customer":
        raise TargetNotFound()
    return user


def list_users(search: Optional[str] = None) -> list[dict[str, Any]]:
    """List **customers** with masked NRIC (admin view, FR-08).

    Admins see customers only — admin/superadmin accounts are managed in the
    superadmin area, never listed here. Optional ``search`` filters by a
    case-insensitive partial match on email or full name (parameterised ILIKE — no
    raw SQL, SR-04).
    """
    session = db.app_session()
    try:
        stmt = select(User).where(User.role == "customer").order_by(User.created_at.desc())
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


def list_all_accounts() -> list[dict[str, Any]]:
    """List every account with its owner (admin view, FR-08)."""
    session = db.app_session()
    try:
        rows = session.execute(select(Account).order_by(Account.created_at.desc())).scalars().all()
        return [{
            "account_id": str(a.account_id),
            "user_id": str(a.user_id),
            "account_number": a.account_number,
            "account_type": a.account_type,
            "balance_cents": a.balance_cents,
            "status": a.status,
        } for a in rows]
    finally:
        session.close()


def list_user_accounts(*, user_id: uuid.UUID) -> list[dict[str, Any]]:
    """List one **customer's** accounts for the admin user-directory drill-down (FR-08)."""
    session = db.app_session()
    try:
        _require_customer(session, user_id)  # admins drill into customers only
        rows = session.execute(
            select(Account).where(Account.user_id == user_id)
            .order_by(Account.created_at.desc())
        ).scalars().all()
        return [{
            "account_id": str(a.account_id),
            "account_number": a.account_number,
            "account_type": a.account_type,
            "balance_cents": a.balance_cents,
            "status": a.status,
        } for a in rows]
    finally:
        session.close()


def read_audit_log(*, page: int = 1, event_type: Optional[str] = None,
                   user_id: Optional[uuid.UUID] = None) -> dict[str, Any]:
    """Read the audit log via the SELECT-only admin_reader engine (FR-08, SR-14).

    Optional filters: ``event_type`` (exact action type) and ``user_id`` (every
    event where the user is the actor **or** the target). Both compose.
    """
    page = max(page, 1)
    reader = db.admin_reader_session()
    try:
        stmt = select(AuditEvent)
        if event_type:
            stmt = stmt.where(AuditEvent.event_type == event_type)
        if user_id is not None:
            stmt = stmt.where(or_(AuditEvent.actor_user_id == user_id,
                                  AuditEvent.target_user_id == user_id))
        stmt = (stmt.order_by(AuditEvent.event_timestamp.desc())
                .limit(_AUDIT_PAGE_SIZE).offset((page - 1) * _AUDIT_PAGE_SIZE))
        rows = reader.execute(stmt).scalars().all()
        items = [{
            "event_id": str(e.event_id),
            "event_timestamp": e.event_timestamp.isoformat() if e.event_timestamp else None,
            "event_type": e.event_type,
            "actor_user_id": str(e.actor_user_id) if e.actor_user_id else None,
            "actor_role": e.actor_role,
            "target_user_id": str(e.target_user_id) if e.target_user_id else None,
            "source_ip": str(e.source_ip) if e.source_ip else None,
            "outcome": e.outcome,
            "action_detail": e.action_detail,
        } for e in rows]
        return {"items": items, "page": page, "page_size": _AUDIT_PAGE_SIZE}
    finally:
        reader.close()


# --------------------------------------------------------------------------- #
# Mutations
# --------------------------------------------------------------------------- #

def suspend_user(*, admin_id: uuid.UUID, target_user_id: uuid.UUID, reason: str,
                 source_ip: str) -> None:
    """Suspend a user (admin) and revoke their sessions; reason logged (FR-08)."""
    reason = _validate_reason(reason)
    session = db.app_session()
    try:
        user = _require_customer(session, target_user_id)
        user.account_status = "suspended"
        session.execute(
            update(SessionRecord).where(SessionRecord.user_id == target_user_id)
            .values(revoked=True)
        )
        session.commit()
    finally:
        session.close()
    emit_audit("ADMIN_SUSPEND_USER", "success", source_ip=source_ip, actor_user_id=admin_id,
               actor_role="admin", target_user_id=target_user_id,
               action_detail={"reason": reason})


def unlock_user(*, admin_id: uuid.UUID, target_user_id: uuid.UUID, source_ip: str) -> None:
    """Reactivate a locked/suspended user and clear lock counters (FR-08, SR-09)."""
    session = db.app_session()
    try:
        user = _require_customer(session, target_user_id)
        user.account_status = "active"
        user.failed_login_count = 0
        user.locked_until = None
        session.commit()
    finally:
        session.close()
    emit_audit("ADMIN_UNLOCK_USER", "success", source_ip=source_ip, actor_user_id=admin_id,
               actor_role="admin", target_user_id=target_user_id)


def admin_close_account(*, admin_id: uuid.UUID, account_id: uuid.UUID, reason: str,
                        source_ip: str) -> dict[str, Any]:
    """Admin-close an account with a logged reason; balance must be 0 (FR-05/08)."""
    reason = _validate_reason(reason)
    session = db.app_session()
    try:
        account = session.execute(
            select(Account).where(Account.account_id == account_id).with_for_update()
        ).scalar_one_or_none()
        if account is None or account.status != "active":
            raise TargetNotFound()
        if account.balance_cents != 0:
            session.rollback()
            emit_audit("ADMIN_CLOSE_ACCOUNT", "failure", source_ip=source_ip,
                       actor_user_id=admin_id, actor_role="admin", target_user_id=account.user_id,
                       action_detail={"reason": reason, "fail": "non_zero_balance",
                                      "account_id": str(account_id)})
            raise CannotClose()
        owner = account.user_id
        account.status = "closed"
        account.closed_at = _now()
        session.commit()
    finally:
        session.close()
    emit_audit("ADMIN_CLOSE_ACCOUNT", "success", source_ip=source_ip, actor_user_id=admin_id,
               actor_role="admin", target_user_id=owner,
               action_detail={"reason": reason, "account_id": str(account_id)})
    return {"account_id": str(account_id), "status": "closed"}


def approve_account_closure(*, admin_id: uuid.UUID, account_id: uuid.UUID,
                            source_ip: str) -> dict[str, Any]:
    """Approve a pending customer closure request -> close the account (FR-05/08).

    Only acts on an account in ``close_requested``; re-checks the zero-balance
    invariant under a row lock. Audited with the admin as actor.
    """
    session = db.app_session()
    try:
        account = session.execute(
            select(Account).where(Account.account_id == account_id).with_for_update()
        ).scalar_one_or_none()
        if account is None or account.status != "close_requested":
            raise TargetNotFound()
        if account.balance_cents != 0:
            session.rollback()
            emit_audit("ADMIN_CLOSURE_APPROVE", "failure", source_ip=source_ip,
                       actor_user_id=admin_id, actor_role="admin",
                       target_user_id=account.user_id,
                       action_detail={"fail": "non_zero_balance",
                                      "account_id": str(account_id)})
            raise CannotClose()
        owner = account.user_id
        account.status = "closed"
        account.closed_at = _now()
        session.commit()
    finally:
        session.close()
    emit_audit("ADMIN_CLOSURE_APPROVE", "success", source_ip=source_ip, actor_user_id=admin_id,
               actor_role="admin", target_user_id=owner,
               action_detail={"account_id": str(account_id)})
    return {"account_id": str(account_id), "status": "closed"}


def reject_account_closure(*, admin_id: uuid.UUID, account_id: uuid.UUID, reason: str,
                           source_ip: str) -> dict[str, Any]:
    """Reject a pending customer closure request -> reactivate the account (FR-05/08).

    Only acts on an account in ``close_requested``. The reason is required and
    logged. Audited with the admin as actor.
    """
    reason = _validate_reason(reason)
    session = db.app_session()
    try:
        account = session.execute(
            select(Account).where(Account.account_id == account_id).with_for_update()
        ).scalar_one_or_none()
        if account is None or account.status != "close_requested":
            raise TargetNotFound()
        owner = account.user_id
        account.status = "active"
        session.commit()
    finally:
        session.close()
    emit_audit("ADMIN_CLOSURE_REJECT", "success", source_ip=source_ip, actor_user_id=admin_id,
               actor_role="admin", target_user_id=owner,
               action_detail={"reason": reason, "account_id": str(account_id)})
    return {"account_id": str(account_id), "status": "active"}


def approve_account_opening(*, admin_id: uuid.UUID, account_id: uuid.UUID,
                            source_ip: str) -> dict[str, Any]:
    """Approve a new account opening request -> activate it (FR-02/08).

    Only acts on an account in ``open_requested``. Audited with the admin as actor.
    """
    session = db.app_session()
    try:
        account = session.execute(
            select(Account).where(Account.account_id == account_id).with_for_update()
        ).scalar_one_or_none()
        if account is None or account.status != "open_requested":
            raise TargetNotFound()
        owner = account.user_id
        account.status = "active"
        session.commit()
    finally:
        session.close()
    emit_audit("ADMIN_OPEN_APPROVE", "success", source_ip=source_ip, actor_user_id=admin_id,
               actor_role="admin", target_user_id=owner,
               action_detail={"account_id": str(account_id)})
    return {"account_id": str(account_id), "status": "active"}


def reject_account_opening(*, admin_id: uuid.UUID, account_id: uuid.UUID, reason: str,
                           source_ip: str) -> dict[str, Any]:
    """Reject a new account opening request -> close it (FR-02/08). Reason logged.

    Only acts on an account in ``open_requested`` (never activated), which becomes
    ``closed``. Audited with the admin as actor.
    """
    reason = _validate_reason(reason)
    session = db.app_session()
    try:
        account = session.execute(
            select(Account).where(Account.account_id == account_id).with_for_update()
        ).scalar_one_or_none()
        if account is None or account.status != "open_requested":
            raise TargetNotFound()
        owner = account.user_id
        account.status = "closed"
        account.closed_at = _now()
        session.commit()
    finally:
        session.close()
    emit_audit("ADMIN_OPEN_REJECT", "success", source_ip=source_ip, actor_user_id=admin_id,
               actor_role="admin", target_user_id=owner,
               action_detail={"reason": reason, "account_id": str(account_id)})
    return {"account_id": str(account_id), "status": "closed"}


def suspend_account(*, admin_id: uuid.UUID, account_id: uuid.UUID, reason: str,
                    source_ip: str) -> dict[str, Any]:
    """Freeze a single account (admin, FR-08). Reversible; reason logged.

    Only an ``active`` account can be suspended. A ``suspended`` account is frozen
    for transfers (the money path requires ``status=='active'``) but the owner can
    still log in and use their other accounts.
    """
    reason = _validate_reason(reason)
    session = db.app_session()
    try:
        account = session.execute(
            select(Account).where(Account.account_id == account_id).with_for_update()
        ).scalar_one_or_none()
        if account is None or account.status != "active":
            raise TargetNotFound()
        owner = account.user_id
        account.status = "suspended"
        session.commit()
    finally:
        session.close()
    emit_audit("ADMIN_SUSPEND_ACCOUNT", "success", source_ip=source_ip, actor_user_id=admin_id,
               actor_role="admin", target_user_id=owner,
               action_detail={"reason": reason, "account_id": str(account_id)})
    return {"account_id": str(account_id), "status": "suspended"}


def unsuspend_account(*, admin_id: uuid.UUID, account_id: uuid.UUID,
                      source_ip: str) -> dict[str, Any]:
    """Lift a suspension on an account -> ``active`` (admin, FR-08)."""
    session = db.app_session()
    try:
        account = session.execute(
            select(Account).where(Account.account_id == account_id).with_for_update()
        ).scalar_one_or_none()
        if account is None or account.status != "suspended":
            raise TargetNotFound()
        owner = account.user_id
        account.status = "active"
        session.commit()
    finally:
        session.close()
    emit_audit("ADMIN_UNSUSPEND_ACCOUNT", "success", source_ip=source_ip, actor_user_id=admin_id,
               actor_role="admin", target_user_id=owner,
               action_detail={"account_id": str(account_id)})
    return {"account_id": str(account_id), "status": "active"}


def reveal_nric(*, admin_id: uuid.UUID, target_user_id: uuid.UUID,
                source_ip: str) -> dict[str, Any]:
    """Decrypt and return a user's FULL NRIC; the read is audited (SR-03)."""
    key = current_app.extensions["securebank_config"].aes_encryption_key
    session = db.app_session()
    try:
        user = _require_customer(session, target_user_id)
        full = crypto.aes_decrypt(user.nric_encrypted, key).decode("utf-8")
        masked = user.nric_masked
    finally:
        session.close()
    emit_audit("NRIC_REVEAL", "success", source_ip=source_ip, actor_user_id=admin_id,
               actor_role="admin", target_user_id=target_user_id)
    return {"user_id": str(target_user_id), "nric": full, "nric_masked": masked}
