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
import hmac
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
from ...security.validation import (
    ValidationError,
    validate_email,
    validate_nric,
    validate_password,
)
from ...services.audit import emit_audit
from ...services.email import action_link, notify_user, render_email, send_email
from .service import AuthServiceError, RateLimited

_MFA_TOKEN_SALT = "mfa-pending-v1"
_UNLOCK_TOKEN_SALT = "account-unlock-v1"
_RESET_TOKEN_SALT = "password-reset-v1"
_SIGNUP_EMAIL_SALT = "signup-email-verify-v1"
_SIX_DIGITS = re.compile(r"^\d{6}$")

# Pre-computed hash so an unknown-user login still spends ~one Argon2 verify,
# blunting username-enumeration via timing (SR-09).
_DUMMY_HASH = crypto.hash_password(secrets.token_hex(16))


class InvalidCredentials(AuthServiceError):
    status = 401
    message = "Invalid credentials."


class VerificationRequired(AuthServiceError):
    """Correct password, but the account isn't fully verified yet (FR-01).

    Raised only when the credentials are valid and the account is ``pending`` — so
    the SPA can tell the user which step is missing (email and/or TOTP) instead of
    a generic error. Carries the two flags. Only reachable with the right password,
    so it doesn't help account enumeration.
    """

    status = 403
    message = "Account not verified."

    def __init__(self, *, email_verified: bool, totp_confirmed: bool):
        super().__init__()
        self.email_verified = email_verified
        self.totp_confirmed = totp_confirmed


class UnlockLinkInvalid(AuthServiceError):
    status = 400
    message = "Invalid or expired unlock link."


class PasswordResetInvalid(AuthServiceError):
    status = 400
    message = "Invalid or expired reset link."


class PasswordResetStepUpFailed(AuthServiceError):
    status = 401
    message = "Verification code is incorrect."


class CurrentPasswordWrong(AuthServiceError):
    status = 401
    message = "Current password is incorrect."


class SignupEmailInvalid(AuthServiceError):
    status = 400
    message = "Invalid or expired verification link."


class NewPasswordSameAsOld(AuthServiceError):
    status = 400
    message = "New password must be different from the current one."


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
            # Password is correct: for a not-yet-verified (pending) account, tell the
            # user what's missing so the SPA can prompt email/TOTP verification.
            # Other non-active states (suspended/closed) stay generic.
            if user.account_status == "pending":
                raise VerificationRequired(email_verified=user.email_verified,
                                           totp_confirmed=user.totp_confirmed)
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
        uid = user.user_id
        emit_audit("LOGIN", "success", source_ip=source_ip,
                   actor_user_id=user.user_id, actor_role=user.role,
                   target_user_id=user.user_id, action_detail={"step": "mfa", "method": method})
    except AuthServiceError:
        session.rollback()
        raise
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()

    # New-login notification (honours the notify_on_login preference). Best-effort:
    # the session is already created, so a notify hiccup must never fail the login.
    try:
        when = datetime.now(timezone.utc).isoformat(timespec="seconds")
        notify_user(user_id=uid, pref_attr="notify_on_login",
                    subject="New sign-in to your SecureBank account",
                    body=render_email("login_notification.txt",
                                      source_ip=source_ip, when=when))
    except Exception:  # noqa: BLE001 - notification is non-critical
        pass
    return session_id


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
            body=render_email("unlock_account.txt",
                              unlock_url=action_link("/unlock", token)),
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


def request_password_reset(*, email: str, nric: str, source_ip: str) -> None:
    """Email a 30-min single-use reset link — only if email AND NRIC match (FR-09).

    Identity is proven up front: a link is sent only when the account exists, is
    resettable, and the supplied **NRIC matches the one on file** (constant-time).
    Generic by design (anti-enumeration, SR-09): every path — unknown email, wrong
    NRIC, malformed input, rate-limited — returns the same generic response and
    sends nothing. Per-account rate-limited via the shared ``email`` window (the
    attempt is recorded before the NRIC check so it also bounds NRIC guessing). The
    token embeds a fingerprint of the current password hash → self-invalidates once
    the password changes.
    """
    try:
        email = validate_email(email)
        nric = validate_nric(nric)
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
                stored_nric = crypto.aes_decrypt(
                    user.nric_encrypted, _aes_key()).decode("utf-8")
                if hmac.compare_digest(nric, stored_nric):
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
            body=render_email("password_reset.txt",
                              reset_url=action_link("/reset-password", token)),
        )
        emit_audit("PASSWORD_RESET_REQUEST", "success", source_ip=source_ip,
                   action_detail={"email": email})


def check_reset_token(token: str) -> bool:
    """Read-only validity check for a reset token (FR-09) — does NOT consume it.

    True only when the token's signature is valid and unexpired AND the account
    still exists, is resettable, and the password hasn't changed since the link was
    issued (fingerprint still matches — i.e. the link is unused). Lets the SPA
    render the reset form or an "expired link" message before the user fills
    anything in. Returns only a boolean; reveals no account info.
    """
    parsed = _read_reset_token(token or "")
    if parsed is None:
        return False
    user_id, fingerprint = parsed
    session = db.app_session()
    try:
        user = session.get(User, user_id)
        if user is None or user.account_status not in _RESETTABLE_STATUSES:
            return False
        return _reset_fingerprint(user.password_hash) == fingerprint
    finally:
        session.close()


def verify_password_reset(
    *, token: str, new_password: str, totp_code: str, source_ip: str
) -> None:
    """Consume a reset token, verify a second factor, and set a new password
    (FR-09, SR-01/11/13).

    Identity (email + NRIC) is already proven at the request step — the link is
    only issued when both match — so here the caller just needs the link plus a
    valid **TOTP code or one-time backup code** (step-up), rate-limited 5/min
    (SR-11). On success the new password is re-validated against the FR-01 policy,
    re-hashed with Argon2id, any lockout is cleared, and ALL of the user's sessions
    are revoked so a stolen session cannot survive the reset (SR-13). Single-use via
    the password-hash fingerprint. Generic errors.
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


def change_password(*, user_id: uuid.UUID, current_password: str, new_password: str,
                    current_session_id: str, source_ip: str) -> None:
    """Change a logged-in user's password (FR-01, SR-01/13).

    Re-verifies the **current** password, enforces the FR-01 policy on the new one,
    re-hashes with Argon2id, and revokes the user's OTHER sessions (keeps the
    caller's own device signed in). Audited.
    """
    new_password = validate_password(new_password)  # ValidationError -> 400
    session = db.app_session()
    try:
        user = session.get(User, user_id)
        if user is None or not crypto.verify_password(
            user.password_hash, current_password or ""
        ):
            emit_audit("PASSWORD_CHANGE", "failure", source_ip=source_ip,
                       actor_user_id=user_id, target_user_id=user_id,
                       action_detail={"reason": "bad_current_password"})
            raise CurrentPasswordWrong()
        if crypto.verify_password(user.password_hash, new_password):
            raise NewPasswordSameAsOld()

        user.password_hash = crypto.hash_password(new_password)
        revoke_user_sessions(session, user_id, except_session_id=current_session_id)
        session.commit()
    except AuthServiceError:
        session.rollback()
        raise
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()
    emit_audit("PASSWORD_CHANGE", "success", source_ip=source_ip,
               actor_user_id=user_id, actor_role="customer", target_user_id=user_id)


# --------------------------------------------------------------------------- #
# Signup email verification (FR-01) — account is usable only once the email is
# verified AND TOTP is confirmed (both flags true → account_status 'active').
# --------------------------------------------------------------------------- #

def _signup_serializer() -> URLSafeTimedSerializer:
    return URLSafeTimedSerializer(current_app.config["SECRET_KEY"], salt=_SIGNUP_EMAIL_SALT)


def send_signup_verification_email(*, user_id: uuid.UUID, email: str, source_ip: str) -> None:
    """Email a 24-h signup verification link to a new registrant (FR-01)."""
    token = _signup_serializer().dumps(_seal_uid(user_id))
    send_email(
        to=email,
        subject="Verify your SecureBank email",
        body=render_email("verify_signup_email.txt",
                          verify_url=action_link("/verify-signup", token)),
    )
    emit_audit("SIGNUP_EMAIL_SENT", "success", source_ip=source_ip,
               actor_user_id=user_id, target_user_id=user_id)


def resend_signup_verification(*, email: str, source_ip: str) -> None:
    """Re-send the signup verification link (FR-01) — for a stuck registrant.

    Generic by design (anti-enumeration): always the same response; a link is sent
    only when the account exists, is still ``pending`` with an unverified email, and
    the per-account email rate-limit (shared ``email`` window) isn't exceeded.
    """
    try:
        email = validate_email(email)
    except ValidationError:
        return

    session = db.app_session()
    target = None
    uid = None
    try:
        user = session.execute(select(User).where(User.email == email)).scalar_one_or_none()
        if (user is not None and user.account_status == "pending"
                and not user.email_verified
                and not lockout.is_email_action_rate_limited(session, user.user_id)):
            lockout.record_auth_attempt(session, user.user_id, "email")
            session.commit()
            uid, target = user.user_id, user.email
    finally:
        session.close()

    if target:
        send_signup_verification_email(user_id=uid, email=target, source_ip=source_ip)


def _read_signup_token(token: str) -> Optional[uuid.UUID]:
    try:
        sealed = _signup_serializer().loads(
            token, max_age=int(Config.SIGNUP_EMAIL_TOKEN_TTL.total_seconds())
        )
        return _open_uid(sealed)
    except (BadSignature, SignatureExpired, InvalidTag, ValueError, TypeError, AttributeError):
        return None


def verify_signup_email(*, token: str, source_ip: str) -> str:
    """Consume a signup verification link → mark the email verified (FR-01).

    Activates the account (``pending`` → ``active``) only if TOTP is also already
    confirmed. Idempotent. Returns the resulting ``account_status`` so the SPA can
    tell the user whether anything else (TOTP) is still pending.
    """
    user_id = _read_signup_token(token or "")
    if user_id is None:
        raise SignupEmailInvalid()

    session = db.app_session()
    try:
        user = session.get(User, user_id)
        if user is None:
            raise SignupEmailInvalid()
        if not user.email_verified:
            user.email_verified = True
            if user.totp_confirmed and user.account_status == "pending":
                user.account_status = "active"
            session.commit()
            emit_audit("SIGNUP_EMAIL_VERIFY", "success", source_ip=source_ip,
                       actor_user_id=user_id, target_user_id=user_id)
        status = user.account_status
    except AuthServiceError:
        session.rollback()
        raise
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()
    return status


def reissue_totp_provisioning(*, email: str, password: str, source_ip: str) -> str:
    """Re-issue the TOTP provisioning URI for a user who never finished setup (FR-01).

    For a registrant who closed the QR screen before scanning it. Requires the
    correct password (failures count toward the SR-09 lockout) and only works while
    the account is still ``pending`` with TOTP **not yet confirmed** — once TOTP is
    confirmed the seed is never re-exposed. Returns the SAME seed's provisioning URI
    (no seed rotation). Generic errors (anti-enumeration).
    """
    try:
        email = validate_email(email)
    except ValidationError:
        crypto.verify_password(_DUMMY_HASH, password or "")  # constant-ish timing
        raise InvalidCredentials() from None

    session = db.app_session()
    try:
        user = session.execute(select(User).where(User.email == email)).scalar_one_or_none()
        if user is None:
            crypto.verify_password(_DUMMY_HASH, password or "")
            raise InvalidCredentials()

        lockout.clear_expired_lock(user)
        if lockout.is_account_locked(user):
            session.commit()
            raise InvalidCredentials()
        if not crypto.verify_password(user.password_hash, password or ""):
            lockout.register_failed_auth(user)
            session.commit()
            emit_audit("TOTP_REPROVISION", "failure", source_ip=source_ip,
                       actor_user_id=user.user_id, target_user_id=user.user_id,
                       action_detail={"reason": "bad_password"})
            raise InvalidCredentials()

        # Only for a pending account whose TOTP isn't confirmed yet — never re-expose
        # the seed of a set-up account.
        if user.account_status != "pending" or user.totp_confirmed:
            session.commit()
            raise InvalidCredentials()

        seed = crypto.aes_decrypt(user.totp_seed_encrypted, _aes_key()).decode("utf-8")
        issuer = current_app.extensions["securebank_config"].totp_issuer
        uri = pyotp.TOTP(seed).provisioning_uri(name=user.email, issuer_name=issuer)
        lockout.reset_failed_auth(user)
        session.commit()
        emit_audit("TOTP_REPROVISION", "success", source_ip=source_ip,
                   actor_user_id=user.user_id, target_user_id=user.user_id)
        return uri
    except AuthServiceError:
        session.rollback()
        raise
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()
