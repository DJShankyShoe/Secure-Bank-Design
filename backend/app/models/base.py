"""Declarative base shared by all SecureBank ORM models.

Models are schema-qualified (``application`` / ``session`` / ``audit``) via each
model's ``__table_args__`` ``schema`` key. Which DB role/engine actually executes
a statement is decided by the *session* used (see ``app.extensions``), not by the
mapping — that is how one ORM layer serves the three privilege-separated binds.

Indexes are owned by the authoritative DDL in ``backend/sql/`` (already applied);
the models below mirror columns, types, keys, defaults and CHECK constraints.
"""

from __future__ import annotations

from sqlalchemy.orm import DeclarativeBase


class Base(DeclarativeBase):
    """Base class carrying the shared metadata for every model."""
