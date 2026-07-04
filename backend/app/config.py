"""Centralised application configuration (SR-07).

All secrets and tunables come from environment variables (loaded via
python-dotenv). The module **fails fast** at startup if any required variable is
missing or malformed, so the app can never boot in an insecurely half-configured
state (SR-07). No secret or security threshold is hard-coded at a call site — the
single source for every knob (PIN threshold, lockout count, session timeouts,
Argon2 params, …) is the ``Config`` object built here.

Decision references (resolved 2026-06-23, see Decision Log):
* PIN threshold is ``>=`` SGD 1,000 → ``PIN_THRESHOLD_CENTS = 100_000``.
* PIN attempt limits: 3/transaction + 5/hour, and failures also count toward the
  SR-09 account lockout.
* Argon2 PIN params are distinct from the password params.
"""

from __future__ import annotations

import base64
import binascii
from dataclasses import dataclass
from datetime import timedelta
from typing import ClassVar, Mapping, Optional

from dotenv import load_dotenv

# Load a local .env if present; real process environment always takes precedence.
load_dotenv()


class ConfigError(RuntimeError):
    """Raised when required configuration is missing or invalid (fail fast, SR-07)."""


# Variables that MUST be present and non-empty for the app to start (SR-07).
# SMTP_USER / SMTP_PASSWORD are intentionally optional (unauthenticated relays).
_REQUIRED_VARS: tuple[str, ...] = (
    "FLASK_SECRET_KEY",
    "DATABASE_URL_APP",
    "DATABASE_URL_AUDIT_WRITER",
    "DATABASE_URL_ADMIN_READER",
    "AES_ENCRYPTION_KEY",
    "SMTP_HOST",
    "SMTP_PORT",
    "SMTP_FROM",
    "TOTP_ISSUER",
)

_AES_KEY_BYTES = 32  # AES-256 → 32-byte key (SR-03; never Fernet/AES-128).


def _require(env: Mapping[str, str], name: str) -> str:
    """Return a required env var's value or raise ``ConfigError`` (fail fast)."""
    value = env.get(name, "")
    if not value or not value.strip():
        raise ConfigError(f"Required environment variable {name!r} is missing or empty.")
    return value


def _optional(env: Mapping[str, str], name: str) -> Optional[str]:
    """Return an optional env var's value, or ``None`` if unset/empty."""
    value = env.get(name, "")
    return value if value and value.strip() else None


def _as_bool(value: Optional[str], default: bool) -> bool:
    """Parse a truthy/falsey env string; fall back to ``default`` when unset."""
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "yes", "on"}


def _as_int(value: Optional[str], default: int, name: str) -> int:
    """Parse a non-negative int env var, falling back to ``default`` when unset."""
    if value is None or not value.strip():
        return default
    try:
        parsed = int(value)
    except ValueError as exc:
        raise ConfigError(f"{name} must be an integer.") from exc
    if parsed < 0:
        raise ConfigError(f"{name} must be >= 0.")
    return parsed


@dataclass(frozen=True)
class Config:
    """Immutable, validated application configuration.

    Instance fields are sourced from the environment and validated at
    construction. Class-level ``ClassVar`` constants are the centralised security
    thresholds — change them here, never inline at call sites. Construct via
    :meth:`from_env`, which performs the fail-fast validation (SR-07).
    """

    # ── Secrets / connection strings (from env) ──────────────────────────────
    secret_key: str
    database_url_app: str
    database_url_audit_writer: str
    database_url_admin_reader: str
    aes_encryption_key: bytes  # decoded, validated to be exactly 32 bytes
    smtp_host: str
    smtp_port: int
    smtp_user: Optional[str]
    smtp_password: Optional[str]
    smtp_from: str
    totp_issuer: str
    force_https: bool
    frontend_base_url: str  # origin of the SPA; used to build clickable email links (FR-04/09)
    cleanup_interval_seconds: int  # in-app prune cadence; 0 disables (use external cron)

    # ── Centralised security thresholds / tunables ────────────────
    # Money is integer minor units (cents); never float.
    PIN_THRESHOLD_CENTS: ClassVar[int] = 100_000   # >= SGD 1,000 needs PIN (FR-06/SR-12)
    ACCOUNT_LOCKOUT_THRESHOLD: ClassVar[int] = 5   # consecutive auth fails → lock (SR-09)
    LOCKOUT_UNLOCK_TTL: ClassVar[timedelta] = timedelta(minutes=30)  # email-unlink TTL (SR-09)

    SESSION_IDLE_TIMEOUT: ClassVar[timedelta] = timedelta(minutes=15)   # SR-13
    SESSION_ABSOLUTE_LIFETIME: ClassVar[timedelta] = timedelta(hours=8)  # SR-13
    MFA_PENDING_TOKEN_TTL: ClassVar[timedelta] = timedelta(minutes=5)    # stage-1 token
    EMAIL_VERIFY_TOKEN_TTL: ClassVar[timedelta] = timedelta(minutes=30)  # email re-verify (FR-04)
    SIGNUP_EMAIL_TOKEN_TTL: ClassVar[timedelta] = timedelta(hours=24)  # signup verify (FR-01)

    IDEMPOTENCY_TTL: ClassVar[timedelta] = timedelta(hours=24)  # SR-08

    TOTP_RATE_LIMIT_PER_MIN: ClassVar[int] = 5    # TOTP attempts/min/account (SR-11)
    PIN_ATTEMPTS_PER_TXN: ClassVar[int] = 3       # PIN tries per transaction (SR-12)
    PIN_ATTEMPTS_PER_HOUR: ClassVar[int] = 5      # PIN tries/hour/account (SR-12)
    EMAIL_ACTION_LIMIT_PER_HOUR: ClassVar[int] = 10  # email-change/reset/unlock req/hr/account

    # Argon2id parameters — password and PIN MUST differ (SR-01/SR-12).
    ARGON2_PASSWORD_TIME_COST: ClassVar[int] = 3
    ARGON2_PASSWORD_MEMORY_KIB: ClassVar[int] = 65536   # 64 MB (SR-01)
    ARGON2_PASSWORD_PARALLELISM: ClassVar[int] = 1
    ARGON2_PIN_TIME_COST: ClassVar[int] = 2
    ARGON2_PIN_MEMORY_KIB: ClassVar[int] = 32768        # 32 MB (distinct)
    ARGON2_PIN_PARALLELISM: ClassVar[int] = 1

    # Data-access layer: small pool + 5-second statement timeout (SR-10).
    DB_POOL_SIZE: ClassVar[int] = 10
    DB_STATEMENT_TIMEOUT_MS: ClassVar[int] = 5000

    # Domain constants.
    MAX_TRANSFER_CENTS: ClassVar[int] = 1_000_000_000  # SGD 10,000,000 upper bound (SR-06)
    MAX_NAME_LENGTH: ClassVar[int] = 120               # matches users.full_name
    MAX_PASSWORD_LENGTH: ClassVar[int] = 128           # cap to bound hashing cost (SR-06)
    ACCOUNT_NUMBER_LENGTH: ClassVar[int] = 10          # FR-02
    TRANSACTION_HISTORY_PAGE_SIZE: ClassVar[int] = 25  # FR-03
    PASSWORD_MIN_LENGTH: ClassVar[int] = 12            # FR-01
    TRANSACTION_PIN_LENGTH: ClassVar[int] = 6          # SR-12
    MAX_CONTENT_BYTES: ClassVar[int] = 1_048_576       # 1 MB request-body cap (defence-in-depth)

    # Session cookie flags (SR-13). The cookie only carries the opaque session id;
    # the session itself lives server-side.
    SESSION_COOKIE_NAME: ClassVar[str] = "sb_session"
    SESSION_COOKIE_SAMESITE: ClassVar[str] = "Strict"
    # Flask's OWN signed-session cookie (used only to hold the Flask-WTF CSRF
    # secret) MUST have a different name from the server-side session cookie above,
    # or MFA login (which sets sb_session to the opaque server token) would clobber
    # the CSRF state and every later POST would fail CSRF (SR-05).
    CSRF_SESSION_COOKIE_NAME: ClassVar[str] = "sb_csrf"

    @classmethod
    def from_env(cls, env: Optional[Mapping[str, str]] = None) -> "Config":
        """Build and validate a ``Config`` from ``env`` (defaults to ``os.environ``).

        Raises ``ConfigError`` if any required variable is missing/empty, the AES
        key is not base64 of exactly 32 bytes, or ``SMTP_PORT`` is not an integer.
        This is the fail-fast gate the app factory calls at startup (SR-07).
        """
        if env is None:
            import os

            env = os.environ

        # Presence check first so the error names every missing variable clearly.
        missing = [name for name in _REQUIRED_VARS if not (env.get(name) or "").strip()]
        if missing:
            raise ConfigError(
                "Missing required environment variable(s): " + ", ".join(sorted(missing))
            )

        aes_key = cls._decode_aes_key(_require(env, "AES_ENCRYPTION_KEY"))

        smtp_port_raw = _require(env, "SMTP_PORT")
        try:
            smtp_port = int(smtp_port_raw)
        except ValueError as exc:
            raise ConfigError(f"SMTP_PORT must be an integer, got {smtp_port_raw!r}.") from exc
        if not (0 < smtp_port < 65536):
            raise ConfigError(f"SMTP_PORT out of range: {smtp_port}.")

        return cls(
            secret_key=_require(env, "FLASK_SECRET_KEY"),
            database_url_app=_require(env, "DATABASE_URL_APP"),
            database_url_audit_writer=_require(env, "DATABASE_URL_AUDIT_WRITER"),
            database_url_admin_reader=_require(env, "DATABASE_URL_ADMIN_READER"),
            aes_encryption_key=aes_key,
            smtp_host=_require(env, "SMTP_HOST"),
            smtp_port=smtp_port,
            smtp_user=_optional(env, "SMTP_USER"),
            smtp_password=_optional(env, "SMTP_PASSWORD"),
            smtp_from=_require(env, "SMTP_FROM"),
            totp_issuer=_require(env, "TOTP_ISSUER"),
            force_https=_as_bool(_optional(env, "FORCE_HTTPS"), default=True),
            frontend_base_url=(
                _optional(env, "FRONTEND_BASE_URL") or "https://securebang.space"
            ).rstrip("/"),
            cleanup_interval_seconds=_as_int(
                _optional(env, "CLEANUP_INTERVAL_SECONDS"), default=3600,
                name="CLEANUP_INTERVAL_SECONDS"),
        )

    @staticmethod
    def _decode_aes_key(raw: str) -> bytes:
        """Decode the base64 AES key and enforce a 32-byte (AES-256) length (SR-03)."""
        try:
            key = base64.b64decode(raw, validate=True)
        except (binascii.Error, ValueError) as exc:
            raise ConfigError("AES_ENCRYPTION_KEY is not valid base64.") from exc
        if len(key) != _AES_KEY_BYTES:
            raise ConfigError(
                f"AES_ENCRYPTION_KEY must decode to {_AES_KEY_BYTES} bytes "
                f"(AES-256), got {len(key)}."
            )
        return key

    def as_flask_config(self) -> dict[str, object]:
        """Return the subset of settings consumed directly by ``app.config`` (SR-13).

        Cookie flags enforce Secure + HttpOnly + SameSite=Strict. ``Secure`` is
        tied to ``force_https`` so local http dev can still set the cookie.
        """
        return {
            "SECRET_KEY": self.secret_key,
            # Flask's signed session (CSRF secret only) — distinct name from the
            # server-side session cookie so login can't overwrite the CSRF state.
            "SESSION_COOKIE_NAME": self.CSRF_SESSION_COOKIE_NAME,
            "SESSION_COOKIE_HTTPONLY": True,
            "SESSION_COOKIE_SECURE": self.force_https,
            "SESSION_COOKIE_SAMESITE": self.SESSION_COOKIE_SAMESITE,
            "PERMANENT_SESSION_LIFETIME": self.SESSION_ABSOLUTE_LIFETIME,
            "MAX_CONTENT_LENGTH": self.MAX_CONTENT_BYTES,  # reject oversized bodies → 413
        }
