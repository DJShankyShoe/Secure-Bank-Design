"""Transaction HTTP routes (FR-06). Behind @require_authenticated; transfers carry
an Idempotency-Key header (SR-08) and use the generic error shape."""

from __future__ import annotations

from flask import g, jsonify, request

from ...security.decorators import require_authenticated
from ...security.validation import ValidationError
from ...services.audit import client_ip
from ...services.idempotency import IdempotencyConflict, parse_idempotency_key
from . import bp
from .service import (
    TxnError,
    bill_payment,
    list_billers,
    set_transaction_pin,
    transfer,
)


def _json() -> dict:
    data = request.get_json(silent=True)
    return data if isinstance(data, dict) else {}


@bp.post("/pin")
@require_authenticated
def set_pin():
    """Set/replace the transaction PIN (SR-12). Body: ``password``, ``pin``."""
    body = _json()
    try:
        set_transaction_pin(user_id=g.user_id, password=body.get("password", ""),
                            pin=body.get("pin", ""), source_ip=client_ip())
    except ValidationError as exc:
        return jsonify(error=exc.message), 400
    except TxnError as exc:
        return jsonify(error=exc.message), exc.status
    return jsonify(status="pin_set"), 200


@bp.post("/transfer")
@require_authenticated
def transfer_route():
    """Transfer funds (FR-06). Requires an ``Idempotency-Key`` header.

    Body: ``source_account_number``, one of ``destination_account_number`` /
    ``destination_external_ref``, ``amount_cents``, and ``pin`` for amounts
    >= SGD 1,000. Returns 201 with the receipt; replays on a repeated key.
    """
    body = _json()
    try:
        key = parse_idempotency_key(request.headers.get("Idempotency-Key"))
        receipt = transfer(
            user_id=g.user_id,
            source_account_number=body.get("source_account_number", ""),
            destination_account_number=body.get("destination_account_number") or None,
            destination_external_ref=body.get("destination_external_ref") or None,
            amount_cents=body.get("amount_cents"),
            pin=body.get("pin"),
            idempotency_key=key,
            source_ip=client_ip(),
        )
    except ValidationError as exc:
        return jsonify(error=exc.message), 400
    except IdempotencyConflict:
        return jsonify(error="Idempotency key reused with a different request."), 409
    except TxnError as exc:
        return jsonify(error=exc.message), exc.status
    return jsonify(receipt), 201


@bp.get("/billers")
@require_authenticated
def billers():
    """List active, allowlisted billers the user may pay (FR-07)."""
    return jsonify(billers=list_billers()), 200


@bp.post("/bill-payment")
@require_authenticated
def bill_payment_route():
    """Pay a registered biller (FR-07). Requires an ``Idempotency-Key`` header.

    Body: ``source_account_number``, ``biller_id``, ``amount_cents``. Returns 201
    with the receipt; replays on a repeated key.
    """
    body = _json()
    try:
        key = parse_idempotency_key(request.headers.get("Idempotency-Key"))
        receipt = bill_payment(
            user_id=g.user_id,
            source_account_number=body.get("source_account_number", ""),
            biller_id=body.get("biller_id"),
            amount_cents=body.get("amount_cents"),
            idempotency_key=key,
            source_ip=client_ip(),
        )
    except ValidationError as exc:
        return jsonify(error=exc.message), 400
    except IdempotencyConflict:
        return jsonify(error="Idempotency key reused with a different request."), 409
    except TxnError as exc:
        return jsonify(error=exc.message), exc.status
    return jsonify(receipt), 201
