"""Registration + TOTP enrolment domain logic (FR-01).

Two-stage enrolment (decided 2026-06-24): ``register_customer`` creates a
``pending`` user with an AES-encrypted TOTP seed and hashed one-time backup codes,
returning the provisioning URI + codes for one-time display;
``confirm_totp_enrolment`` verifies a generated code (rate-limited 5/min, SR-11)
and flips the account to ``active`` so it becomes login-usable. PIN is set later in
settings — ``transaction_pin_hash`` stays NULL here. Every outcome is
audited (SR-14).
"""

from __future__ import annotations

import secrets
import uuid
from dataclasses import dataclass

import pyotp
from flask import current_app
from sqlalchemy import select

from ...config import Config
from ...extensions import db
from ...models import ContactPreference, MfaBackupCode, User
from ...security import crypto, lockout
from ...security.masking import mask_nric
from ...security.validation import (
    validate_email,
    validate_full_name,
    validate_nric,
    validate_password,
    validate_totp_code,
)
from ...services.audit import emit_audit

_BACKUP_CODE_COUNT = 10
_BACKUP_CODE_BYTES = 5  # -> 10 hex chars per code


class AuthServiceError(Exception):
    """Base for auth-service failures; carries a user-safe message + HTTP status."""

    status = 400
    message = "Request could not be processed."


class DuplicateRegistration(AuthServiceError):
    status = 409
    message = "Registration could not be completed."


class EnrolmentError(AuthServiceError):
    status = 401
    message = "Verification failed."


class RateLimited(AuthServiceError):
    status = 429
    message = "Too many attempts. Please try again later."


@dataclass
class RegistrationResult:
    """One-time enrolment material returned to the client (never re-shown)."""

    user_id: uuid.UUID
    provisioning_uri: str
    backup_codes: list[str]


def _aes_key() -> bytes:
    cfg: Config = current_app.extensions["securebank_config"]
    return cfg.aes_encryption_key


def _issuer() -> str:
    cfg: Config = current_app.extensions["securebank_config"]
    return cfg.totp_issuer


def register_customer(
    *, full_name: str, nric: str, email: str, password: str, source_ip: str
) -> RegistrationResult:
    """Create a ``pending`` customer with TOTP enrolment material (FR-01).

    Validates all inputs (SR-06), stores the password as Argon2id, NRIC and TOTP
    seed as AES-256-GCM, NRIC masked, and 10 hashed one-time backup codes. Returns
    the provisioning URI + plaintext backup codes for a single display.
    """
    full_name = validate_full_name(full_name)
    nric = validate_nric(nric)
    email = validate_email(email)
    password = validate_password(password)

    key = _aes_key()
    seed = pyotp.random_base32()
    plaintext_codes = [
        secrets.token_hex(_BACKUP_CODE_BYTES).upper() for _ in range(_BACKUP_CODE_COUNT)
    ]

    session = db.app_session()
    try:
        exists = session.execute(
            select(User.user_id).where(User.email == email)
        ).first()
        if exists is not None:
            emit_audit("REGISTER", "denied", source_ip=source_ip,
                       action_detail={"reason": "duplicate_email"})
            raise DuplicateRegistration()

        user = User(
            email=email,
            email_verified=False,
            full_name=full_name,
            nric_encrypted=crypto.aes_encrypt(nric, key),
            nric_masked=mask_nric(nric),
            password_hash=crypto.hash_password(password),
            totp_seed_encrypted=crypto.aes_encrypt(seed, key),
            role="customer",
            account_status="pending",  # not login-usable until TOTP confirmed
        )
        session.add(user)
        session.flush()  # assign user_id

        session.add(ContactPreference(user_id=user.user_id))
        for code in plaintext_codes:
            session.add(
                MfaBackupCode(user_id=user.user_id, code_hash=crypto.hash_backup_code(code))
            )
        session.commit()
        user_id = user.user_id
    except AuthServiceError:
        session.rollback()
        raise
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()

    emit_audit(
        "REGISTER",
        "success",
        source_ip=source_ip,
        actor_user_id=user_id,
        actor_role="customer",
        target_user_id=user_id,
        action_detail={"email": email, "nric_masked": mask_nric(nric)},
    )

    # Email a signup verification link — the account activates only once BOTH the
    # email is verified and TOTP is confirmed (FR-01). Local import avoids a
    # circular import (login_service imports this module).
    from .login_service import send_signup_verification_email
    send_signup_verification_email(user_id=user_id, email=email, source_ip=source_ip)

    provisioning_uri = pyotp.TOTP(seed).provisioning_uri(name=email, issuer_name=_issuer())
    return RegistrationResult(user_id=user_id, provisioning_uri=provisioning_uri,
                              backup_codes=plaintext_codes)


def confirm_totp_enrolment(*, email: str, code: str, source_ip: str) -> str:
    """Verify a TOTP code for a pending account and activate it (FR-01, SR-11).

    Enforces the 5/min/account TOTP limit, counts failures toward the SR-09
    lockout, and audits the outcome. Generic errors only (anti-enumeration).
    """
    email = validate_email(email)
    code = validate_totp_code(code)

    session = db.app_session()
    try:
        user = session.execute(
            select(User).where(User.email == email, User.account_status == "pending")
        ).scalar_one_or_none()
        if user is None:
            emit_audit("MFA_ENROL_VERIFY", "failure", source_ip=source_ip,
                       action_detail={"reason": "no_pending_account"})
            raise EnrolmentError()

        if lockout.is_totp_rate_limited(session, user.user_id):
            emit_audit("MFA_ENROL_VERIFY", "denied", source_ip=source_ip,
                       actor_user_id=user.user_id, target_user_id=user.user_id,
                       action_detail={"reason": "totp_rate_limited"})
            raise RateLimited()

        lockout.record_auth_attempt(session, user.user_id, "totp")
        seed = crypto.aes_decrypt(user.totp_seed_encrypted, _aes_key()).decode("utf-8")
        verified = pyotp.TOTP(seed).verify(code, valid_window=1)

        if not verified:
            lockout.register_failed_auth(user)
            session.commit()
            emit_audit("MFA_ENROL_VERIFY", "failure", source_ip=source_ip,
                       actor_user_id=user.user_id, target_user_id=user.user_id)
            raise EnrolmentError()

        user.totp_confirmed = True
        # Activate only when the signup email is ALSO verified (FR-01); otherwise
        # the account stays 'pending' until the email link is used.
        if user.email_verified:
            user.account_status = "active"
        lockout.reset_failed_auth(user)
        session.commit()
        status = user.account_status
        emit_audit("MFA_ENROL_VERIFY", "success", source_ip=source_ip,
                   actor_user_id=user.user_id, actor_role=user.role,
                   target_user_id=user.user_id)
    except AuthServiceError:
        session.rollback()
        raise
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()
    return status


def get_user_profile(*, user_id: uuid.UUID) -> dict:
    """Return the logged-in user's profile for the SPA (FR-08).

    Safe to hand to the client: masked NRIC only, never a plaintext secret. Returns
    an empty dict if the user no longer exists (the route maps that to 401).
    """
    session = db.app_session()
    try:
        user = session.get(User, user_id)
        if user is None:
            return {}
        return {
            "user_id": str(user.user_id),
            "email": user.email,
            "full_name": user.full_name,
            "role": user.role,
            "nric_masked": user.nric_masked,
            "email_verified": user.email_verified,
            "account_status": user.account_status,
            "created_at": user.created_at.isoformat() if user.created_at else None,
        }
    finally:
        session.close()
