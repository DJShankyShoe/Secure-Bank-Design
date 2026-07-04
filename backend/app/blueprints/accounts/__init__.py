"""Accounts blueprint."""

from flask import Blueprint

bp = Blueprint("accounts", __name__, url_prefix="/accounts")

from . import routes  # noqa: E402,F401  (registers routes on bp)
