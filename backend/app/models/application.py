"""``application`` schema models.

Business domain: users, accounts, transactions, billers, MFA backup codes,
contact preferences, pending email changes. UUID PKs are app-generated
(``uuid4``); money is integer minor units (``BIGINT *_cents``). Sensitive
columns are encrypted/hashed at the service layer before reaching these models
(SR-01/03/11/12); the ORM only persists the already-protected bytes/hashes.
"""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Optional

from sqlalchemy import (
    BigInteger,
    Boolean,
    CheckConstraint,
    DateTime,
    ForeignKey,
    Integer,
    LargeBinary,
    String,
    Uuid,
    func,
    text,
)
from sqlalchemy.orm import Mapped, mapped_column

from .base import Base


class User(Base):
    """A registered customer or admin (SR-01/03/09/11, FR-01/08).

    ``nric_encrypted`` / ``totp_seed_encrypted`` hold AES-256-GCM ciphertext;
    ``password_hash`` / ``transaction_pin_hash`` hold Argon2id hashes. ``role`` is
    re-checked server-side on every protected request (FR-08). ``account_status``
    distinguishes brute-force ``locked`` (SR-09) from admin ``suspended`` (FR-08).
    """

    __tablename__ = "users"
    __table_args__ = (
        CheckConstraint("role IN ('customer','admin')", name="users_role_check"),
        CheckConstraint(
            "account_status IN ('pending','active','locked','suspended','closed')",
            name="users_account_status_check",
        ),
        {"schema": "application"},
    )

    user_id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    email: Mapped[str] = mapped_column(String(254), unique=True, nullable=False)
    email_verified: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default=text("false")
    )
    full_name: Mapped[str] = mapped_column(String(120), nullable=False)
    nric_encrypted: Mapped[bytes] = mapped_column(LargeBinary, nullable=False)
    nric_masked: Mapped[str] = mapped_column(String(9), nullable=False)
    password_hash: Mapped[str] = mapped_column(String(255), nullable=False)
    totp_seed_encrypted: Mapped[Optional[bytes]] = mapped_column(LargeBinary)
    transaction_pin_hash: Mapped[Optional[str]] = mapped_column(String(255))
    role: Mapped[str] = mapped_column(String(16), nullable=False)
    account_status: Mapped[str] = mapped_column(
        String(16), nullable=False, server_default=text("'active'")
    )
    failed_login_count: Mapped[int] = mapped_column(
        Integer, nullable=False, server_default=text("0")
    )
    locked_until: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )


class Biller(Base):
    """An allowlisted bill-payment recipient (FR-07).

    The biller catalogue is the authoritative allowlist; ``endpoint_uri`` is set
    from config, never user input. Bill payments link here via a real FK.
    """

    __tablename__ = "billers"
    __table_args__ = (
        CheckConstraint(
            "biller_category IN ('utility','telco','credit_card')",
            name="billers_category_check",
        ),
        {"schema": "application"},
    )

    biller_id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    biller_name: Mapped[str] = mapped_column(String(120), nullable=False)
    biller_category: Mapped[str] = mapped_column(String(32), nullable=False)
    endpoint_uri: Mapped[str] = mapped_column(String(255), nullable=False)
    active: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default=text("true"))


class Account(Base):
    """A customer bank account (FR-02/03/05).

    ``user_id`` ownership is verified server-side on every read (SR-13).
    ``account_number`` is server-generated and unguessable. Closure requires a
    zero balance (enforced in service logic + the ``status`` CHECK).
    """

    __tablename__ = "accounts"
    __table_args__ = (
        CheckConstraint(
            "account_type IN ('savings','current')", name="accounts_type_check"
        ),
        CheckConstraint("balance_cents >= 0", name="accounts_balance_nonneg_check"),
        CheckConstraint("status IN ('active','closed')", name="accounts_status_check"),
        {"schema": "application"},
    )

    account_id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("application.users.user_id"), nullable=False
    )
    account_number: Mapped[str] = mapped_column(String(10), unique=True, nullable=False)
    account_type: Mapped[str] = mapped_column(String(16), nullable=False)
    balance_cents: Mapped[int] = mapped_column(
        BigInteger, nullable=False, server_default=text("0")
    )
    status: Mapped[str] = mapped_column(
        String(16), nullable=False, server_default=text("'active'")
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    closed_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))


class Transaction(Base):
    """A completed/attempted money movement (FR-03/06/07).

    ``idempotency_key`` is a SOFT reference to ``session.idempotency_records``
    (no FK). ``pin_verified`` is TRUE for transfers >= SGD 1,000 (SR-12).
    Debit+credit+insert run in one atomic DB transaction.
    """

    __tablename__ = "transactions"
    __table_args__ = (
        CheckConstraint("amount_cents > 0", name="transactions_amount_pos_check"),
        CheckConstraint(
            "transaction_type IN ('transfer','bill_payment')",
            name="transactions_type_check",
        ),
        CheckConstraint(
            "status IN ('pending','complete','failed')", name="transactions_status_check"
        ),
        {"schema": "application"},
    )

    transaction_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, primary_key=True, default=uuid.uuid4
    )
    source_account_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("application.accounts.account_id"), nullable=False
    )
    destination_account_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        ForeignKey("application.accounts.account_id")
    )
    destination_external_ref: Mapped[Optional[str]] = mapped_column(String(255))
    biller_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        ForeignKey("application.billers.biller_id")
    )
    amount_cents: Mapped[int] = mapped_column(BigInteger, nullable=False)
    transaction_type: Mapped[str] = mapped_column(String(16), nullable=False)
    status: Mapped[str] = mapped_column(String(16), nullable=False)
    reference_number: Mapped[str] = mapped_column(String(32), unique=True, nullable=False)
    idempotency_key: Mapped[uuid.UUID] = mapped_column(Uuid, unique=True, nullable=False)
    pin_verified: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default=text("false")
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    completed_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))


class MfaBackupCode(Base):
    """A one-time MFA backup code (SR-11). Stored Argon2id-hashed; consumed once."""

    __tablename__ = "mfa_backup_codes"
    __table_args__ = ({"schema": "application"},)

    code_id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("application.users.user_id"), nullable=False
    )
    code_hash: Mapped[str] = mapped_column(String(255), nullable=False)
    consumed_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )


class ContactPreference(Base):
    """Per-user notification preferences, checked before sending email (FR-04)."""

    __tablename__ = "contact_preferences"
    __table_args__ = ({"schema": "application"},)

    pref_id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("application.users.user_id"), unique=True, nullable=False
    )
    notify_on_transfer: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default=text("true")
    )
    notify_on_login: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default=text("true")
    )


class PendingEmailChange(Base):
    """A pending email re-verification (FR-04). 30-min token, hashed before storage."""

    __tablename__ = "pending_email_changes"
    __table_args__ = ({"schema": "application"},)

    change_id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("application.users.user_id"), nullable=False
    )
    new_email: Mapped[str] = mapped_column(String(254), nullable=False)
    verification_token_hash: Mapped[str] = mapped_column(String(255), nullable=False)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
