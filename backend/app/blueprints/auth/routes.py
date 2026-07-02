"""Auth HTTP routes (FR-01). Thin handlers: parse JSON, delegate to the service,
map outcomes to the generic error shape. CSRF applies to these POSTs
globally (SR-05); inputs are allowlist-validated in the service (SR-06).
"""

from __future__ import annotations

from flask import current_app, g, jsonify, request
from flask_wtf.csrf import generate_csrf

from ...security.decorators import require_authenticated
from ...security.sessions import clear_session_cookie, set_session_cookie
from ...security.validation import ValidationError
from ...services.audit import client_ip
from . import bp
from .email_service import EmailChangeError, request_email_change, verify_email_change
from .login_service import (
    UnlockLinkInvalid,
    login_mfa,
    login_password,
    logout,
    request_account_unlock,
    verify_account_unlock,
)
from .service import (
    AuthServiceError,
    confirm_totp_enrolment,
    register_customer,
)


def _cookie_secure() -> bool:
    """Match the session cookie's Secure flag to the HTTPS posture."""
    return current_app.extensions["securebank_config"].force_https


def _json() -> dict:
    """Return the request JSON body or an empty dict (never raise on bad input)."""
    data = request.get_json(silent=True)
    return data if isinstance(data, dict) else {}


@bp.get("/csrf")
def csrf_token():
    """Return a CSRF token for the SPA to send as the X-CSRFToken header (SR-05).

    GET (not CSRF-protected) so the SPA can bootstrap before any POST. Sets the
    Flask session cookie that the token is validated against.
    """
    return jsonify(csrf_token=generate_csrf()), 200


@bp.post("/register")
def register():
    """Register a customer and begin TOTP enrolment (FR-01).

    Body: ``full_name``, ``nric``, ``email``, ``password``. Returns 201 with the
    TOTP ``provisioning_uri`` and one-time ``backup_codes``. The account stays
    ``pending`` until a TOTP code is confirmed at ``/auth/register/verify-totp``.
    """
    body = _json()
    try:
        result = register_customer(
            full_name=body.get("full_name", ""),
            nric=body.get("nric", ""),
            email=body.get("email", ""),
            password=body.get("password", ""),
            source_ip=client_ip(),
        )
    except ValidationError as exc:
        return jsonify(error=exc.message), 400
    except AuthServiceError as exc:
        return jsonify(error=exc.message), exc.status

    return (
        jsonify(
            user_id=str(result.user_id),
            provisioning_uri=result.provisioning_uri,
            backup_codes=result.backup_codes,
        ),
        201,
    )


@bp.post("/register/verify-totp")
def verify_totp_enrolment():
    """Confirm a TOTP code for a pending account, activating it (FR-01, SR-11).

    Body: ``email``, ``code``. Returns 200 on success. Generic errors only.
    """
    body = _json()
    try:
        confirm_totp_enrolment(
            email=body.get("email", ""),
            code=body.get("code", ""),
            source_ip=client_ip(),
        )
    except ValidationError as exc:
        return jsonify(error=exc.message), 400
    except AuthServiceError as exc:
        return jsonify(error=exc.message), exc.status

    return jsonify(status="active"), 200


@bp.post("/login")
def login():
    """Stage 1 of login: verify password, issue an MFA-pending token (FR-01).

    Body: ``email``, ``password``. Returns 200 ``{mfa_token}``. The token only
    authorises ``/auth/login/mfa`` — it is not a session. Generic errors only.
    """
    body = _json()
    try:
        mfa_token = login_password(
            email=body.get("email", ""),
            password=body.get("password", ""),
            source_ip=client_ip(),
        )
    except AuthServiceError as exc:
        return jsonify(error=exc.message), exc.status

    return jsonify(mfa_token=mfa_token), 200


@bp.post("/login/mfa")
def login_mfa_route():
    """Stage 2 of login: verify TOTP/backup code, start the session (FR-01, SR-13).

    Body: ``mfa_token``, ``code``. On success sets the Secure/HttpOnly/SameSite
    session cookie and returns 200. Generic errors only.
    """
    body = _json()
    try:
        session_id = login_mfa(
            mfa_token=body.get("mfa_token", ""),
            code=body.get("code", ""),
            source_ip=client_ip(),
        )
    except AuthServiceError as exc:
        return jsonify(error=exc.message), exc.status

    response = jsonify(status="ok")
    set_session_cookie(response, session_id, secure=_cookie_secure())
    return response, 200


@bp.post("/logout")
def logout_route():
    """Revoke the current session and clear the cookie (FR-01, SR-13).

    Idempotent: always returns 200 even if no/invalid session cookie is present.
    """
    from ...config import Config

    session_id = request.cookies.get(Config.SESSION_COOKIE_NAME, "")
    logout(session_id=session_id, source_ip=client_ip())
    response = jsonify(status="logged_out")
    clear_session_cookie(response, secure=_cookie_secure())
    return response, 200


@bp.post("/email")
@require_authenticated
def request_email():
    """Request an email change; emails a 30-min verification link to the new
    address (FR-04). Body: ``new_email``. Always returns a generic 200.
    """
    body = _json()
    try:
        request_email_change(user_id=g.user_id, new_email=body.get("new_email", ""),
                             source_ip=client_ip())
    except ValidationError as exc:
        return jsonify(error=exc.message), 400
    except EmailChangeError as exc:
        return jsonify(error=exc.message), exc.status
    return jsonify(status="verification_sent"), 200


@bp.post("/email/verify")
def verify_email():
    """Consume an email-change token and apply the new email (FR-04).

    Body: ``token`` (from the link sent to the new address). Token-gated, so it
    does not require an authenticated session. Generic errors only.
    """
    body = _json()
    try:
        new_email = verify_email_change(token=body.get("token", ""), source_ip=client_ip())
    except EmailChangeError as exc:
        return jsonify(error=exc.message), exc.status
    return jsonify(status="email_updated", email=new_email), 200


@bp.post("/unlock/request")
def unlock_request():
    """Request a 30-min self-service unlock link for a locked account (SR-09).

    Body: ``email``. Always returns a generic 200 (anti-enumeration).
    """
    request_account_unlock(email=_json().get("email", ""), source_ip=client_ip())
    return jsonify(status="unlock_requested"), 200


@bp.post("/unlock/verify")
def unlock_verify():
    """Consume an unlock token and reactivate the account (SR-09). Body: ``token``."""
    try:
        verify_account_unlock(token=_json().get("token", ""), source_ip=client_ip())
    except UnlockLinkInvalid as exc:
        return jsonify(error=exc.message), exc.status
    return jsonify(status="unlocked"), 200
