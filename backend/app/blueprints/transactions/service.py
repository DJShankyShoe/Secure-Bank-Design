"""Fund-transfer + transaction-PIN domain logic (FR-06, SR-08/12-10.3).

Money moves in one atomic DB transaction: the involved account rows are locked
``FOR UPDATE`` (in account-number order to avoid deadlocks), the balance is
re-checked inside the lock, source is debited and destination credited, and the
transaction + idempotency records are inserted together — so a concurrent retry
with the same Idempotency-Key cannot double-execute (the PK insert conflicts and
the whole txn rolls back). Transfers >= SGD 1,000 require a valid transaction PIN
(Argon2id, distinct params); PIN attempts are rate-limited (3/txn + 5/hr → "try
again later") but are feature-only and do NOT feed the SR-09 account lockout
(decided 2026-07-06). Every outcome is audited; the sender is emailed a receipt.
"""

from __future__ import annotations

import secrets
import uuid
from datetime import datetime, timezone
from typing import Any, Optional

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

from ...config import Config
from ...extensions import db
from ...models import Account, Biller, Transaction, User
from ...security import crypto, lockout
from ...security.validation import (
    validate_account_number,
    validate_amount_cents,
    validate_transaction_pin,
)
from ...services.audit import emit_audit
from ...services.email import format_sgd, notify_user, render_email
from ...services.idempotency import (
    compute_request_hash,
    make_record,
    replay_or_conflict,
)


class TxnError(Exception):
    status = 400
    message = "Transaction could not be processed."


class InsufficientFunds(TxnError):
    status = 400
    message = "Insufficient funds."


class AccountNotFound(TxnError):
    status = 404
    message = "Account not found."


class InvalidDestination(TxnError):
    status = 400
    message = "Destination account is invalid."


class PinRequired(TxnError):
    status = 403
    message = "Transaction PIN required for this amount."


class InvalidPin(TxnError):
    status = 401
    message = "Invalid PIN."


class CurrentPasswordWrong(TxnError):
    # Distinct from InvalidPin: this is the current-password re-verify gate on
    # PIN *replace* (set_transaction_pin), not the PIN itself. Matches the same
    # "current password is incorrect" message used by the equivalent re-verify
    # checks in login_service.change_password / email_service.request_email_change
    # -- there is no enumeration concern here (the caller is already
    # authenticated as this exact account), so unlike login there's no reason
    # to blur which factor failed.
    status = 401
    message = "Current password is incorrect."


class TxnRateLimited(TxnError):
    status = 429
    message = "Too many attempts. Please try again later."


class InvalidBiller(TxnError):
    status = 400
    message = "Biller is invalid."


def _now() -> datetime:
    return datetime.now(timezone.utc)


def generate_reference_number() -> str:
    """Return a unique, high-entropy transaction reference (<=32 chars)."""
    return "TXN" + secrets.token_hex(12).upper()


# --------------------------------------------------------------------------- #
# Transaction PIN (SR-12)
# --------------------------------------------------------------------------- #

def set_transaction_pin(*, user_id: uuid.UUID, password: str, pin: str, source_ip: str) -> None:
    """Set or replace the 6-digit transaction PIN (SR-12).

    First-time setup (no PIN exists yet) does NOT require the password: the caller
    is already authenticated and there is no money-moving credential to protect
    (decided 2026-07-05). **Replacing** an existing PIN still re-verifies the
    password, so a hijacked/unattended session cannot silently swap the PIN that
    guards high-value transfers. A wrong current password raises
    CurrentPasswordWrong (distinct from InvalidPin, which is reserved for the
    new PIN failing format validation) -- matching the equivalent re-verify
    checks elsewhere (change_password, request_email_change). No enumeration
    concern here since the caller is already authenticated as this account.
    """
    pin = validate_transaction_pin(pin)
    session = db.app_session()
    try:
        user = session.get(User, user_id)
        if user is None:
            raise InvalidPin()
        replacing = user.transaction_pin_hash is not None
        # Re-authenticate only when replacing an existing PIN.
        if replacing:
            # In-session password-guessing friction (FR-10): too many wrong current-
            # password entries temporarily lock this feature only (never the account).
            if lockout.is_password_reverify_rate_limited(session, user_id):
                session.commit()  # persist any just-recorded attempt
                emit_audit("PIN_SET", "denied", source_ip=source_ip,
                           actor_user_id=user_id, target_user_id=user_id,
                           action_detail={"reason": "reverify_rate_limited"})
                raise TxnRateLimited()
            if not crypto.verify_password(user.password_hash, password or ""):
                lockout.record_auth_attempt(session, user_id, "password")
                session.commit()
                emit_audit("PIN_SET", "failure", source_ip=source_ip,
                           actor_user_id=user_id, target_user_id=user_id,
                           action_detail={"reason": "bad_password"})
                raise CurrentPasswordWrong()
        user.transaction_pin_hash = crypto.hash_pin(pin)
        session.commit()
    finally:
        session.close()
    emit_audit("PIN_SET", "success", source_ip=source_ip,
               actor_user_id=user_id, actor_role="customer", target_user_id=user_id,
               action_detail={"first_time": not replacing})


def is_transaction_pin_set(*, user_id: uuid.UUID) -> bool:
    """Return True if the user has a transaction PIN set (SR-12).

    Exposes only a boolean — never the PIN or its hash — so the SPA can decide
    whether to prompt for PIN setup / show the PIN field on high-value transfers.
    """
    session = db.app_session()
    try:
        user = session.get(User, user_id)
        return user is not None and user.transaction_pin_hash is not None
    finally:
        session.close()


def _verify_pin_for_transfer(*, user_id: uuid.UUID, pin: str, txn_ref: str, source_ip: str) -> None:
    """Verify the PIN for a high-value transfer with attempt limits (SR-12).

    Runs in its own committed transaction so a failed attempt (its rate-limit row)
    persists even though the money transaction never starts. PIN failures throttle
    high-value transfers (3/txn + 5/hr) but do NOT lock the account (feature-only).
    """
    session = db.app_session()
    try:
        user = session.get(User, user_id)
        if user is None:
            raise InvalidPin()
        lockout.clear_expired_lock(user)
        if lockout.is_account_locked(user):
            session.commit()
            emit_audit("PIN_VERIFY", "denied", source_ip=source_ip, actor_user_id=user_id,
                       target_user_id=user_id, action_detail={"reason": "locked"})
            raise InvalidPin()
        if user.transaction_pin_hash is None:
            emit_audit("PIN_VERIFY", "denied", source_ip=source_ip, actor_user_id=user_id,
                       target_user_id=user_id, action_detail={"reason": "no_pin_set"})
            raise PinRequired()
        if lockout.is_pin_rate_limited(session, user_id, txn_ref):
            session.commit()
            emit_audit("PIN_VERIFY", "denied", source_ip=source_ip, actor_user_id=user_id,
                       target_user_id=user_id, action_detail={"reason": "rate_limited"})
            raise TxnRateLimited()
        lockout.record_auth_attempt(session, user_id, "pin", transaction_ref=txn_ref)
        if not crypto.verify_pin(user.transaction_pin_hash, pin or ""):
            # Feature-only throttle (decided 2026-07-06): a wrong PIN counts toward
            # the 3/txn + 5/hr PIN windows above (→ "try again later") but NOT toward
            # the SR-09 account lockout — so it can never lock the user out of login.
            session.commit()
            emit_audit("PIN_VERIFY", "failure", source_ip=source_ip, actor_user_id=user_id,
                       target_user_id=user_id)
            raise InvalidPin()
        session.commit()
    finally:
        session.close()


# --------------------------------------------------------------------------- #
# Transfer (FR-06)
# --------------------------------------------------------------------------- #

def _build_receipt(txn: Transaction, source_number: str, dest_number: Optional[str],
                   external_ref: Optional[str]) -> dict[str, Any]:
    return {
        "transaction_id": str(txn.transaction_id),
        "reference_number": txn.reference_number,
        "status": txn.status,
        "transaction_type": txn.transaction_type,
        "amount_cents": txn.amount_cents,
        "source_account_number": source_number,
        "destination_account_number": dest_number,
        "destination_external_ref": external_ref,
        "pin_verified": txn.pin_verified,
        "completed_at": txn.completed_at.isoformat() if txn.completed_at else None,
    }


def transfer(
    *,
    user_id: uuid.UUID,
    source_account_number: str,
    destination_account_number: Optional[str],
    destination_external_ref: Optional[str],
    amount_cents: Any,
    pin: Optional[str],
    idempotency_key: uuid.UUID,
    source_ip: str,
) -> dict[str, Any]:
    """Execute a fund transfer (FR-06). Returns the receipt; idempotent per key."""
    source_account_number = validate_account_number(source_account_number)
    amount_cents = validate_amount_cents(amount_cents)
    internal = bool(destination_account_number)
    if internal == bool(destination_external_ref):
        raise InvalidDestination()  # exactly one destination required
    if internal:
        destination_account_number = validate_account_number(destination_account_number)
    else:
        if not isinstance(destination_external_ref, str) or len(destination_external_ref) > 255:
            raise InvalidDestination()

    request_hash = compute_request_hash({
        "type": "transfer",
        "source": source_account_number,
        "dest": destination_account_number,
        "external": destination_external_ref,
        "amount_cents": amount_cents,
    })

    # 1) Replay short-circuit (no PIN re-prompt, no re-execution) — SR-08.
    probe = db.app_session()
    try:
        replay = replay_or_conflict(probe, idempotency_key, request_hash, user_id)
        if replay is not None:
            return replay
    finally:
        probe.close()

    # 2) PIN step-up for high-value transfers — SR-12.
    pin_verified = False
    if amount_cents >= Config.PIN_THRESHOLD_CENTS:
        if not pin:
            emit_audit("TRANSFER", "denied", source_ip=source_ip, actor_user_id=user_id,
                       target_user_id=user_id, action_detail={"reason": "pin_required"})
            raise PinRequired()
        _verify_pin_for_transfer(user_id=user_id, pin=pin,
                                 txn_ref=idempotency_key.hex, source_ip=source_ip)
        pin_verified = True

    # 3) Atomic money movement —.
    session = db.app_session()
    try:
        numbers = sorted({source_account_number, destination_account_number}) if internal \
            else [source_account_number]
        locked: dict[str, Optional[Account]] = {}
        for number in numbers:  # lock in deterministic order to avoid deadlock
            locked[number] = session.execute(
                select(Account).where(Account.account_number == number).with_for_update()
            ).scalar_one_or_none()

        source = locked[source_account_number]
        if source is None or source.user_id != user_id:
            session.rollback()
            emit_audit("TRANSFER", "failure", source_ip=source_ip, actor_user_id=user_id,
                       target_user_id=user_id, action_detail={"reason": "source_not_found"})
            raise AccountNotFound()
        if source.status != "active":
            session.rollback()
            raise InvalidDestination()

        dest: Optional[Account] = None
        if internal:
            dest = locked[destination_account_number]
            if dest is None or dest.status != "active":
                session.rollback()
                raise InvalidDestination()
            if dest.account_id == source.account_id:
                session.rollback()
                raise InvalidDestination()

        if source.balance_cents < amount_cents:  # re-check inside the lock
            session.rollback()
            emit_audit("TRANSFER", "failure", source_ip=source_ip, actor_user_id=user_id,
                       target_user_id=user_id, action_detail={"reason": "insufficient_funds"})
            raise InsufficientFunds()

        source.balance_cents -= amount_cents
        if dest is not None:
            dest.balance_cents += amount_cents

        txn = Transaction(
            source_account_id=source.account_id,
            destination_account_id=dest.account_id if dest is not None else None,
            destination_external_ref=destination_external_ref,
            amount_cents=amount_cents,
            transaction_type="transfer",
            status="complete",
            reference_number=generate_reference_number(),
            idempotency_key=idempotency_key,
            pin_verified=pin_verified,
            completed_at=_now(),
        )
        session.add(txn)
        session.flush()
        receipt = _build_receipt(txn, source_account_number, destination_account_number,
                                 destination_external_ref)
        session.add(make_record(idempotency_key, user_id, request_hash, receipt))
        session.commit()
    except IntegrityError:
        session.rollback()
        # Concurrent duplicate key won the race -> replay its stored result.
        retry = db.app_session()
        try:
            replay = replay_or_conflict(retry, idempotency_key, request_hash, user_id)
        finally:
            retry.close()
        if replay is not None:
            return replay
        raise
    except TxnError:
        raise
    finally:
        session.close()

    emit_audit("TRANSFER", "success", source_ip=source_ip, actor_user_id=user_id,
               actor_role="customer", target_user_id=user_id,
               action_detail={"reference_number": receipt["reference_number"],
                              "amount_cents": amount_cents, "pin_verified": pin_verified})
    notify_user(user_id=user_id, pref_attr="notify_on_transfer",
                subject="SecureBank transfer receipt",
                body=render_email("transfer_receipt.txt", amount=format_sgd(amount_cents),
                                  reference_number=receipt["reference_number"]))
    return receipt


# --------------------------------------------------------------------------- #
# Bill payment (FR-07)
# --------------------------------------------------------------------------- #

def list_billers() -> list[dict[str, Any]]:
    """Return the active, allowlisted billers customers may pay (FR-07)."""
    session = db.app_session()
    try:
        rows = session.execute(
            select(Biller).where(Biller.active.is_(True)).order_by(Biller.biller_name)
        ).scalars().all()
        return [
            {"biller_id": str(b.biller_id), "biller_name": b.biller_name,
             "biller_category": b.biller_category}
            for b in rows
        ]
    finally:
        session.close()


def _parse_biller_id(raw: Any) -> uuid.UUID:
    try:
        return uuid.UUID(str(raw))
    except (ValueError, AttributeError, TypeError):
        raise InvalidBiller() from None


def bill_payment(
    *,
    user_id: uuid.UUID,
    source_account_number: str,
    biller_id: Any,
    amount_cents: Any,
    idempotency_key: uuid.UUID,
    source_ip: str,
) -> dict[str, Any]:
    """Pay an allowlisted biller from one of the user's accounts (FR-07).

    Validates the biller against the catalogue (the allowlist), checks the balance
    **before** execution, and debits atomically so there is **no partial state** on
    failure. Idempotent per key; sends a confirmation email and audits.
    """
    source_account_number = validate_account_number(source_account_number)
    amount_cents = validate_amount_cents(amount_cents)
    biller_uuid = _parse_biller_id(biller_id)

    request_hash = compute_request_hash({
        "type": "bill_payment",
        "source": source_account_number,
        "biller": str(biller_uuid),
        "amount_cents": amount_cents,
    })

    probe = db.app_session()
    try:
        replay = replay_or_conflict(probe, idempotency_key, request_hash, user_id)
        if replay is not None:
            return replay
    finally:
        probe.close()

    session = db.app_session()
    try:
        source = session.execute(
            select(Account).where(Account.account_number == source_account_number).with_for_update()
        ).scalar_one_or_none()
        if source is None or source.user_id != user_id:
            session.rollback()
            emit_audit("BILL_PAYMENT", "failure", source_ip=source_ip, actor_user_id=user_id,
                       target_user_id=user_id, action_detail={"reason": "source_not_found"})
            raise AccountNotFound()
        if source.status != "active":
            session.rollback()
            raise InvalidDestination()

        biller = session.get(Biller, biller_uuid)
        if biller is None or not biller.active:
            session.rollback()
            emit_audit("BILL_PAYMENT", "failure", source_ip=source_ip, actor_user_id=user_id,
                       target_user_id=user_id, action_detail={"reason": "invalid_biller"})
            raise InvalidBiller()

        if source.balance_cents < amount_cents:  # validate funds BEFORE execution (FR-07)
            session.rollback()
            emit_audit("BILL_PAYMENT", "failure", source_ip=source_ip, actor_user_id=user_id,
                       target_user_id=user_id, action_detail={"reason": "insufficient_funds"})
            raise InsufficientFunds()

        source.balance_cents -= amount_cents
        txn = Transaction(
            source_account_id=source.account_id,
            biller_id=biller.biller_id,
            amount_cents=amount_cents,
            transaction_type="bill_payment",
            status="complete",
            reference_number=generate_reference_number(),
            idempotency_key=idempotency_key,
            pin_verified=False,
            completed_at=_now(),
        )
        session.add(txn)
        session.flush()
        receipt = {
            "transaction_id": str(txn.transaction_id),
            "reference_number": txn.reference_number,
            "status": txn.status,
            "transaction_type": "bill_payment",
            "amount_cents": amount_cents,
            "source_account_number": source_account_number,
            "biller_id": str(biller.biller_id),
            "biller_name": biller.biller_name,
            "completed_at": txn.completed_at.isoformat() if txn.completed_at else None,
        }
        session.add(make_record(idempotency_key, user_id, request_hash, receipt))
        session.commit()
        biller_name = biller.biller_name
    except IntegrityError:
        session.rollback()
        retry = db.app_session()
        try:
            replay = replay_or_conflict(retry, idempotency_key, request_hash, user_id)
        finally:
            retry.close()
        if replay is not None:
            return replay
        raise
    except TxnError:
        raise
    finally:
        session.close()

    emit_audit("BILL_PAYMENT", "success", source_ip=source_ip, actor_user_id=user_id,
               actor_role="customer", target_user_id=user_id,
               action_detail={"reference_number": receipt["reference_number"],
                              "amount_cents": amount_cents, "biller_id": receipt["biller_id"]})
    notify_user(user_id=user_id, pref_attr="notify_on_transfer",
                subject="SecureBank bill payment receipt",
                body=render_email("bill_payment_receipt.txt", amount=format_sgd(amount_cents),
                                  biller_name=biller_name,
                                  reference_number=receipt["reference_number"]))
    return receipt
