"""Server-side allowlist input validation (SR-06 step 4).

Every field is validated against an explicit allowlist **before** business logic.
Validators return the normalised value or raise :class:`ValidationError` with a
plain-language, user-safe message (NFR-03) — never a stack trace or internal code.
These run on the user's own input, so a specific format message is fine here; the
anti-enumeration "generic error" rule (SR-09) applies to *auth outcomes*, not to
input-format feedback.
"""

from __future__ import annotations

import re

from email_validator import EmailNotValidError, validate_email as _validate_email

from ..config import Config


class ValidationError(ValueError):
    """Raised when input fails allowlist validation. ``message`` is user-safe."""

    def __init__(self, message: str) -> None:
        super().__init__(message)
        self.message = message


# Singapore NRIC: prefix letter, 7 digits, checksum letter (9 chars).
_NRIC_RE = re.compile(r"^[STFGM]\d{7}[A-Z]$")
_ACCOUNT_NO_RE = re.compile(r"^\d{10}$")
_DIGITS_6_RE = re.compile(r"^\d{6}$")
_NAME_RE = re.compile(r"^[A-Za-z][A-Za-z .,'\-]*$")


def validate_email(raw: str) -> str:
    """Validate + normalise an email (RFC 5322, SR-06). Returns lowercased address.

    Deliverability/DNS is not checked (no network dependency in the hot path);
    format and normalisation only.
    """
    if not isinstance(raw, str) or len(raw) > 254:
        raise ValidationError("Email address is invalid.")
    try:
        result = _validate_email(raw, check_deliverability=False)
    except EmailNotValidError:
        raise ValidationError("Email address is invalid.") from None
    return result.normalized.lower()


def validate_password(raw: str) -> str:
    """Enforce the FR-01 password policy: >=12 chars, mixed case, digit, symbol.

    Upper-bounded by ``Config.MAX_PASSWORD_LENGTH`` to cap hashing cost (SR-06).
    """
    if not isinstance(raw, str):
        raise ValidationError("Password is invalid.")
    if len(raw) < Config.PASSWORD_MIN_LENGTH or len(raw) > Config.MAX_PASSWORD_LENGTH:
        raise ValidationError(
            f"Password must be {Config.PASSWORD_MIN_LENGTH}-"
            f"{Config.MAX_PASSWORD_LENGTH} characters."
        )
    if not re.search(r"[a-z]", raw):
        raise ValidationError("Password must include a lowercase letter.")
    if not re.search(r"[A-Z]", raw):
        raise ValidationError("Password must include an uppercase letter.")
    if not re.search(r"\d", raw):
        raise ValidationError("Password must include a digit.")
    if not re.search(r"[^A-Za-z0-9]", raw):
        raise ValidationError("Password must include a symbol.")
    return raw


def validate_full_name(raw: str) -> str:
    """Validate a display name: non-empty, <=120 chars, letters/space/.,'- only."""
    if not isinstance(raw, str):
        raise ValidationError("Name is invalid.")
    value = raw.strip()
    if not value or len(value) > Config.MAX_NAME_LENGTH:
        raise ValidationError(f"Name must be 1-{Config.MAX_NAME_LENGTH} characters.")
    if not _NAME_RE.match(value):
        raise ValidationError("Name contains invalid characters.")
    return value


def validate_nric(raw: str) -> str:
    """Validate + normalise a Singapore NRIC (9 chars). Returns upper-cased value."""
    if not isinstance(raw, str):
        raise ValidationError("NRIC is invalid.")
    value = raw.strip().upper()
    if not _NRIC_RE.match(value):
        raise ValidationError("NRIC format is invalid.")
    return value


def validate_account_type(raw: str) -> str:
    """Validate an account type against the allowlist (FR-02, SR-06)."""
    if raw not in ("savings", "current"):
        raise ValidationError("Account type must be 'savings' or 'current'.")
    return raw


def validate_account_number(raw: str) -> str:
    """Validate a 10-digit account number (SR-06, FR-02)."""
    if not isinstance(raw, str) or not _ACCOUNT_NO_RE.match(raw):
        raise ValidationError("Account number is invalid.")
    return raw


def validate_transaction_pin(raw: str) -> str:
    """Validate a 6-digit transaction PIN (SR-12)."""
    if not isinstance(raw, str) or not _DIGITS_6_RE.match(raw):
        raise ValidationError("PIN must be 6 digits.")
    return raw


def validate_totp_code(raw: str) -> str:
    """Validate a 6-digit TOTP code (SR-11)."""
    if not isinstance(raw, str) or not _DIGITS_6_RE.match(raw):
        raise ValidationError("Authentication code is invalid.")
    return raw


def validate_amount_cents(value: object) -> int:
    """Validate a positive money amount in minor units, within bounds (SR-06).

    Accepts an ``int`` (or integral value); rejects floats/strings to avoid money
    rounding issues. Range: 1.. ``Config.MAX_TRANSFER_CENTS``.
    """
    if isinstance(value, bool) or not isinstance(value, int):
        raise ValidationError("Amount is invalid.")
    if value <= 0 or value > Config.MAX_TRANSFER_CENTS:
        raise ValidationError("Amount is out of range.")
    return value
