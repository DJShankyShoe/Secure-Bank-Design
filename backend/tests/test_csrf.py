"""CSRF protection across the full authenticated flow (SR-05).

Regression test for the cookie-name collision: Flask's signed-session cookie
(which holds the Flask-WTF CSRF secret) and the app's server-side session cookie
must have DIFFERENT names — otherwise MFA login (which sets the server-session
cookie) clobbers the CSRF state and every later POST fails CSRF. Most tests run
with WTF_CSRF_ENABLED=False, so this path needs its own explicit coverage.
"""

from __future__ import annotations

import uuid
from urllib.parse import parse_qs, urlparse

import pyotp
import pytest

from app.blueprints.auth.service import confirm_totp_enrolment, register_customer

_IP = "203.0.113.31"
_PW = "Str0ng!Passw0rd"
_H = {"X-Forwarded-Proto": "https"}


@pytest.fixture(scope="module")
def csrf_app():
    from app import create_app

    a = create_app()
    # CSRF ON (like production); relax only the HTTPS Referer check so the test
    # client doesn't need to forge a Referer — token validation stays enforced.
    a.config.update(TESTING=True, WTF_CSRF_ENABLED=True, WTF_CSRF_SSL_STRICT=False)
    return a


def _register_active(app) -> tuple[str, str]:
    email = f"csrf-{uuid.uuid4().hex[:10]}@example.com"
    with app.app_context():
        res = register_customer(full_name="CSRF User", nric="S1234567D", email=email,
                                password=_PW, source_ip=_IP)
        secret = parse_qs(urlparse(res.provisioning_uri).query)["secret"][0]
        confirm_totp_enrolment(email=email, code=pyotp.TOTP(secret).now(), source_ip=_IP)
    return email, secret


def test_csrf_token_survives_login_and_authorises_post(require_db, csrf_app):
    email, secret = _register_active(csrf_app)
    c = csrf_app.test_client()

    # SPA behaviour: fetch the CSRF token ONCE, reuse it for every POST.
    csrf = c.get("/auth/csrf", headers=_H).get_json()["csrf_token"]
    hdr = {**_H, "X-CSRFToken": csrf}

    r1 = c.post("/auth/login", json={"email": email, "password": _PW}, headers=hdr)
    assert r1.status_code == 200
    mfa = r1.get_json()["mfa_token"]

    r2 = c.post("/auth/login/mfa", json={"mfa_token": mfa, "code": pyotp.TOTP(secret).now()},
                headers=hdr)
    assert r2.status_code == 200

    # The same token must still authorise a state-changing POST AFTER login — i.e.
    # MFA login did not clobber the CSRF cookie.
    r3 = c.post("/accounts", json={"account_type": "savings"}, headers=hdr)
    assert r3.status_code == 201


def test_post_without_csrf_token_is_forbidden(require_db, csrf_app):
    c = csrf_app.test_client()
    # No X-CSRFToken -> rejected before the view runs (SR-05).
    r = c.post("/accounts", json={"account_type": "savings"}, headers=_H)
    assert r.status_code == 403
