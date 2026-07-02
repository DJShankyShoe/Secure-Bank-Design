"""Email sending via smtplib + notification preferences (FR-04/06/07).

``send_email`` delivers a plain-text message through the configured SMTP relay.
Under ``TESTING`` it is suppressed and captured in an in-app outbox so tests can
assert what would have been sent. ``notify_user`` consults ``contact_preferences``
(``notify_on_transfer`` / ``notify_on_login``) before sending.
"""

from __future__ import annotations

import smtplib
import uuid
from email.message import EmailMessage
from typing import Optional

from flask import current_app, render_template
from sqlalchemy import select

from ..extensions import db
from ..models import ContactPreference, User


def _config():
    return current_app.extensions["securebank_config"]


def render_email(template_name: str, **context) -> str:
    """Render a plain-text email body from a Jinja2 template.

    Templates live in ``app/templates/email/``. ``template_name`` is the file name
    (e.g. ``transfer_receipt.txt``).
    """
    return render_template(f"email/{template_name}", **context)


def outbox() -> list[dict]:
    """The in-app captured-email list used under TESTING."""
    return current_app.extensions.setdefault("email_outbox", [])


def send_email(*, to: str, subject: str, body: str) -> None:
    """Send (or, under TESTING, capture) a plain-text email."""
    if current_app.config.get("TESTING"):
        outbox().append({"to": to, "subject": subject, "body": body})
        return

    cfg = _config()
    msg = EmailMessage()
    msg["From"] = cfg.smtp_from
    msg["To"] = to
    msg["Subject"] = subject
    msg.set_content(body)

    with smtplib.SMTP(cfg.smtp_host, cfg.smtp_port, timeout=10) as server:
        server.ehlo()
        try:
            server.starttls()  # opportunistic; relay may not support it
            server.ehlo()
        except smtplib.SMTPException:
            pass
        if cfg.smtp_user and cfg.smtp_password:
            server.login(cfg.smtp_user, cfg.smtp_password)
        server.send_message(msg)


def notify_user(*, user_id: uuid.UUID, pref_attr: str, subject: str, body: str) -> bool:
    """Send an email to ``user_id`` only if their preference ``pref_attr`` allows it.

    Returns True if an email was sent. Defaults to allowed when no preference row
    exists. ``pref_attr`` is ``notify_on_transfer`` or ``notify_on_login``.
    """
    session = db.app_session()
    try:
        user = session.get(User, user_id)
        if user is None:
            return False
        pref: Optional[ContactPreference] = session.execute(
            select(ContactPreference).where(ContactPreference.user_id == user_id)
        ).scalar_one_or_none()
        allowed = getattr(pref, pref_attr) if pref is not None else True
        email = user.email
    finally:
        session.close()

    if not allowed:
        return False
    send_email(to=email, subject=subject, body=body)
    return True
