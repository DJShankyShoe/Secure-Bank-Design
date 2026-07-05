import React, { useState, useEffect } from 'react';
import { api } from '../../api/api';
import { toast, confirm, promptReason } from '../../ui/notify.jsx';

export default function AdminClosures() {
  const [closures, setClosures] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    try {
      // Pending closures = accounts in close_requested; join owner from the directory.
      const [accRes, userRes] = await Promise.all([api.getAdminAccounts(), api.getUsers()]);
      const userById = Object.fromEntries((userRes.users || []).map((u) => [u.user_id, u]));
      const pending = (accRes.accounts || [])
        .filter((a) => a.status === 'close_requested')
        .map((a) => ({ ...a, owner: userById[a.user_id] || {} }));
      setClosures(pending);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const handleAction = async (accountId, action) => {
    try {
      if (action === 'approve') {
        const ok = await confirm({
          title: 'Approve closure',
          message: 'Approve this closure request? The balance must be SGD 0.00.',
        });
        if (!ok) return;
        await api.approveClosure(accountId);
        toast.success('Closure approved.');
      } else {
        const reason = await promptReason({
          title: 'Reject closure',
          message: 'Provide a reason for rejecting this closure request.',
          label: 'Reason',
          danger: true,
          confirmText: 'Reject',
        });
        if (reason === null) return;
        await api.rejectClosure(accountId, reason);
        toast.success('Closure request rejected.');
      }
      setClosures((prev) => prev.filter((r) => r.account_id !== accountId));
    } catch (err) {
      toast.error(err.message);
    }
  };

  return (
    <div className="content-card">
      <h2 style={{ marginBottom: '24px' }}>Account Closures</h2>
      <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
        <thead>
          <tr style={{ borderBottom: '2px solid #E5E7EB', color: '#4B5563' }}>
            <th style={{ padding: '12px 8px' }}>Account Number</th>
            <th style={{ padding: '12px 8px' }}>Account Type</th>
            <th style={{ padding: '12px 8px' }}>Owner</th>
            <th style={{ padding: '12px 8px', textAlign: 'right' }}>Balance</th>
            <th style={{ padding: '12px 8px', textAlign: 'right' }}>Actions</th>
          </tr>
        </thead>
        <tbody>
          {loading ? (
            <tr><td colSpan="5" style={{ padding: '32px', textAlign: 'center', color: '#6B7280' }}>Loading...</td></tr>
          ) : closures.length === 0 ? (
            <tr><td colSpan="5" style={{ padding: '32px', textAlign: 'center', color: '#6B7280' }}>No pending closure requests.</td></tr>
          ) : closures.map((req) => {
            const balance = (req.balance_cents || 0) / 100;
            return (
              <tr key={req.account_id} style={{ borderBottom: '1px solid #E5E7EB' }}>
                <td style={{ padding: '12px 8px', fontFamily: 'monospace' }}>{req.account_number}</td>
                <td style={{ padding: '12px 8px', textTransform: 'capitalize' }}>{req.account_type}</td>
                <td style={{ padding: '12px 8px' }}>
                  <strong>{req.owner.full_name || '—'}</strong><br />
                  <span style={{ fontFamily: 'monospace', fontSize: '0.85rem' }}>{req.owner.nric_masked || req.owner.email || ''}</span>
                </td>
                <td style={{ padding: '12px 8px', textAlign: 'right', fontFamily: 'monospace', color: balance === 0 ? '#059669' : '#DC2626' }}>
                  SGD {balance.toFixed(2)}
                </td>
                <td style={{ padding: '12px 8px', textAlign: 'right' }}>
                  <button onClick={() => handleAction(req.account_id, 'approve')} style={{ color: '#059669', background: 'none', border: 'none', cursor: 'pointer', fontWeight: '600', marginRight: '16px' }}>Approve</button>
                  <button onClick={() => handleAction(req.account_id, 'reject')} style={{ color: '#DC2626', background: 'none', border: 'none', cursor: 'pointer', fontWeight: '600' }}>Reject</button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
