"""Shared extension singletons and the three least-privilege DB binds.

. We use **raw SQLAlchemy** (Flask-SQLAlchemy is not an
approved dependency): three separate engines, one per DB role, so the
PostgreSQL privilege boundary (SR-14) is reflected in the app's connection layer.

* ``app_engine``          — role ``app_user``: application + session schemas (CRUD).
* ``audit_writer_engine`` — role ``audit_writer``: audit schema, INSERT only.
* ``admin_reader_engine`` — role ``admin_reader``: audit schema, SELECT only.

Every engine uses a small pool (≈10) and a 5-second ``statement_timeout`` so a
slow query can't exhaust ``max_connections`` (SR-10 / threat T-22). All
shared state lives in PostgreSQL, never in process memory (NFR-04).

``csrf`` (Flask-WTF) and ``talisman`` (Flask-Talisman) are created here and bound
to the app in the factory (SR-04/SR-05).
"""

from __future__ import annotations

from typing import Optional

from flask_talisman import Talisman
from flask_wtf import CSRFProtect
from sqlalchemy import create_engine
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session, sessionmaker

from .config import Config

# Bound to the app in create_app(). Talisman config (HSTS/CSP/…) is passed there.
csrf = CSRFProtect()
talisman = Talisman()


def _make_engine(
    dsn: str,
    *,
    pool_size: int,
    statement_timeout_ms: int,
    read_only: bool = False,
) -> Engine:
    """Build a pooled engine with a hard statement timeout (SR-10).

    The timeout (and, for the read-only audit reader, a session-level
    ``default_transaction_read_only``) is pushed to PostgreSQL via libpq
    ``options`` so it applies to every connection in the pool. ``pool_pre_ping``
    drops stale connections so horizontally-scaled instances stay healthy (NFR-04).
    """
    pg_options = f"-c statement_timeout={statement_timeout_ms}"
    if read_only:
        # Defence in depth on top of the SELECT-only grant for admin_reader.
        pg_options += " -c default_transaction_read_only=on"
    return create_engine(
        dsn,
        pool_size=pool_size,
        max_overflow=0,          # hard cap the pool; never exceed ~10
        pool_pre_ping=True,
        pool_recycle=1800,
        future=True,
        connect_args={"options": pg_options},
    )


class Database:
    """Holds the three role-scoped engines and their session factories.

    Built once per process from :class:`~app.config.Config` in the app factory.
    Use :attr:`app_session` for business + session-schema work, :attr:`writer`
    helpers in the audit emitter (its own connection, independent of the business
    transaction —), and:attr:`admin_reader_session` for audit review.
    """

    def __init__(self) -> None:
        self.app_engine: Optional[Engine] = None
        self.audit_writer_engine: Optional[Engine] = None
        self.admin_reader_engine: Optional[Engine] = None
        self.app_session: Optional[sessionmaker[Session]] = None
        self.admin_reader_session: Optional[sessionmaker[Session]] = None

    def init_engines(self, config: Config) -> None:
        """Create all three engines and session factories from validated config."""
        self.app_engine = _make_engine(
            config.database_url_app,
            pool_size=Config.DB_POOL_SIZE,
            statement_timeout_ms=Config.DB_STATEMENT_TIMEOUT_MS,
        )
        self.audit_writer_engine = _make_engine(
            config.database_url_audit_writer,
            pool_size=Config.DB_POOL_SIZE,
            statement_timeout_ms=Config.DB_STATEMENT_TIMEOUT_MS,
        )
        self.admin_reader_engine = _make_engine(
            config.database_url_admin_reader,
            pool_size=Config.DB_POOL_SIZE,
            statement_timeout_ms=Config.DB_STATEMENT_TIMEOUT_MS,
            read_only=True,
        )
        # expire_on_commit=False so receipt/response data stays usable after commit.
        self.app_session = sessionmaker(
            bind=self.app_engine, expire_on_commit=False, future=True
        )
        self.admin_reader_session = sessionmaker(
            bind=self.admin_reader_engine, expire_on_commit=False, future=True
        )

    def dispose(self) -> None:
        """Dispose all pools (used in tests / graceful shutdown)."""
        for engine in (self.app_engine, self.audit_writer_engine, self.admin_reader_engine):
            if engine is not None:
                engine.dispose()


# Process-wide singleton; engines are initialised in create_app().
db = Database()
