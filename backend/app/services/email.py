"""Email sending via smtplib + notification preferences (FR-04/06/07).

``send_email`` delivers a plain-text message through the configured SMTP relay.
In production the SMTP delivery runs in a background daemon thread so the request
never blocks on the relay — this also removes an email-send timing side-channel
from the anti-enumeration flows (FR-09 password reset, SR-09 unlock): the response
time no longer depends on whether an email was actually sent. Under ``TESTING`` it
is suppressed and captured synchronously in an in-app outbox so tests stay
deterministic. ``notify_user`` consults ``contact_preferences``
(``notify_on_transfer`` / ``notify_on_login``) before sending.
"""

from __future__ import annotations

import logging
import smtplib
import threading
import uuid
from email.message import EmailMessage
from typing import Optional

from flask import current_app, render_template
from sqlalchemy import select

from ..extensions import db
from ..models import ContactPreference, User

_log = logging.getLogger(__name__)


def _config():
    return current_app.extensions["securebank_config"]


def render_email(template_name: str, **context) -> str:
    """Render a plain-text email body from a Jinja2 template.

    Templates live in ``app/templates/email/``. ``template_name`` is the file name
    (e.g. ``transfer_receipt.txt``).
    """
    return render_template(f"email/{template_name}", **context)


def action_link(path: str, token: str) -> str:
    """Build a clickable SPA link carrying a one-time token (FR-04/FR-09).

    e.g. ``action_link("/reset-password", tok)`` ->
    ``https://<frontend>/reset-password?token=<tok>``. The frontend origin comes
    from ``FRONTEND_BASE_URL`` (config). Tokens are URL-safe, so no escaping needed.
    """
    base = current_app.extensions["securebank_config"].frontend_base_url
    return f"{base}{path}?token={token}"


def outbox() -> list[dict]:
    """The in-app captured-email list used under TESTING."""
    return current_app.extensions.setdefault("email_outbox", [])


def _smtp_send(*, smtp_from: str, host: str, port: int, user: Optional[str],
               password: Optional[str], to: str, subject: str, body: str) -> None:
    """Deliver one message over SMTP. Best-effort: failures are logged, not raised.

    Runs in a background thread, so it takes only plain values (no ``current_app``)
    and must never propagate an exception — a relay error must not surface to the
    client or leak timing (FR-09/SR-09).
    """
    msg = EmailMessage()
    msg["From"] = smtp_from
    msg["To"] = to
    msg["Subject"] = subject
    msg.set_content(body)
    try:
        with smtplib.SMTP(host, port, timeout=10) as server:
            server.ehlo()
            try:
                server.starttls()  # opportunistic; relay may not support it
                server.ehlo()
            except smtplib.SMTPException:
                pass
            if user and password:
                server.login(user, password)
            server.send_message(msg)
    except Exception:  # noqa: BLE001 - best-effort delivery, never surface to caller
        _log.exception("Email delivery failed (to=%s, subject=%s)", to, subject)


def send_email(*, to: str, subject: str, body: str) -> None:
    """Queue a plain-text email for delivery (or capture it under TESTING).

    Under ``TESTING`` the message is captured synchronously in the outbox. In
    production delivery is dispatched to a background daemon thread so the request
    returns immediately regardless of relay latency — closing the email-send timing
    channel in the generic anti-enumeration flows (FR-09/SR-09). Delivery is
    best-effort; failures are logged server-side, never raised to the caller.
    """
    if current_app.config.get("TESTING"):
        outbox().append({"to": to, "subject": subject, "body": body})
        return

    cfg = _config()
    threading.Thread(
        target=_smtp_send,
        kwargs=dict(smtp_from=cfg.smtp_from, host=cfg.smtp_host, port=cfg.smtp_port,
                    user=cfg.smtp_user, password=cfg.smtp_password,
                    to=to, subject=subject, body=body),
        daemon=True,
    ).start()


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
