"""Notifications blueprint: the customer notification bell (FR-10).

Customer-only in-app alerts (lockout, admin actions on the user/their accounts,
request outcomes). Read-tracking only — history is never deleted.
"""

from flask import Blueprint

bp = Blueprint("notifications", __name__, url_prefix="/notifications")

from . import routes  # noqa: E402,F401  (registers routes on bp)
