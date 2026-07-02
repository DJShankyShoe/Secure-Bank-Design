"""Account domain logic (FR-02/03).

Create a customer account with a server-generated, unguessable 10-digit number and
a zero opening balance; list/fetch a customer's own accounts. Ownership is the
caller's responsibility via the session ``user_id`` (SR-13) — these functions are
scoped to a ``user_id`` and never trust a client-supplied owner.
"""

from __future__ import annotations

import secrets
import uuid
from datetime import datetime, timezone
from math import ceil
from typing import Any, Optional

from flask import current_app
from sqlalchemy import func, or_, select
from sqlalchemy.exc import IntegrityError

from ...config import Config
from ...extensions import db
from ...models import Account, Biller, Transaction, User
from ...security import lockout
from ...security.mfa import verify_totp
from ...security.validation import validate_account_type, validate_totp_code
from ...services.audit import emit_audit


class AccountActionError(Exception):
    status = 400
    message = "Account action could not be completed."


class NonZeroBalance(AccountActionError):
    status = 400
    message = "Account balance must be zero to close."


class AccountNotOpen(AccountActionError):
    status = 400
    message = "Account is not open."


class StepUpFailed(AccountActionError):
    status = 401
    message = "Invalid authentication code."


class StepUpRateLimited(AccountActionError):
    status = 429
    message = "Too many attempts. Please try again later."


_DIGITS = "0123456789"
_MAX_NUMBER_ATTEMPTS = 5


def generate_account_number() -> str:
    """Return a cryptographically-random 10-digit account number (FR-02).

    Random (not sequential) so account numbers are unguessable; uniqueness is
    guaranteed by the DB UNIQUE constraint plus the insert-retry in create_account.
    """
    return "".join(secrets.choice(_DIGITS) for _ in range(Config.ACCOUNT_NUMBER_LENGTH))


def serialize_account(account: Account) -> dict[str, Any]:
    """Serialise an account for an API response (no owner id leaked)."""
    return {
        "account_id": str(account.account_id),
        "account_number": account.account_number,
        "account_type": account.account_type,
        "balance_cents": account.balance_cents,
        "status": account.status,
        "created_at": account.created_at.isoformat() if account.created_at else None,
    }


def create_account(*, user_id: uuid.UUID, account_type: str, source_ip: str) -> dict[str, Any]:
    """Create a savings/current account for ``user_id`` with balance 0 (FR-02)."""
    account_type = validate_account_type(account_type)

    session = db.app_session()
    try:
        account: Optional[Account] = None
        for _ in range(_MAX_NUMBER_ATTEMPTS):
            candidate = Account(
                user_id=user_id,
                account_number=generate_account_number(),
                account_type=account_type,
            )
            session.add(candidate)
            try:
                with session.begin_nested():  # SAVEPOINT: retry on number collision
                    session.flush()
                account = candidate
                break
            except IntegrityError:
                session.expunge(candidate)
        if account is None:
            raise RuntimeError("could not allocate a unique account number")

        session.commit()
        result = serialize_account(account)
        account_id = account.account_id
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()

    emit_audit(
        "ACCOUNT_CREATE",
        "success",
        source_ip=source_ip,
        actor_user_id=user_id,
        actor_role="customer",
        target_user_id=user_id,
        action_detail={"account_id": str(account_id), "account_type": account_type},
    )
    return result


def list_accounts(*, user_id: uuid.UUID) -> list[dict[str, Any]]:
    """Return all of the user's accounts (FR-03), newest first."""
    session = db.app_session()
    try:
        rows = session.execute(
            select(Account).where(Account.user_id == user_id).order_by(Account.created_at.desc())
        ).scalars().all()
        return [serialize_account(a) for a in rows]
    finally:
        session.close()


def get_account(*, account_id: uuid.UUID) -> Optional[Account]:
    """Load an account by id (ownership is checked by the caller via ensure_owner)."""
    session = db.app_session()
    try:
        return session.get(Account, account_id)
    finally:
        session.close()


def get_account_transactions(
    *,
    account_id: uuid.UUID,
    page: int,
    type_filter: Optional[str] = None,
    date_from: Optional[datetime] = None,
    date_to_excl: Optional[datetime] = None,
    amount_min: Optional[int] = None,
    amount_max: Optional[int] = None,
) -> dict[str, Any]:
    """Return a paginated, filtered transaction history for an account (FR-03).

    Includes transactions where the account is source (debit) or destination
    (credit). 25 per page, newest first; counterparties resolved in batch to avoid
    N+1 (NFR-01). Ownership is the caller's responsibility (ensure_owner).
    """
    page_size = Config.TRANSACTION_HISTORY_PAGE_SIZE
    page = max(page, 1)

    def _filters():
        conds = [
            or_(
                Transaction.source_account_id == account_id,
                Transaction.destination_account_id == account_id,
            )
        ]
        if type_filter is not None:
            conds.append(Transaction.transaction_type == type_filter)
        if date_from is not None:
            conds.append(Transaction.created_at >= date_from)
        if date_to_excl is not None:
            conds.append(Transaction.created_at < date_to_excl)
        if amount_min is not None:
            conds.append(Transaction.amount_cents >= amount_min)
        if amount_max is not None:
            conds.append(Transaction.amount_cents <= amount_max)
        return conds

    session = db.app_session()
    try:
        total = int(
            session.execute(
                select(func.count()).select_from(Transaction).where(*_filters())
            ).scalar_one()
        )
        txns = session.execute(
            select(Transaction)
            .where(*_filters())
            .order_by(Transaction.created_at.desc())
            .limit(page_size)
            .offset((page - 1) * page_size)
        ).scalars().all()

        # Batch-resolve counterparties (other accounts + billers).
        other_account_ids = set()
        biller_ids = set()
        for t in txns:
            if t.transaction_type == "bill_payment" and t.biller_id is not None:
                biller_ids.add(t.biller_id)
            elif t.source_account_id == account_id and t.destination_account_id is not None:
                other_account_ids.add(t.destination_account_id)
            elif t.destination_account_id == account_id:
                other_account_ids.add(t.source_account_id)

        acct_map: dict[uuid.UUID, str] = {}
        if other_account_ids:
            acct_map = {
                a.account_id: a.account_number
                for a in session.execute(
                    select(Account).where(Account.account_id.in_(other_account_ids))
                ).scalars()
            }
        biller_map: dict[uuid.UUID, str] = {}
        if biller_ids:
            biller_map = {
                b.biller_id: b.biller_name
                for b in session.execute(
                    select(Biller).where(Biller.biller_id.in_(biller_ids))
                ).scalars()
            }

        items = []
        for t in txns:
            if t.source_account_id == account_id:
                direction = "debit"
                if t.transaction_type == "bill_payment":
                    counterparty = biller_map.get(t.biller_id, "biller")
                elif t.destination_account_id is not None:
                    counterparty = acct_map.get(t.destination_account_id)
                else:
                    counterparty = t.destination_external_ref
            else:
                direction = "credit"
                counterparty = acct_map.get(t.source_account_id)
            items.append({
                "transaction_id": str(t.transaction_id),
                "reference_number": t.reference_number,
                "transaction_type": t.transaction_type,
                "status": t.status,
                "amount_cents": t.amount_cents,
                "direction": direction,
                "counterparty": counterparty,
                "timestamp": (t.completed_at or t.created_at).isoformat(),
            })
    finally:
        session.close()

    return {
        "items": items,
        "page": page,
        "page_size": page_size,
        "total": total,
        "total_pages": ceil(total / page_size) if total else 0,
    }


def close_account(*, user_id: uuid.UUID, account_id: uuid.UUID, totp_code: str,
                  source_ip: str) -> dict[str, Any]:
    """Close one of the user's accounts (FR-05).

    Requires a zero balance and a **fresh TOTP step-up** (SR-11). The account row
    is locked ``FOR UPDATE`` while checked. Failed step-ups are rate-limited and
    count toward the lockout (SR-09). Audited.
    """
    totp_code = validate_totp_code(totp_code)
    key = current_app.extensions["securebank_config"].aes_encryption_key

    session = db.app_session()
    try:
        account = session.execute(
            select(Account).where(Account.account_id == account_id).with_for_update()
        ).scalar_one_or_none()
        if account is None or account.user_id != user_id or account.status != "active":
            session.rollback()
            raise AccountNotOpen()
        if account.balance_cents != 0:
            session.rollback()
            emit_audit("ACCOUNT_CLOSE", "failure", source_ip=source_ip, actor_user_id=user_id,
                       target_user_id=user_id, action_detail={"reason": "non_zero_balance",
                                                              "account_id": str(account_id)})
            raise NonZeroBalance()

        user = session.get(User, user_id)
        lockout.clear_expired_lock(user)
        if lockout.is_account_locked(user):
            session.commit()
            emit_audit("ACCOUNT_CLOSE", "denied", source_ip=source_ip, actor_user_id=user_id,
                       target_user_id=user_id, action_detail={"reason": "locked"})
            raise StepUpFailed()
        if lockout.is_totp_rate_limited(session, user_id):
            session.commit()
            emit_audit("ACCOUNT_CLOSE", "denied", source_ip=source_ip, actor_user_id=user_id,
                       target_user_id=user_id, action_detail={"reason": "totp_rate_limited"})
            raise StepUpRateLimited()
        lockout.record_auth_attempt(session, user_id, "totp")
        if not verify_totp(user.totp_seed_encrypted, totp_code, key):
            lockout.register_failed_auth(user)
            session.commit()
            emit_audit("ACCOUNT_CLOSE", "failure", source_ip=source_ip, actor_user_id=user_id,
                       target_user_id=user_id, action_detail={"reason": "bad_totp"})
            raise StepUpFailed()

        account.status = "closed"
        account.closed_at = datetime.now(timezone.utc)
        lockout.reset_failed_auth(user)
        session.commit()
        result = serialize_account(account)
    except AccountActionError:
        raise
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()

    emit_audit("ACCOUNT_CLOSE", "success", source_ip=source_ip, actor_user_id=user_id,
               actor_role="customer", target_user_id=user_id,
               action_detail={"account_id": str(account_id)})
    return result
