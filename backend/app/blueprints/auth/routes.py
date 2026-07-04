"""Auth HTTP routes (FR-01). Thin handlers: parse JSON, delegate to the service,
map outcomes to the generic error shape. CSRF applies to these POSTs
globally (SR-05); inputs are allowlist-validated in the service (SR-06).
"""

from __future__ import annotations

from flask import abort, current_app, g, jsonify, request
from flask_wtf.csrf import generate_csrf

from ...security.decorators import require_authenticated
from ...security.sessions import clear_session_cookie, set_session_cookie
from ...security.validation import ValidationError
from ...services.audit import client_ip
from . import bp
from .email_service import EmailChangeError, request_email_change, verify_email_change
from .login_service import (
    UnlockLinkInvalid,
    VerificationRequired,
    change_password,
    check_reset_token,
    login_mfa,
    login_password,
    logout,
    reissue_totp_provisioning,
    request_account_unlock,
    request_password_reset,
    resend_signup_verification,
    verify_account_unlock,
    verify_password_reset,
    verify_signup_email,
)
from .service import (
    AuthServiceError,
    confirm_totp_enrolment,
    get_user_profile,
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
    """Confirm a TOTP code during enrolment (FR-01, SR-11).

    Body: ``email``, ``code``. The account becomes ``active`` only once the signup
    **email is also verified**; until then it stays ``pending``. Returns the
    resulting ``status`` (``active`` or ``pending``). Generic errors only.
    """
    body = _json()
    try:
        status = confirm_totp_enrolment(
            email=body.get("email", ""),
            code=body.get("code", ""),
            source_ip=client_ip(),
        )
    except ValidationError as exc:
        return jsonify(error=exc.message), 400
    except AuthServiceError as exc:
        return jsonify(error=exc.message), exc.status

    return jsonify(status=status), 200


@bp.post("/register/verify-email")
def verify_signup_email_route():
    """Confirm the signup email from the emailed link (FR-01).

    Body: ``token``. The account becomes ``active`` only once TOTP is **also**
    confirmed; otherwise it stays ``pending``. Returns the resulting ``status``.
    """
    try:
        status = verify_signup_email(token=_json().get("token", ""), source_ip=client_ip())
    except AuthServiceError as exc:
        return jsonify(error=exc.message), exc.status
    return jsonify(status=status), 200


@bp.post("/register/resend-email")
def resend_signup_email_route():
    """Re-send the signup verification link for a pending account (FR-01).

    Body: ``email``. Always a generic 200 (anti-enumeration); rate-limited.
    """
    resend_signup_verification(email=_json().get("email", ""), source_ip=client_ip())
    return jsonify(status="verification_email_sent"), 200


@bp.post("/register/totp-setup")
def reissue_totp_route():
    """Re-issue the TOTP provisioning URI for a user who didn't finish setup (FR-01).

    Body: ``email``, ``password`` (the account isn't logged-in yet). Returns
    ``{provisioning_uri}`` only while the account is ``pending`` with TOTP not yet
    confirmed; otherwise a generic 401. Wrong passwords count toward lockout.
    """
    body = _json()
    try:
        uri = reissue_totp_provisioning(email=body.get("email", ""),
                                        password=body.get("password", ""),
                                        source_ip=client_ip())
    except AuthServiceError as exc:
        return jsonify(error=exc.message), exc.status
    return jsonify(provisioning_uri=uri), 200


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
    except VerificationRequired as exc:
        # Correct password but the account isn't verified yet — tell the SPA which
        # step(s) remain so it can prompt (and offer /register/resend-email).
        return jsonify(status="verification_required",
                       email_verified=exc.email_verified,
                       totp_confirmed=exc.totp_confirmed), exc.status
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


@bp.get("/me")
@require_authenticated
def me():
    """Return the current authenticated user's profile for the SPA (FR-08).

    Lets the frontend show who's logged in and gate UI by ``role``. Masked NRIC
    only; no secrets. 401 if not authenticated.
    """
    profile = get_user_profile(user_id=g.user_id)
    if not profile:
        abort(401)
    return jsonify(profile), 200


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


@bp.post("/password/reset/request")
def password_reset_request():
    """Request a 30-min single-use password-reset link (FR-09).

    Body: ``email`` + ``nric`` (both must match an existing account). Unauthenticated.
    Always returns a generic 200 whether or not they match (anti-enumeration, SR-09).
    """
    body = _json()
    request_password_reset(email=body.get("email", ""), nric=body.get("nric", ""),
                           source_ip=client_ip())
    return jsonify(status="reset_requested"), 200


@bp.get("/password/reset/check")
def password_reset_check():
    """Read-only check whether a reset token is currently valid (FR-09).

    Query param ``token``. Returns ``{"valid": bool}`` — does NOT consume the token
    and reveals no account info. The SPA calls this when the reset page loads to
    show the form or an "expired link" message. GET, so no CSRF/session needed.
    """
    return jsonify(valid=check_reset_token(request.args.get("token", ""))), 200


@bp.post("/password/reset/verify")
def password_reset_verify():
    """Consume a reset token, verify a second factor, and set a new password
    (FR-09, SR-01/11/13).

    Body: ``token`` (from the emailed link), ``new_password``, and ``totp_code``
    (a TOTP code or a one-time backup code). Identity (email + NRIC) was already
    proven at the request step. Revokes all existing sessions on success. Generic
    errors only (400 bad token / weak password, 401 bad code, 429 too many attempts).
    """
    body = _json()
    try:
        verify_password_reset(
            token=body.get("token", ""),
            new_password=body.get("new_password", ""),
            totp_code=body.get("totp_code", ""),
            source_ip=client_ip(),
        )
    except ValidationError as exc:
        return jsonify(error=exc.message), 400
    except AuthServiceError as exc:
        return jsonify(error=exc.message), exc.status
    return jsonify(status="password_reset"), 200


@bp.post("/password/change")
@require_authenticated
def password_change():
    """Change the logged-in user's password (FR-01, SR-01/13).

    Body: ``current_password``, ``new_password``. Re-verifies the current password,
    re-hashes the new one, and revokes the user's OTHER sessions (keeps this one).
    401 if the current password is wrong; 400 if the new one is weak or unchanged.
    """
    from ...config import Config

    body = _json()
    try:
        change_password(
            user_id=g.user_id,
            current_password=body.get("current_password", ""),
            new_password=body.get("new_password", ""),
            current_session_id=request.cookies.get(Config.SESSION_COOKIE_NAME, ""),
            source_ip=client_ip(),
        )
    except ValidationError as exc:
        return jsonify(error=exc.message), 400
    except AuthServiceError as exc:
        return jsonify(error=exc.message), exc.status
    return jsonify(status="password_changed"), 200
