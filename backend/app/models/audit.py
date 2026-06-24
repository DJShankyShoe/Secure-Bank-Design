"""``audit`` schema model (SR-14).

Append-only event log. Written ONLY via the ``audit_writer`` engine (INSERT-only)
and read ONLY via ``admin_reader`` (SELECT-only) — the privilege boundary is
enforced in PostgreSQL (see ``backend/sql/05_grants.sql``). All identifiers are
SOFT references (no FK) so an audit write can never fail on a constraint and
survives user deletion. NRIC/PII is masked before it reaches ``action_detail``.
"""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any, Optional

from sqlalchemy import CheckConstraint, DateTime, String, Uuid, func
from sqlalchemy.dialects.postgresql import INET, JSONB
from sqlalchemy.orm import Mapped, mapped_column

from .base import Base


class AuditEvent(Base):
    """A single audited event (SR-14).

    Records UTC timestamp, actor (NULL if unauthenticated), optional target,
    real client source IP (from trusted X-Forwarded-For), a masked
    ``action_detail`` payload, and the outcome (success/failure/denied).
    """

    __tablename__ = "audit_events"
    __table_args__ = (
        CheckConstraint(
            "outcome IN ('success','failure','denied')", name="audit_events_outcome_check"
        ),
        {"schema": "audit"},
    )

    event_id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    event_timestamp: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    event_type: Mapped[str] = mapped_column(String(64), nullable=False)
    actor_user_id: Mapped[Optional[uuid.UUID]] = mapped_column(Uuid)  # soft ref, no FK
    actor_role: Mapped[Optional[str]] = mapped_column(String(16))
    target_user_id: Mapped[Optional[uuid.UUID]] = mapped_column(Uuid)  # soft ref, no FK
    source_ip: Mapped[str] = mapped_column(INET, nullable=False)
    action_detail: Mapped[Optional[dict[str, Any]]] = mapped_column(JSONB)
    outcome: Mapped[str] = mapped_column(String(16), nullable=False)
