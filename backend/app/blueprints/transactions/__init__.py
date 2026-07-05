"""Transactions blueprint: fund transfer, bill payment, PIN confirm
(FR-06/07, SR-08/12). Routes added in later steps.
"""

from flask import Blueprint

bp = Blueprint("transactions", __name__, url_prefix="/transactions")

from . import routes  # noqa: E402,F401  (registers routes on bp)
