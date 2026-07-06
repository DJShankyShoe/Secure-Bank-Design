"""``session`` schema models.

All shared, load-balancer-safe state (NFR-04): server-side sessions (SR-13),
idempotency records (SR-08), and per-account auth attempt windows (SR-11/12).
``user_id`` columns are real cross-schema FKs to ``application.users``.
"""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any, Optional

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    DateTime,
    ForeignKey,
    String,
    Uuid,
    func,
    text,
)
from sqlalchemy.dialects.postgresql import INET, JSONB
from sqlalchemy.orm import Mapped, mapped_column

from .base import Base


class SessionRecord(Base):
    """A server-side session (SR-13).

    ``session_id`` is an opaque random token (``secrets.token_urlsafe``). Validity
    is 15-min idle (``last_active_at``) and 8-h absolute (``absolute_expiry``);
    ``revoked`` flips TRUE on logout / privilege change. Cookie carries only the id.
    """

    __tablename__ = "sessions"
    __table_args__ = ({"schema": "session"},)

    session_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("application.users.user_id"), nullable=False
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    last_active_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    absolute_expiry: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    source_ip: Mapped[str] = mapped_column(INET, nullable=False)
    revoked: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default=text("false")
    )


class IdempotencyRecord(Base):
    """A stored transfer/bill-payment outcome for replay protection (SR-08).

    ``request_hash`` (SHA-256 of the canonical body) detects conflicting reuse of
    a key (→409). ``response_payload`` is replayed verbatim on a matching retry.
    24-h TTL via ``expires_at``; pruned on a schedule.
    """

    __tablename__ = "idempotency_records"
    __table_args__ = ({"schema": "session"},)

    idempotency_key: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True)
    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("application.users.user_id"), nullable=False
    )
    request_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    response_payload: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)


class AuthAttempt(Base):
    """One rate-limited attempt for sliding-window throttles (SR-11/12, FR-10).

    Distinct from ``users.failed_login_count`` (the SR-09 consecutive lockout):
    rows here are COUNTed within a window — TOTP 5/min, PIN 3/txn (keyed by
    ``transaction_ref``) and 5/hour, ``email`` sends 10/hour, and in-session
    ``password`` re-verify 5/30-min — then pruned. All are feature-only.
    """

    __tablename__ = "auth_attempts"
    __table_args__ = (
        CheckConstraint(
            "attempt_type IN ('totp','pin','email','password')",
            name="auth_attempts_attempt_type_check",
        ),
        {"schema": "session"},
    )

    attempt_id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("application.users.user_id"), nullable=False
    )
    attempt_type: Mapped[str] = mapped_column(String(16), nullable=False)
    occurred_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    transaction_ref: Mapped[Optional[str]] = mapped_column(String(32))
