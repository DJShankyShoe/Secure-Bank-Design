"""SecureBank backend application package and ``create_app()`` factory.

The factory wires the security gateway in the order require:
ProxyFix (trust one proxy hop) → DB engines (three roles) → Talisman security
headers → CSRF → blueprints → generic error handlers. Nothing connects to the DB
at import time; engines are built lazily from the validated :class:`Config`.
"""

from __future__ import annotations

from typing import Optional

from flask import Flask, jsonify
from flask_wtf.csrf import CSRFError
from werkzeug.exceptions import HTTPException
from werkzeug.middleware.proxy_fix import ProxyFix

from .config import Config
from .extensions import csrf, db, talisman

# One year, per SR-02 (HSTS max-age 31536000).
_HSTS_MAX_AGE = 31_536_000


def create_app(config: Optional[Config] = None) -> Flask:
    """Build and configure the Flask application.

    Args:
        config: an already-built :class:`Config`; if ``None`` it is loaded from
            the environment and validated, failing fast on missing secrets (SR-07).

    Returns:
        A fully wired :class:`flask.Flask` app: proxy-aware, header-hardened,
        CSRF-protected, with the three role-scoped DB binds initialised.
    """
    config = config or Config.from_env()  # fail fast on missing/invalid secrets (SR-07)

    app = Flask(__name__)
    app.config.update(config.as_flask_config())
    app.extensions["securebank_config"] = config  # accessible to handlers/services

    # Behind nginx/Cloudflare: trust exactly one proxy hop's forwarded headers so
    # request.remote_addr / scheme reflect the real client, not the proxy (
    # SR-02). X-Forwarded-Proto lets Talisman's force_https work without looping.
    app.wsgi_app = ProxyFix(app.wsgi_app, x_for=1, x_proto=1, x_host=1)

    # Three least-privilege DB engines.
    db.init_engines(config)

    # In-app periodic cleanup: a daemon thread gated by a PostgreSQL advisory
    # lock so only one worker/container prunes per tick (multi-container safe). Set
    # CLEANUP_INTERVAL_SECONDS=0 to disable and use an external cron instead.
    if config.cleanup_interval_seconds > 0:
        from .services.cleanup import start_cleanup_scheduler

        start_cleanup_scheduler(config.cleanup_interval_seconds)

    # Security headers on every response (SR-02/SR-04).
    talisman.init_app(
        app,
        force_https=config.force_https,  # honours X-Forwarded-Proto via ProxyFix
        strict_transport_security=True,
        strict_transport_security_max_age=_HSTS_MAX_AGE,
        strict_transport_security_include_subdomains=True,
        session_cookie_secure=config.force_https,
        content_security_policy={"default-src": "'self'", "script-src": "'self'"},
        referrer_policy="no-referrer",
        frame_options="DENY",
        x_content_type_options=True,
    )

    # CSRF token required on all state-changing methods (SR-05).
    csrf.init_app(app)

    _register_blueprints(app)
    _register_error_handlers(app)
    _register_cli(app)

    @app.after_request
    def _no_store(response):  # noqa: ANN001,ANN202
        """Stop caches/CDNs/proxies from storing API responses (SR-03/SR-04).

        Responses can carry personalised data (balances, NRIC); this prevents a
        shared cache from serving one user's data to another.
        """
        response.headers.setdefault("Cache-Control", "no-store")
        response.headers.setdefault("Pragma", "no-cache")
        return response

    @app.get("/healthz")
    def healthz():  # noqa: ANN202 - tiny infra probe
        """Unauthenticated liveness probe for the reverse proxy/orchestrator."""
        return jsonify(status="ok"), 200

    return app


def _register_cli(app: Flask) -> None:
    """Register maintenance CLI commands (cleanup, scheduled out-of-band)."""

    @app.cli.command("cleanup")
    def cleanup_command() -> None:
        """Prune expired idempotency/email-change records and old auth attempts."""
        from .services.cleanup import run_cleanup

        counts = run_cleanup()
        print(f"cleanup complete: {counts}")


def _register_blueprints(app: Flask) -> None:
    """Register every business-area blueprint."""
    from .blueprints.accounts import bp as accounts_bp
    from .blueprints.admin import bp as admin_bp
    from .blueprints.auth import bp as auth_bp
    from .blueprints.transactions import bp as transactions_bp

    app.register_blueprint(auth_bp)
    app.register_blueprint(accounts_bp)
    app.register_blueprint(transactions_bp)
    app.register_blueprint(admin_bp)


def _register_error_handlers(app: Flask) -> None:
    """Single generic error shape; never leak internals (NFR-03).

    Full detail is logged server-side; the client only sees a plain-language
    message and the right status code. CSRF failures map to 403 (SR-05).
    """

    @app.errorhandler(CSRFError)
    def _handle_csrf(_e: CSRFError):
        return jsonify(error="CSRF validation failed."), 403

    @app.errorhandler(HTTPException)
    def _handle_http(e: HTTPException):
        return jsonify(error=e.name), e.code or 500

    @app.errorhandler(Exception)
    def _handle_unexpected(_e: Exception):
        app.logger.exception("Unhandled application error")  # server-side only, no secrets
        return jsonify(error="Internal server error."), 500
