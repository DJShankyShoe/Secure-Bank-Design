import React, { useState, useEffect } from 'react';
import { api } from '../../api/api';
import { toast, confirm, promptReason } from '../../ui/notify.jsx';

export default function AdminOpenings() {
  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    try {
      // No dedicated "pending openings" endpoint: pull all accounts, keep the
      // open_requested ones, and join owner details from the user directory.
      const [accRes, userRes] = await Promise.all([api.getAdminAccounts(), api.getUsers()]);
      const userById = Object.fromEntries((userRes.users || []).map((u) => [u.user_id, u]));
      const pending = (accRes.accounts || [])
        .filter((a) => a.status === 'open_requested')
        .map((a) => ({ ...a, owner: userById[a.user_id] || {} }));
      setRequests(pending);
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
          title: 'Approve account opening',
          message: 'Approve this account opening request?',
        });
        if (!ok) return;
        await api.approveOpening(accountId);
        toast.success('Account opening approved.');
      } else {
        const reason = await promptReason({
          title: 'Reject account opening',
          message: 'Provide a reason for rejecting this opening request.',
          label: 'Reason',
          danger: true,
          confirmText: 'Reject',
        });
        if (reason === null) return;
        await api.rejectOpening(accountId, reason);
        toast.success('Opening request rejected.');
      }
      setRequests((prev) => prev.filter((r) => r.account_id !== accountId));
    } catch (err) {
      toast.error(err.message);
    }
  };

  return (
    <div className="content-card">
      <h2 style={{ marginBottom: '24px' }}>Account Openings</h2>
      <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
        <thead>
          <tr style={{ borderBottom: '2px solid #E5E7EB', color: '#4B5563' }}>
            <th style={{ padding: '12px 8px' }}>Applicant</th>
            <th style={{ padding: '12px 8px' }}>Account Number</th>
            <th style={{ padding: '12px 8px' }}>Requested Type</th>
            <th style={{ padding: '12px 8px', textAlign: 'right' }}>Actions</th>
          </tr>
        </thead>
        <tbody>
          {loading ? (
            <tr><td colSpan="4" style={{ padding: '32px', textAlign: 'center', color: '#6B7280' }}>Loading...</td></tr>
          ) : requests.length === 0 ? (
            <tr><td colSpan="4" style={{ padding: '32px', textAlign: 'center', color: '#6B7280' }}>No pending opening requests.</td></tr>
          ) : requests.map((req) => (
            <tr key={req.account_id} style={{ borderBottom: '1px solid #E5E7EB' }}>
              <td style={{ padding: '12px 8px' }}>
                <strong>{req.owner.full_name || '—'}</strong><br />
                <span style={{ fontFamily: 'monospace', fontSize: '0.85rem' }}>{req.owner.nric_masked || req.owner.email || ''}</span>
              </td>
              <td style={{ padding: '12px 8px', fontFamily: 'monospace' }}>{req.account_number}</td>
              <td style={{ padding: '12px 8px', textTransform: 'capitalize' }}>{req.account_type}</td>
              <td style={{ padding: '12px 8px', textAlign: 'right' }}>
                <button onClick={() => handleAction(req.account_id, 'approve')} style={{ color: '#059669', background: 'none', border: 'none', cursor: 'pointer', fontWeight: '600', marginRight: '16px' }}>Approve</button>
                <button onClick={() => handleAction(req.account_id, 'reject')} style={{ color: '#DC2626', background: 'none', border: 'none', cursor: 'pointer', fontWeight: '600' }}>Reject</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
