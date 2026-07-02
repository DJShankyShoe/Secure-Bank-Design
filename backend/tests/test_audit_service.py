"""Tests for the audit emitter (: audit events emitted; SR-14)."""

from __future__ import annotations

import uuid

import pytest

from app.services.audit import emit_audit


def test_emit_audit_writes_readable_event(require_db, app):
    from sqlalchemy import text

    from app.extensions import db

    marker = uuid.uuid4().hex
    actor = uuid.uuid4()
    with app.app_context():
        emit_audit(
            "REGISTER",
            "success",
            source_ip="203.0.113.7",
            actor_user_id=actor,
            actor_role="customer",
            action_detail={"marker": marker, "nric_masked": "S****1A"},
        )

    # Read it back via the admin_reader (SELECT-only) engine.
    with db.admin_reader_engine.connect() as conn:
        row = conn.execute(
            text(
                "SELECT event_type, outcome, actor_user_id, actor_role, source_ip, "
                "action_detail->>'marker' AS marker "
                "FROM audit.audit_events WHERE action_detail->>'marker' = :m"
            ),
            {"m": marker},
        ).one()
    assert row.event_type == "REGISTER"
    assert row.outcome == "success"
    assert str(row.actor_user_id) == str(actor)
    assert row.actor_role == "customer"
    assert row.marker == marker


def test_emit_audit_rejects_bad_outcome(app):
    with app.app_context():
        with pytest.raises(ValueError):
            emit_audit("X", "totally-invalid", source_ip="203.0.113.7")
