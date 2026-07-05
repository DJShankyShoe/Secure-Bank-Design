"""Superadmin blueprint: role assignment + admin management (FR-08, SR-13/14).

Distinct from ``admin`` — a superadmin manages admins and roles only, not customer
data. Every route is RBAC-gated by ``@require_role('superadmin')`` and audited.
"""

from flask import Blueprint

bp = Blueprint("superadmin", __name__, url_prefix="/superadmin")

from . import routes  # noqa: E402,F401  (registers routes on bp)
