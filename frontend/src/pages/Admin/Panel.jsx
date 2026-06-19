import React from 'react';

export default function AdminPanel() {
  const handleSuspend = (userId) => {
    // TODO (Backend):
    // 1. Verify caller has @require_role('admin') (SR-13).
    // 2. Update user status to 'locked'.
    // 3. Log action to audit_events (SR-14).
    console.log(`Mock Suspend User: ${userId}`);
  };

  return (
    <section className="section">
      <div className="section-header">
        <div>
          <h2 className="section-title">Admin Operations View</h2>
          <div className="helper-text">Operational access for authorised staff only.</div>
        </div>
      </div>

      <div className="admin-grid">
        <div className="content-card">
          <h3 className="card-title">Operational Overview</h3>
          <div className="card-grid" style={{ gridTemplateColumns: "repeat(2, minmax(0, 1fr))", marginTop: "12px" }}>
            <div className="admin-stat">
              <div className="table-muted">Flagged Accounts</div>
              <div className="metric-value">14</div>
            </div>
            <div className="admin-stat">
              <div className="table-muted">Lockouts Today</div>
              <div className="metric-value">5</div>
            </div>
          </div>
          
          <div className="hero-actions" style={{ marginTop: '24px' }}>
            {/* Mocking a suspend action button for testing */}
            <button className="secondary-button" onClick={() => handleSuspend('user_123')} style={{ borderColor: '#d93025', color: '#d93025' }}>
              Suspend Flagged User
            </button>
          </div>
        </div>

        <div className="content-card">
          <h3 className="card-title">Recent Audit Log Entries</h3>
          {/* TODO (Backend): Fetch from audit_events table using admin_reader role. Ensure PII remains masked. */}
          <div className="log-row">
            <div>
              <strong>High-value transfer pending PIN</strong>
              <div className="helper-text">customer_id: 8812 · 203.116.12.77</div>
            </div>
            <div style={{ textAlign: "right" }}>
              <div>2026-05-24 09:42 UTC</div>
              <span className="tag warning">Awaiting verification</span>
            </div>
          </div>
          
          <div className="log-row">
            <div>
              <strong>Failed MFA challenge</strong>
              <div className="helper-text">customer_id: 8812 · 203.116.12.77</div>
            </div>
            <div style={{ textAlign: "right" }}>
              <div>2026-05-24 09:12 UTC</div>
              <span className="tag danger">Blocked after 3 attempts</span>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}