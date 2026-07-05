"""Auth blueprint: registration, two-stage login + MFA, PIN, lockout, email
re-verification (FR-01/04/05, SR-09/11/12/13). Routes added in later steps.

Blueprint-prefixed paths (decided 2026-06-23) — nginx rate-limit
`location` blocks target these prefixes (`/auth/login`, `/auth/login/mfa`).
"""

from flask import Blueprint

bp = Blueprint("auth", __name__, url_prefix="/auth")

from . import routes  # noqa: E402,F401  (registers routes on bp)
