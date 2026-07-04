"""Admin blueprint: list accounts, suspend/unlock users, read audit log, admin
close (FR-08, SR-14). Admin actions are RBAC-gated and audited. Routes added later.
"""

from flask import Blueprint

bp = Blueprint("admin", __name__, url_prefix="/admin")

from . import routes  # noqa: E402,F401  (registers routes on bp)
