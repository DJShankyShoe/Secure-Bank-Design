"""Account HTTP routes (FR-02/03). All behind @require_authenticated; per-account
views enforce ownership via ensure_owner (IDOR → 404)."""

from __future__ import annotations

import uuid
from datetime import date, datetime, time, timedelta, timezone

from flask import abort, g, jsonify, request

from ...security.decorators import ensure_owner, require_authenticated
from ...security.validation import ValidationError
from ...services.audit import client_ip
from . import bp
from .service import (
    AccountActionError,
    create_account,
    get_account,
    get_account_transactions,
    list_accounts,
    request_account_closure,
    serialize_account,
)


def _parse_history_filters(args) -> dict:
    """Validate transaction-history query params (SR-06); raise ValidationError."""
    out: dict = {}

    page_raw = args.get("page", "1")
    try:
        page = int(page_raw)
    except ValueError:
        raise ValidationError("page must be an integer.") from None
    if page < 1:
        raise ValidationError("page must be >= 1.")
    out["page"] = page

    type_filter = args.get("type")
    if type_filter is not None:
        if type_filter not in ("transfer", "bill_payment"):
            raise ValidationError("type must be 'transfer' or 'bill_payment'.")
        out["type_filter"] = type_filter

    def _day(name: str):
        raw = args.get(name)
        if raw is None:
            return None
        try:
            return date.fromisoformat(raw)
        except ValueError:
            raise ValidationError(f"{name} must be an ISO date (YYYY-MM-DD).") from None

    d_from = _day("date_from")
    d_to = _day("date_to")
    if d_from is not None:
        out["date_from"] = datetime.combine(d_from, time.min, tzinfo=timezone.utc)
    if d_to is not None:  # inclusive end-of-day -> exclusive next-day boundary
        start = datetime.combine(d_to, time.min, tzinfo=timezone.utc)
        out["date_to_excl"] = start + timedelta(days=1)

    def _amount(name: str):
        raw = args.get(name)
        if raw is None:
            return None
        try:
            val = int(raw)
        except ValueError:
            raise ValidationError(f"{name} must be an integer (cents).") from None
        if val < 0:
            raise ValidationError(f"{name} must be >= 0.")
        return val

    a_min = _amount("amount_min")
    a_max = _amount("amount_max")
    if a_min is not None:
        out["amount_min"] = a_min
    if a_max is not None:
        out["amount_max"] = a_max
    return out


def _json() -> dict:
    data = request.get_json(silent=True)
    return data if isinstance(data, dict) else {}


@bp.post("")
@require_authenticated
def create():
    """Create a savings/current account for the current user (FR-02).

    Body: ``account_type``. Returns 201 with the new account (unique 10-digit
    number, balance 0). Audited.
    """
    body = _json()
    try:
        account = create_account(
            user_id=g.user_id,
            account_type=body.get("account_type", ""),
            source_ip=client_ip(),
        )
    except ValidationError as exc:
        return jsonify(error=exc.message), 400
    return jsonify(account), 201


@bp.get("")
@require_authenticated
def list_own():
    """List the current user's accounts (FR-03)."""
    return jsonify(accounts=list_accounts(user_id=g.user_id)), 200


@bp.get("/<account_id>")
@require_authenticated
def view(account_id: str):
    """View one of the current user's accounts (FR-03); 404 if not owned (IDOR)."""
    try:
        parsed = uuid.UUID(account_id)
    except ValueError:
        abort(404)
    account = get_account(account_id=parsed)
    if account is None:
        abort(404)
    ensure_owner(account.user_id)  # 404 if it belongs to someone else
    return jsonify(serialize_account(account)), 200


@bp.get("/<account_id>/transactions")
@require_authenticated
def history(account_id: str):
    """Paginated, filtered transaction history for one of the user's accounts (FR-03).

    Query params: ``page``, ``type``, ``date_from``/``date_to`` (YYYY-MM-DD,
    interpreted as **UTC** calendar days; ``date_to`` is inclusive),
    ``amount_min``/``amount_max`` (cents). 25 per page. 404 if not owned (IDOR).
    """
    try:
        parsed = uuid.UUID(account_id)
    except ValueError:
        abort(404)
    account = get_account(account_id=parsed)
    if account is None:
        abort(404)
    ensure_owner(account.user_id)

    try:
        filters = _parse_history_filters(request.args)
    except ValidationError as exc:
        return jsonify(error=exc.message), 400
    return jsonify(get_account_transactions(account_id=parsed, **filters)), 200


@bp.post("/<account_id>/close")
@require_authenticated
def close(account_id: str):
    """Request closure of one of the user's accounts (FR-05).

    Body: ``totp_code``. Requires a zero balance and a fresh TOTP step-up. This does
    NOT close the account immediately — it moves it to ``close_requested`` (which
    freezes transfers) pending an admin approve/reject. Returns 200 with the account
    (``status: close_requested``); 404 if not owned (IDOR).
    """
    try:
        parsed = uuid.UUID(account_id)
    except ValueError:
        abort(404)
    account = get_account(account_id=parsed)
    if account is None:
        abort(404)
    ensure_owner(account.user_id)

    body = _json()
    try:
        result = request_account_closure(user_id=g.user_id, account_id=parsed,
                                         totp_code=body.get("totp_code", ""),
                                         source_ip=client_ip())
    except ValidationError as exc:
        return jsonify(error=exc.message), 400
    except AccountActionError as exc:
        return jsonify(error=exc.message), exc.status
    return jsonify(result), 200
