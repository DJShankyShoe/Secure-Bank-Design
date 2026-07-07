"""FR-10 notification tests: the customer bell (list / unread / mark-read, IDOR,
RBAC) and that admin actions + brute-force lockout raise a notification (and an
email where required). Requires the application.notifications table (see
sql/migrations/2026-07-06_notifications.sql)."""

from __future__ import annotations

import uuid
from urllib.parse import parse_qs, urlparse

import pyotp
import pytest
from sqlalchemy import select

from app.blueprints.auth.login_service import InvalidCredentials, login_password
from app.blueprints.auth.service import confirm_totp_enrolment, register_customer
from conftest import activate_signup_email, unique_nric

_HTTPS = "https://localhost"
_IP = "203.0.113.77"
_PW = "Str0ng!Passw0rd"


@pytest.fixture(scope="module")
def notif_app():
    # A module-scoped app with CSRF disabled (state-changing POSTs are exercised
    # here). Named distinctly so it does NOT shadow conftest's session-scoped
    # ``app`` fixture, which ``db_available`` depends on (avoids ScopeMismatch).
    from app import create_app

    a = create_app()
    a.config.update(TESTING=True, WTF_CSRF_ENABLED=False)
    return a


def _email() -> str:
    return f"notif-{uuid.uuid4().hex[:12]}@example.com"


def _register(app, role="customer") -> dict:
    email, nric = _email(), unique_nric()
    with app.app_context():
        res = register_customer(full_name="Notif User", nric=nric, email=email,
                                password=_PW, source_ip=_IP)
        secret = parse_qs(urlparse(res.provisioning_uri).query)["secret"][0]
        confirm_totp_enrolment(email=email, code=pyotp.TOTP(secret).now(), source_ip=_IP)
        activate_signup_email(app, email)
        if role != "customer":
            from app.extensions import db
            from app.models import User

            s = db.app_session()
            try:
                u = s.execute(select(User).where(User.email == email)).scalar_one()
                u.role = role
                s.commit()
            finally:
                s.close()
    return {"email": email, "nric": nric, "secret": secret, "user_id": res.user_id}


def _client(app, creds):
    with app.app_context():
        token = login_password(email=creds["email"], password=_PW, source_ip=_IP)
    c = app.test_client()
    c.post("/auth/login/mfa", json={"mfa_token": token, "code": pyotp.TOTP(creds["secret"]).now()},
           base_url=_HTTPS)
    return c


def _notify(app, user_id, category="account_locked", title="Alert", body="body"):
    from app.services.notifications import create_notification

    with app.app_context():
        create_notification(user_id=user_id, category=category, title=title, body=body)


def _outbox(app):
    return app.extensions.setdefault("email_outbox", [])


# --------------------------------------------------------------------------- #
# Bell: list / unread / mark-read
# --------------------------------------------------------------------------- #

def test_list_empty_for_new_user(require_db, notif_app):
    c = _client(notif_app, _register(notif_app))
    body = c.get("/notifications", base_url=_HTTPS).get_json()
    assert body["items"] == [] and body["unread_count"] == 0


def test_create_shows_and_counts_unread(require_db, notif_app):
    creds = _register(notif_app)
    _notify(notif_app, creds["user_id"], title="Account locked")
    c = _client(notif_app, creds)
    body = c.get("/notifications", base_url=_HTTPS).get_json()
    assert body["unread_count"] == 1
    assert body["items"][0]["title"] == "Account locked"
    assert body["items"][0]["read"] is False


def test_mark_one_read(require_db, notif_app):
    creds = _register(notif_app)
    _notify(notif_app, creds["user_id"])
    c = _client(notif_app, creds)
    nid = c.get("/notifications", base_url=_HTTPS).get_json()["items"][0]["notification_id"]
    assert c.post(f"/notifications/{nid}/read", base_url=_HTTPS).status_code == 200
    assert c.get("/notifications", base_url=_HTTPS).get_json()["unread_count"] == 0


def test_mark_all_read(require_db, notif_app):
    creds = _register(notif_app)
    _notify(notif_app, creds["user_id"])
    _notify(notif_app, creds["user_id"])
    c = _client(notif_app, creds)
    assert c.post("/notifications/read-all", base_url=_HTTPS).status_code == 200
    assert c.get("/notifications", base_url=_HTTPS).get_json()["unread_count"] == 0


# --------------------------------------------------------------------------- #
# SR-13: the bell's background poll must not extend the idle session
# --------------------------------------------------------------------------- #

def test_list_route_does_not_slide_idle_window(require_db, notif_app):
    """GET /notifications is polled every 60s in the background regardless of
    real user activity; it must not touch last_active_at (touch=False), or a
    session left open but genuinely unattended would never idle-timeout."""
    from datetime import datetime, timedelta, timezone

    from app.config import Config
    from app.extensions import db
    from app.models import SessionRecord

    creds = _register(notif_app)
    c = _client(notif_app, creds)
    session_id = c.get_cookie(Config.SESSION_COOKIE_NAME).value

    s = db.app_session()
    try:
        stale = datetime.now(timezone.utc) - timedelta(minutes=5)
        rec = s.get(SessionRecord, session_id)
        rec.last_active_at = stale
        s.commit()
    finally:
        s.close()

    r = c.get("/notifications", base_url=_HTTPS)
    assert r.status_code == 200

    s = db.app_session()
    try:
        assert s.get(SessionRecord, session_id).last_active_at == stale
    finally:
        s.close()


def test_other_authenticated_route_still_slides_idle_window(require_db, notif_app):
    """Contrast case: a normal authenticated route (unlike the bell poll) still
    extends the idle window as before — touch=False is the exception, not the
    new default."""
    from datetime import datetime, timedelta, timezone

    from app.config import Config
    from app.extensions import db
    from app.models import SessionRecord

    creds = _register(notif_app)
    c = _client(notif_app, creds)
    session_id = c.get_cookie(Config.SESSION_COOKIE_NAME).value

    s = db.app_session()
    try:
        stale = datetime.now(timezone.utc) - timedelta(minutes=5)
        rec = s.get(SessionRecord, session_id)
        rec.last_active_at = stale
        s.commit()
    finally:
        s.close()

    r = c.get("/auth/me", base_url=_HTTPS)
    assert r.status_code == 200

    s = db.app_session()
    try:
        assert s.get(SessionRecord, session_id).last_active_at > stale
    finally:
        s.close()


# --------------------------------------------------------------------------- #
# Ownership + RBAC
# --------------------------------------------------------------------------- #

def test_only_own_notifications(require_db, notif_app):
    a, b = _register(notif_app), _register(notif_app)
    _notify(notif_app, a["user_id"], title="A private")
    body = _client(notif_app, b).get("/notifications", base_url=_HTTPS).get_json()
    assert all(it["title"] != "A private" for it in body["items"])


def test_mark_read_other_users_is_noop(require_db, notif_app):
    a, b = _register(notif_app), _register(notif_app)
    _notify(notif_app, a["user_id"])
    ca = _client(notif_app, a)
    nid = ca.get("/notifications", base_url=_HTTPS).get_json()["items"][0]["notification_id"]
    # B tries to mark A's notification read -> 200 but no effect (ownership predicate).
    _client(notif_app, b).post(f"/notifications/{nid}/read", base_url=_HTTPS)
    assert ca.get("/notifications", base_url=_HTTPS).get_json()["unread_count"] == 1


def test_admin_denied_notifications_403(require_db, notif_app):
    admin = _client(notif_app, _register(notif_app, role="admin"))
    assert admin.get("/notifications", base_url=_HTTPS).status_code == 403


# --------------------------------------------------------------------------- #
# Triggers: admin action + lockout raise a notification (+ email where required)
# --------------------------------------------------------------------------- #

def test_admin_suspend_user_notifies_and_emails(require_db, notif_app):
    from app.blueprints.admin.service import suspend_user
    from app.services.notifications import list_notifications

    target = _register(notif_app)
    _outbox(notif_app).clear()
    with notif_app.app_context():
        suspend_user(admin_id=uuid.uuid4(), target_user_id=target["user_id"],
                     reason="policy violation", source_ip=_IP)
        items = list_notifications(user_id=target["user_id"])["items"]
    assert any(i["category"] == "user_suspended" and "policy violation" in i["body"]
               for i in items)
    assert any("suspend" in m["subject"].lower() for m in _outbox(notif_app))


def test_lockout_notifies_and_emails(require_db, notif_app):
    from app.services.notifications import list_notifications

    creds = _register(notif_app)
    _outbox(notif_app).clear()
    with notif_app.app_context():
        for _ in range(5):
            with pytest.raises(InvalidCredentials):
                login_password(email=creds["email"], password="WrongPass123!", source_ip=_IP)
        items = list_notifications(user_id=creds["user_id"])["items"]
    assert any(i["category"] == "account_locked" for i in items)
    assert any("locked" in m["subject"].lower() for m in _outbox(notif_app))
