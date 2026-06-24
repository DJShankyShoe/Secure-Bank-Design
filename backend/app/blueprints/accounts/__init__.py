"""Accounts blueprint."""

from flask import Blueprint

bp = Blueprint("accounts", __name__, url_prefix="/accounts")
