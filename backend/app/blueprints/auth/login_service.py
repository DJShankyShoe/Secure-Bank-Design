"""Two-stage login + MFA domain logic (FR-01, SR-09/11/13).

Stage 1 ``login_password``: verify the Argon2 password; on success issue a
short-lived, signed **MFA-pending token** that authorises ONLY the MFA step (it is
not a session and grants no resource access). Stage 2 ``login_mfa``: verify a TOTP
code or a one-time backup code, then create the real server-side session
(regenerating the ID, SR-13). Every failure — bad password, bad MFA, unknown user
— returns the SAME generic error and counts toward the 5-consecutive lockout
(SR-09); messages never reveal which factor failed or whether the user exists
(anti-enumeration, SR-09). All outcomes are audited (SR-14).
"""

from __future__ import annotations

import base64
import hashlib
import re
import secrets
import uuid
from datetime import datetime, timezone
from typing import Optional

import pyotp
from cryptography.exceptions import InvalidTag
from flask import current_app
from itsdangerous import BadSignature, SignatureExpired, URLSafeTimedSerializer
from sqlalchemy import select

from ...config import Config
from ...extensions import db
from ...models import MfaBackupCode, User
from ...security import crypto, lockout
from ...security.sessions import create_session, revoke_user_sessions
from ...security.validation import ValidationError, validate_email, validate_password
from ...services.audit import emit_audit
from ...services.email import render_email, send_email
from .service import AuthServiceError, RateLimited

_MFA_TOKEN_SALT = "mfa-pending-v1"
_UNLOCK_TOKEN_SALT = "account-unlock-v1"
_RESET_TOKEN_SALT = "password-reset-v1"
_SIX_DIGITS = re.compile(r"^\d{6}$")

# Pre-computed hash so an unknown-user login still spends ~one Argon2 verify,
# blunting username-enumeration via timing (SR-09).
_DUMMY_HASH = crypto.hash_password(secrets.token_hex(16))


class InvalidCredentials(AuthServiceError):
    status = 401
    message = "Invalid credentials."


class UnlockLinkInvalid(AuthServiceError):
    status = 400
    message = "Invalid or expired unlock link."


class PasswordResetInvalid(AuthServiceError):
    status = 400
    message = "Invalid or expired reset link."


class PasswordResetStepUpFailed(AuthServiceError):
    status = 401
    message = "Verification code is incorrect."


def _serializer() -> URLSafeTimedSerializer:
    return URLSafeTimedSerializer(current_app.config["SECRET_KEY"], salt=_MFA_TOKEN_SALT)


def _aes_key() -> bytes:
    return current_app.extensions["securebank_config"].aes_encryption_key


def _seal_uid(user_id: uuid.UUID) -> str:
    """AES-256-GCM encrypt + base64 a user_id so signed tokens don't expose it."""
    blob = crypto.aes_encrypt(str(user_id).encode("utf-8"), _aes_key())
    return base64.urlsafe_b64encode(blob).decode("ascii")


def _open_uid(sealed: str) -> uuid.UUID:
    """Inverse of :func:`_seal_uid`."""
    blob = base64.urlsafe_b64decode(sealed.encode("ascii"))
    return uuid.UUID(crypto.aes_decrypt(blob, _aes_key()).decode("utf-8"))


def issue_mfa_token(user_id: uuid.UUID) -> str:
    """Sign a short-lived MFA-pending token bound to ``user_id`` (uid encrypted)."""
    return _serializer().dumps(_seal_uid(user_id))


def read_mfa_token(token: str) -> Optional[uuid.UUID]:
    """Return the user_id from a valid, unexpired MFA token, else ``None``."""
    try:
        sealed = _serializer().loads(
            token, max_age=int(Config.MFA_PENDING_TOKEN_TTL.total_seconds())
        )
        return _open_uid(sealed)
    except (BadSignature, SignatureExpired, InvalidTag, ValueError, TypeError, AttributeError):
        return None


def login_password(*, email: str, password: str, source_ip: str) -> str:
    """Stage 1: verify password, return an MFA-pending token.

    Generic failure for every error path (bad format, unknown user, wrong
    password, non-active account). Wrong passwords count toward lockout (SR-09).
    """
    try:
        email = validate_email(email)
    except ValidationError:
        crypto.verify_password(_DUMMY_HASH, password or "")  # constant-ish timing
        emit_audit("LOGIN", "failure", source_ip=source_ip,
                   action_detail={"step": "password", "reason": "bad_input"})
        raise InvalidCredentials() from None

    session = db.app_session()
    try:
        user = session.execute(select(User).where(User.email == email)).scalar_one_or_none()
        if user is None:
            crypto.verify_password(_DUMMY_HASH, password or "")
            emit_audit("LOGIN", "failure", source_ip=source_ip,
                       action_detail={"step": "password", "reason": "no_user"})
            raise InvalidCredentials()

        lockout.clear_expired_lock(user)
        if lockout.is_account_locked(user):
            session.commit()
            emit_audit("LOGIN", "denied", source_ip=source_ip,
                       actor_user_id=user.user_id, target_user_id=user.user_id,
                       action_detail={"step": "password", "reason": "locked"})
            raise InvalidCredentials()

        if not crypto.verify_password(user.password_hash, password or ""):
            lockout.register_failed_auth(user)
            session.commit()
            emit_audit("LOGIN", "failure", source_ip=source_ip,
                       actor_user_id=user.user_id, target_user_id=user.user_id,
                       action_detail={"step": "password", "reason": "bad_password"})
            raise InvalidCredentials()

        if user.account_status != "active":
            session.commit()
            emit_audit("LOGIN", "failure", source_ip=source_ip,
                       actor_user_id=user.user_id, target_user_id=user.user_id,
                       action_detail={"step": "password", "reason": "not_active"})
            raise InvalidCredentials()

        session.commit()
        emit_audit("LOGIN", "success", source_ip=source_ip,
                   actor_user_id=user.user_id, actor_role=user.role,
                   target_user_id=user.user_id, action_detail={"step": "password"})
        return issue_mfa_token(user.user_id)
    except AuthServiceError:
        session.rollback()
        raise
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()


def _consume_backup_code(session, user_id: uuid.UUID, code: str) -> bool:
    """Verify + consume a one-time backup code (SR-11). True if one matched.

    Locks the user's unconsumed codes ``FOR UPDATE`` so two concurrent MFA
    requests cannot both spend the same code (TOCTOU) — the loser blocks until the
    winner commits ``consumed_at``, then re-reads it as already consumed.
    """
    rows = session.execute(
        select(MfaBackupCode).where(
            MfaBackupCode.user_id == user_id, MfaBackupCode.consumed_at.is_(None)
        ).with_for_update()
    ).scalars().all()
    for row in rows:
        if crypto.verify_backup_code(row.code_hash, code):
            row.consumed_at = datetime.now(timezone.utc)
            return True
    return False


def login_mfa(*, mfa_token: str, code: str, source_ip: str) -> str:
    """Stage 2: verify TOTP or a backup code, create a session, return its ID.

    Enforces the TOTP 5/min limit; failures count toward lockout. Generic errors.
    """
    user_id = read_mfa_token(mfa_token or "")
    if user_id is None:
        emit_audit("LOGIN", "failure", source_ip=source_ip,
                   action_detail={"step": "mfa", "reason": "bad_token"})
        raise InvalidCredentials()

    session = db.app_session()
    try:
        user = session.get(User, user_id)
        if user is not None:
            lockout.clear_expired_lock(user)
        if user is None or user.account_status != "active":
            emit_audit("LOGIN", "failure", source_ip=source_ip,
                       action_detail={"step": "mfa", "reason": "no_active_user"})
            raise InvalidCredentials()

        if lockout.is_account_locked(user):
            session.commit()
            emit_audit("LOGIN", "denied", source_ip=source_ip,
                       actor_user_id=user.user_id, target_user_id=user.user_id,
                       action_detail={"step": "mfa", "reason": "locked"})
            raise InvalidCredentials()

        if lockout.is_totp_rate_limited(session, user.user_id):
            session.commit()
            emit_audit("LOGIN", "denied", source_ip=source_ip,
                       actor_user_id=user.user_id, target_user_id=user.user_id,
                       action_detail={"step": "mfa", "reason": "totp_rate_limited"})
            raise RateLimited()

        lockout.record_auth_attempt(session, user.user_id, "totp")

        verified = False
        method = None
        if code and _SIX_DIGITS.match(code) and user.totp_seed_encrypted is not None:
            seed = crypto.aes_decrypt(user.totp_seed_encrypted, _aes_key()).decode("utf-8")
            if pyotp.TOTP(seed).verify(code, valid_window=1):
                verified, method = True, "totp"
        if not verified and code and _consume_backup_code(session, user.user_id, code):
            verified, method = True, "backup_code"

        if not verified:
            lockout.register_failed_auth(user)
            session.commit()
            emit_audit("LOGIN", "failure", source_ip=source_ip,
                       actor_user_id=user.user_id, target_user_id=user.user_id,
                       action_detail={"step": "mfa", "reason": "bad_code"})
            raise InvalidCredentials()

        lockout.reset_failed_auth(user)
        session_id = create_session(session, user.user_id, source_ip)
        session.commit()
        emit_audit("LOGIN", "success", source_ip=source_ip,
                   actor_user_id=user.user_id, actor_role=user.role,
                   target_user_id=user.user_id, action_detail={"step": "mfa", "method": method})
        return session_id
    except AuthServiceError:
        session.rollback()
        raise
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()


def logout(*, session_id: str, source_ip: str) -> None:
    """Revoke the current session (SR-13). Idempotent; always 'succeeds'."""
    from ...models import SessionRecord
    from ...security.sessions import revoke_session

    session = db.app_session()
    try:
        record = session.get(SessionRecord, session_id) if session_id else None
        actor = record.user_id if record is not None else None
        revoke_session(session, session_id or "")
        session.commit()
        emit_audit("LOGOUT", "success", source_ip=source_ip,
                   actor_user_id=actor, target_user_id=actor)
    finally:
        session.close()


# --------------------------------------------------------------------------- #
# Self-service account unlock (SR-09)
# --------------------------------------------------------------------------- #

def _unlock_serializer() -> URLSafeTimedSerializer:
    return URLSafeTimedSerializer(current_app.config["SECRET_KEY"], salt=_UNLOCK_TOKEN_SALT)


def _read_unlock_token(token: str) -> Optional[uuid.UUID]:
    try:
        sealed = _unlock_serializer().loads(
            token, max_age=int(Config.LOCKOUT_UNLOCK_TTL.total_seconds())
        )
        return _open_uid(sealed)
    except (BadSignature, SignatureExpired, InvalidTag, ValueError, TypeError, AttributeError):
        return None


def request_account_unlock(*, email: str, source_ip: str) -> None:
    """Email a 30-min unlock link to a locked account's registered address (SR-09).

    Generic by design: an email is only sent when the account exists and is
    actually locked; otherwise nothing happens and the caller still returns the
    same generic response (anti-enumeration).
    """
    try:
        email = validate_email(email)
    except ValidationError:
        return

    session = db.app_session()
    target = None
    token = None
    try:
        user = session.execute(select(User).where(User.email == email)).scalar_one_or_none()
        if user is not None:
            lockout.clear_expired_lock(user)
            session.commit()
            # Per-account anti-spam: cap unlock emails/hour; over the cap, send nothing.
            if lockout.is_account_locked(user) and not lockout.is_email_action_rate_limited(
                session, user.user_id
            ):
                lockout.record_auth_attempt(session, user.user_id, "email")
                session.commit()
                token = _unlock_serializer().dumps(_seal_uid(user.user_id))
                target = user.email
    finally:
        session.close()

    if target and token:
        send_email(
            to=target,
            subject="Unlock your SecureBank account",
            body=render_email("unlock_account.txt", token=token),
        )
        emit_audit("ACCOUNT_UNLOCK_REQUEST", "success", source_ip=source_ip,
                   action_detail={"email": email})


def verify_account_unlock(*, token: str, source_ip: str) -> None:
    """Consume a signed unlock token and reactivate the account (SR-09)."""
    user_id = _read_unlock_token(token or "")
    if user_id is None:
        raise UnlockLinkInvalid()

    session = db.app_session()
    try:
        user = session.get(User, user_id)
        if user is None:
            raise UnlockLinkInvalid()
        if user.account_status == "locked":
            user.account_status = "active"
            lockout.reset_failed_auth(user)
            session.commit()
            emit_audit("ACCOUNT_UNLOCK", "success", source_ip=source_ip,
                       actor_user_id=user_id, target_user_id=user_id)
        else:
            session.rollback()  # already active/other state: no-op, generic success
    finally:
        session.close()


# --------------------------------------------------------------------------- #
# Self-service password reset — forgot password (FR-09)
# --------------------------------------------------------------------------- #

# Only these statuses may reset: 'active' (forgot password) and 'locked' (locked
# out by failed attempts). 'suspended'/'closed'/'pending' are intentionally excluded.
_RESETTABLE_STATUSES = ("active", "locked")


def _reset_serializer() -> URLSafeTimedSerializer:
    return URLSafeTimedSerializer(current_app.config["SECRET_KEY"], salt=_RESET_TOKEN_SALT)


def _reset_fingerprint(password_hash: str) -> str:
    """Short digest binding a reset token to the current password hash.

    Resetting the password changes the hash, so a previously issued token fails
    this check on its next use — making each link effectively single-use with no
    server-side token store (SR-13).
    """
    return hashlib.sha256(password_hash.encode("utf-8")).hexdigest()[:16]


def _read_reset_token(token: str) -> Optional[tuple[uuid.UUID, str]]:
    """Return ``(user_id, fingerprint)`` from a valid, unexpired token, else None."""
    try:
        sealed, fingerprint = _reset_serializer().loads(
            token, max_age=int(Config.EMAIL_VERIFY_TOKEN_TTL.total_seconds())
        )
        return _open_uid(sealed), fingerprint
    except (BadSignature, SignatureExpired, InvalidTag, ValueError, TypeError, AttributeError):
        return None


def request_password_reset(*, email: str, source_ip: str) -> None:
    """Email a 30-min single-use reset link to a registered address (FR-09).

    Generic by design (anti-enumeration, SR-09): a link is sent only when the
    account exists and is resettable; otherwise nothing happens and the caller
    still returns the same generic response. Per-account rate-limited via the
    shared ``email`` attempt window. The token embeds a fingerprint of the current
    password hash, so it self-invalidates once the password changes.
    """
    try:
        email = validate_email(email)
    except ValidationError:
        return

    session = db.app_session()
    target = None
    token = None
    try:
        user = session.execute(select(User).where(User.email == email)).scalar_one_or_none()
        if user is not None and user.account_status in _RESETTABLE_STATUSES:
            if not lockout.is_email_action_rate_limited(session, user.user_id):
                lockout.record_auth_attempt(session, user.user_id, "email")
                session.commit()
                token = _reset_serializer().dumps(
                    [_seal_uid(user.user_id), _reset_fingerprint(user.password_hash)]
                )
                target = user.email
    finally:
        session.close()

    if target and token:
        send_email(
            to=target,
            subject="Reset your SecureBank password",
            body=render_email("password_reset.txt", token=token),
        )
        emit_audit("PASSWORD_RESET_REQUEST", "success", source_ip=source_ip,
                   action_detail={"email": email})


def verify_password_reset(
    *, token: str, new_password: str, totp_code: str, source_ip: str
) -> None:
    """Consume a reset token, verify a second factor, and set a new password
    (FR-09, SR-01/11/13).

    Defence in depth: a valid reset link (email access) is **not** sufficient — the
    caller must also supply a valid **TOTP code or one-time backup code** (step-up),
    so email compromise alone cannot take over the account. TOTP attempts are
    rate-limited 5/min (SR-11). On success the new password is re-validated against
    the FR-01 policy, re-hashed with Argon2id, any lockout is cleared, and ALL of
    the user's sessions are revoked so a stolen session cannot survive the reset
    (SR-13). Single-use via the password-hash fingerprint. Generic errors.
    """
    parsed = _read_reset_token(token or "")
    if parsed is None:
        raise PasswordResetInvalid()
    new_password = validate_password(new_password)  # ValidationError -> 400
    user_id, fingerprint = parsed

    session = db.app_session()
    try:
        user = session.get(User, user_id)
        if user is None or user.account_status not in _RESETTABLE_STATUSES:
            raise PasswordResetInvalid()
        if _reset_fingerprint(user.password_hash) != fingerprint:
            raise PasswordResetInvalid()  # token already used / password since changed

        # Second factor (step-up): a valid TOTP code or a one-time backup code.
        if lockout.is_totp_rate_limited(session, user.user_id):
            session.commit()
            emit_audit("PASSWORD_RESET", "denied", source_ip=source_ip,
                       actor_user_id=user_id, target_user_id=user_id,
                       action_detail={"reason": "totp_rate_limited"})
            raise RateLimited()
        lockout.record_auth_attempt(session, user.user_id, "totp")

        verified = False
        if (totp_code and _SIX_DIGITS.match(totp_code)
                and user.totp_seed_encrypted is not None):
            seed = crypto.aes_decrypt(user.totp_seed_encrypted, _aes_key()).decode("utf-8")
            if pyotp.TOTP(seed).verify(totp_code, valid_window=1):
                verified = True
        if not verified and totp_code and _consume_backup_code(
            session, user.user_id, totp_code
        ):
            verified = True
        if not verified:
            session.commit()  # persist the recorded attempt
            emit_audit("PASSWORD_RESET", "failure", source_ip=source_ip,
                       actor_user_id=user_id, target_user_id=user_id,
                       action_detail={"reason": "bad_second_factor"})
            raise PasswordResetStepUpFailed()

        user.password_hash = crypto.hash_password(new_password)
        if user.account_status == "locked":
            user.account_status = "active"
        lockout.reset_failed_auth(user)
        revoke_user_sessions(session, user.user_id)
        session.commit()
        emit_audit("PASSWORD_RESET", "success", source_ip=source_ip,
                   actor_user_id=user_id, target_user_id=user_id)
    except AuthServiceError:
        session.rollback()
        raise
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()
