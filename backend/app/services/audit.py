"""Structured audit emitter (SR-14).

Writes one ``audit.audit_events`` row via the **audit_writer** engine on its own
connection, committed **independently of the business transaction** — so a
rolled-back transfer still records its ``failure``/``denied`` event. The audit
schema is INSERT-only for this role (enforced in PostgreSQL), making the log
append-only. Callers MUST pass already-masked detail: NRIC/PII never goes in raw
(SR-03). Emit at the route-handler level so no business path can bypass logging.
"""

from __future__ import annotations

import logging
import uuid
from typing import Any, Optional

from flask import has_request_context, request
from sqlalchemy import insert

from ..extensions import db
from ..models import AuditEvent

_log = logging.getLogger(__name__)

_VALID_OUTCOMES = frozenset({"success", "failure", "denied"})


def client_ip() -> str:
    """Best-effort real client IP for the current request (SR-14).

    ProxyFix has already resolved ``remote_addr`` from the trusted
    ``X-Forwarded-For`` header. Falls back to ``0.0.0.0`` outside a request.
    """
    if has_request_context() and request.remote_addr:
        return request.remote_addr
    # "Unspecified address" sentinel for the INET NOT NULL column when there is no
    # request context (e.g. a background job); not a socket bind address.
    return "0.0.0.0"  # nosec B104


def emit_audit(
    event_type: str,
    outcome: str,
    *,
    source_ip: str,
    actor_user_id: Optional[uuid.UUID] = None,
    actor_role: Optional[str] = None,
    target_user_id: Optional[uuid.UUID] = None,
    action_detail: Optional[dict[str, Any]] = None,
) -> None:
    """Append one audit event (SR-14).

    Args:
        event_type: e.g. ``LOGIN_SUCCESS``, ``REGISTER``, ``ADMIN_SUSPEND_USER``.
        outcome: one of ``success`` | ``failure`` | ``denied``.
        source_ip: real client IP (use :func:`client_ip`).
        actor_user_id/actor_role: the acting principal (NULL if unauthenticated).
        target_user_id: the affected principal, if any.
        action_detail: a JSON-serialisable dict, **already masked** of PII.

    Raises:
        ValueError: if ``outcome`` is not an allowed value.
    The write uses its own committed transaction, independent of any caller
    transaction. Failures are logged and re-raised so an unaudited action never
    silently succeeds.
    """
    if outcome not in _VALID_OUTCOMES:
        raise ValueError(f"invalid audit outcome: {outcome!r}")

    stmt = insert(AuditEvent.__table__).values(
        event_id=uuid.uuid4(),
        event_type=event_type,
        actor_user_id=actor_user_id,
        actor_role=actor_role,
        target_user_id=target_user_id,
        source_ip=source_ip,
        action_detail=action_detail,
        outcome=outcome,
    )
    try:
        # Own connection + commit, independent of the business transaction.
        with db.audit_writer_engine.begin() as conn:
            conn.execute(stmt)
    except Exception:  # noqa: BLE001 - log without leaking, then re-raise
        _log.exception("audit emit failed for event_type=%s", event_type)
        raise
