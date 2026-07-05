"""Tests for the auth/RBAC/IDOR decorators (FR-08, SR-13).

A throwaway app exposes protected probe routes. Requests use base_url https so the
Secure session cookie is sent by the test client.
"""

from __future__ import annotations

import uuid
from urllib.parse import parse_qs, urlparse

import pyotp
import pytest
from flask import g, jsonify
from sqlalchemy import select

from app.blueprints.auth.login_service import login_password
from app.blueprints.auth.service import confirm_totp_enrolment, register_customer
from conftest import activate_signup_email, unique_nric
from app.security.decorators import ensure_owner, require_authenticated, require_role

_HTTPS = "https://localhost"


@pytest.fixture(scope="module")
def secured_app():
    from app import create_app

    a = create_app()
    a.config.update(TESTING=True, WTF_CSRF_ENABLED=False)

    @a.get("/_me")
    @require_authenticated
    def _me():
        return jsonify(user_id=str(g.user_id), role=g.user_role)

    @a.get("/_admin")
    @require_role("admin")
    def _admin():
        return jsonify(ok=True)

    @a.get("/_own/<owner>")
    @require_authenticated
    def _own(owner):
        ensure_owner(uuid.UUID(owner))
        return jsonify(ok=True)

    return a


def _email() -> str:
    return f"deco-{uuid.uuid4().hex[:12]}@example.com"


def _make_user(app, role="customer") -> dict:
    """Register + activate a user; optionally promote to admin. Returns creds."""
    email, password = _email(), "Str0ng!Passw0rd"
    with app.app_context():
        res = register_customer(full_name="Deco User", nric=unique_nric(), email=email,
                                password=password, source_ip="203.0.113.2")
        secret = parse_qs(urlparse(res.provisioning_uri).query)["secret"][0]
        confirm_totp_enrolment(email=email, code=pyotp.TOTP(secret).now(), source_ip="203.0.113.2")
        activate_signup_email(app, email)  # FR-01: verify signup email
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
    return {"email": email, "password": password, "secret": secret, "user_id": res.user_id}


def _login(app, client, creds) -> None:
    """Drive the two-stage login on `client`, leaving the session cookie in its jar."""
    with app.app_context():
        token = login_password(email=creds["email"], password=creds["password"],
                               source_ip="203.0.113.2")
    client.post("/auth/login/mfa",
                json={"mfa_token": token, "code": pyotp.TOTP(creds["secret"]).now()},
                base_url=_HTTPS)


def test_unauthenticated_request_401(require_db, secured_app):
    c = secured_app.test_client()
    r = c.get("/_me", base_url=_HTTPS)
    assert r.status_code == 401
    assert r.get_json() == {"error": "Authentication required."}


def test_authenticated_request_200(require_db, secured_app):
    creds = _make_user(secured_app)
    c = secured_app.test_client()
    _login(secured_app, c, creds)
    r = c.get("/_me", base_url=_HTTPS)
    assert r.status_code == 200
    assert r.get_json()["user_id"] == str(creds["user_id"])


def test_mfa_pending_token_cannot_reach_protected_route(require_db, secured_app):
    # An MFA-pending token is NOT a session; using it as the cookie must 401.
    creds = _make_user(secured_app)
    with secured_app.app_context():
        token = login_password(email=creds["email"], password=creds["password"],
                               source_ip="203.0.113.2")
    c = secured_app.test_client()
    c.set_cookie("sb_session", token, domain="localhost")
    r = c.get("/_me", base_url=_HTTPS)
    assert r.status_code == 401


def test_customer_denied_admin_route_403(require_db, secured_app):
    creds = _make_user(secured_app, role="customer")
    c = secured_app.test_client()
    _login(secured_app, c, creds)
    r = c.get("/_admin", base_url=_HTTPS)
    assert r.status_code == 403
    assert r.get_json() == {"error": "Forbidden."}


def test_admin_allowed_admin_route_200(require_db, secured_app):
    creds = _make_user(secured_app, role="admin")
    c = secured_app.test_client()
    _login(secured_app, c, creds)
    r = c.get("/_admin", base_url=_HTTPS)
    assert r.status_code == 200


def test_idor_returns_404_for_other_users_resource(require_db, secured_app):
    creds = _make_user(secured_app)
    c = secured_app.test_client()
    _login(secured_app, c, creds)
    # Own resource: 200.
    assert c.get(f"/_own/{creds['user_id']}", base_url=_HTTPS).status_code == 200
    # Someone else's id: 404 (does not confirm existence).
    assert c.get(f"/_own/{uuid.uuid4()}", base_url=_HTTPS).status_code == 404
