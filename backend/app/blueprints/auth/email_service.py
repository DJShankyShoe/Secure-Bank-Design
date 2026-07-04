"""Email-change with re-verification (FR-04).

Changing the registered email requires proving control of the **new** address: a
one-time, hashed, 30-minute token is emailed there, and the change only takes
effect when that token is presented back. Anti-enumeration: if the requested
address already belongs to an account we return the same generic response and do
nothing (no email is sent to a third party, no existence is revealed). All
outcomes are audited (SR-14).
"""

from __future__ import annotations

import hashlib
import secrets
import uuid
from datetime import datetime, timezone

from sqlalchemy import delete, select

from ...config import Config
from ...extensions import db
from ...models import PendingEmailChange, User
from ...security import lockout
from ...security.validation import validate_email
from ...services.audit import emit_audit
from ...services.email import action_link, render_email, send_email


class EmailChangeError(Exception):
    status = 400
    message = "Email change could not be processed."


class SameEmail(EmailChangeError):
    message = "New email must be different from the current one."


class InvalidToken(EmailChangeError):
    message = "Invalid or expired verification link."


class EmailRateLimited(EmailChangeError):
    status = 429
    message = "Too many requests. Please try again later."


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _hash_token(token: str) -> str:
    """SHA-256 of a high-entropy verification token (not a password)."""
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def request_email_change(*, user_id: uuid.UUID, new_email: str, source_ip: str) -> None:
    """Start an email change: store a hashed 30-min token and email the link (FR-04)."""
    new_email = validate_email(new_email)

    session = db.app_session()
    target = None
    old_email = None
    token = None
    try:
        user = session.get(User, user_id)
        if user is None:
            raise InvalidToken()
        if new_email == user.email:
            raise SameEmail()
        old_email = user.email  # captured for the security alert to the OLD address

        # Per-account anti-spam (email bombing / SMTP quota / sender reputation).
        # Counted before the address-in-use check so it can't be bypassed.
        if lockout.is_email_action_rate_limited(session, user_id):
            session.commit()
            emit_audit("EMAIL_CHANGE_REQUEST", "denied", source_ip=source_ip,
                       actor_user_id=user_id, target_user_id=user_id,
                       action_detail={"reason": "rate_limited"})
            raise EmailRateLimited()
        lockout.record_auth_attempt(session, user_id, "email")

        taken = session.execute(select(User.user_id).where(User.email == new_email)).first()
        if taken is not None:
            # Address already in use: respond generically, send nothing (anti-enumeration).
            session.commit()  # persist the recorded attempt
            emit_audit("EMAIL_CHANGE_REQUEST", "denied", source_ip=source_ip,
                       actor_user_id=user_id, target_user_id=user_id,
                       action_detail={"reason": "address_in_use"})
            return

        # One active change per user.
        session.execute(delete(PendingEmailChange).where(PendingEmailChange.user_id == user_id))
        token = secrets.token_urlsafe(32)
        session.add(PendingEmailChange(
            user_id=user_id,
            new_email=new_email,
            verification_token_hash=_hash_token(token),
            expires_at=_now() + Config.EMAIL_VERIFY_TOKEN_TTL,
        ))
        session.commit()
        target = new_email
    finally:
        session.close()

    if target and token:
        # Verification link to the NEW address (only this confirms the change).
        send_email(
            to=target,
            subject="Confirm your new SecureBank email",
            body=render_email("verify_email.txt",
                              verify_url=action_link("/verify-email", token)),
        )
        # Security alert to the OLD address (no token) so a hijacked session that
        # changes the email is noticed by the real owner (FR-04).
        if old_email:
            send_email(
                to=old_email,
                subject="SecureBank email change requested",
                body=render_email("email_change_alert.txt", new_email=target),
            )
        emit_audit("EMAIL_CHANGE_REQUEST", "success", source_ip=source_ip,
                   actor_user_id=user_id, actor_role="customer", target_user_id=user_id)


def verify_email_change(*, token: str, source_ip: str) -> str:
    """Consume a verification token and swap the user's email (FR-04). Returns it."""
    if not token:
        raise InvalidToken()
    token_hash = _hash_token(token)

    session = db.app_session()
    try:
        pending = session.execute(
            select(PendingEmailChange).where(
                PendingEmailChange.verification_token_hash == token_hash
            )
        ).scalar_one_or_none()
        if pending is None or pending.expires_at <= _now():
            if pending is not None:  # prune the expired row
                session.execute(
                    delete(PendingEmailChange).where(
                        PendingEmailChange.change_id == pending.change_id
                    )
                )
                session.commit()
            raise InvalidToken()

        user = session.get(User, pending.user_id)
        still_free = session.execute(
            select(User.user_id).where(User.email == pending.new_email)
        ).first()
        if user is None or still_free is not None:
            session.execute(
                delete(PendingEmailChange).where(PendingEmailChange.change_id == pending.change_id)
            )
            session.commit()
            raise InvalidToken()

        new_email = pending.new_email
        user.email = new_email
        user.email_verified = True
        session.execute(
            delete(PendingEmailChange).where(PendingEmailChange.user_id == user.user_id)
        )
        session.commit()
        actor = user.user_id
    finally:
        session.close()

    emit_audit("EMAIL_CHANGE_VERIFY", "success", source_ip=source_ip,
               actor_user_id=actor, actor_role="customer", target_user_id=actor,
               action_detail={"new_email": new_email})
    return new_email
