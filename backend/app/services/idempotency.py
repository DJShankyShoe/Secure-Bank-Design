"""Idempotency / replay protection for transfers & bill payments (SR-08).

The client sends a UUIDv4 ``Idempotency-Key`` header. We store the key + a
SHA-256 of the canonical request body + the original response for >= 24 h. A retry
with the same key and body replays the stored response without re-executing; a
same key with a *different* body is a conflict (409).

Correctness note: the ``IdempotencyRecord`` insert happens **inside the same DB
transaction** as the money movement (the caller adds :func:`make_record` to that
session). Because ``idempotency_key`` is the PK, two concurrent requests with the
same key cannot both commit — the loser's whole transaction rolls back, so the
operation never executes twice.
"""

from __future__ import annotations

import hashlib
import json
import uuid
from datetime import datetime, timezone
from typing import Any, Mapping, Optional

from sqlalchemy.orm import Session

from ..config import Config
from ..models import IdempotencyRecord
from ..security.validation import ValidationError


class IdempotencyConflict(Exception):
    """Raised when a key is reused with a different request body (→ 409)."""


def parse_idempotency_key(raw: Optional[str]) -> uuid.UUID:
    """Validate the Idempotency-Key header as a UUID (SR-06/08)."""
    if not raw:
        raise ValidationError("Idempotency-Key header is required.")
    try:
        return uuid.UUID(raw)
    except (ValueError, AttributeError):
        raise ValidationError("Idempotency-Key must be a UUID.") from None


def compute_request_hash(body: Mapping[str, Any]) -> str:
    """SHA-256 (hex) of the canonical JSON body — order-independent."""
    canonical = json.dumps(body, sort_keys=True, separators=(",", ":"), default=str)
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def get_record(session: Session, key: uuid.UUID) -> Optional[IdempotencyRecord]:
    """Return the stored idempotency record for ``key``, or ``None``."""
    return session.get(IdempotencyRecord, key)


def replay_or_conflict(
    session: Session, key: uuid.UUID, request_hash: str
) -> Optional[dict[str, Any]]:
    """Return the stored response to replay, or raise on conflict, or ``None``.

    ``None`` means the key is new → the caller should execute and then persist a
    record via :func:`make_record`.
    """
    record = get_record(session, key)
    if record is None:
        return None
    if record.request_hash != request_hash:
        raise IdempotencyConflict()
    return record.response_payload


def make_record(
    key: uuid.UUID, user_id: uuid.UUID, request_hash: str, response_payload: dict[str, Any]
) -> IdempotencyRecord:
    """Build an IdempotencyRecord (24-h TTL) for the caller to add to its txn."""
    now = datetime.now(timezone.utc)
    return IdempotencyRecord(
        idempotency_key=key,
        user_id=user_id,
        request_hash=request_hash,
        response_payload=response_payload,
        created_at=now,
        expires_at=now + Config.IDEMPOTENCY_TTL,
    )
