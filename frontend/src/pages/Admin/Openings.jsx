import React, { useState } from 'react';

export default function AdminOpenings() {
  const [requests, setRequests] = useState([
    { id: 'req_301', name: 'Alice Lim', nric: 'T****889C', type: 'savings', requestedAt: '2026-05-24 09:30:00' }
  ]);

  const handleAction = (reqId, action) => {
    if (action === 'approve' && !window.confirm("Approve account?")) return;
    if (action === 'reject' && !prompt("Reason for rejection?")) return;
    
    // TODO (Backend): POST /admin/accounts/requests/{id}/{approve|reject}
    setRequests(requests.filter(r => r.id !== reqId));
  };

  return (
    <div className="content-card">
      <h2 style={{ marginBottom: '24px' }}>Account Openings</h2>
      <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
        <thead>
          <tr style={{ borderBottom: '2px solid #E5E7EB', color: '#4B5563' }}>
            <th style={{ padding: '12px 8px' }}>Applicant</th>
            <th style={{ padding: '12px 8px' }}>Requested Type</th>
            <th style={{ padding: '12px 8px' }}>Date</th>
            <th style={{ padding: '12px 8px', textAlign: 'right' }}>Actions</th>
          </tr>
        </thead>
        <tbody>
          {requests.map(req => (
            <tr key={req.id} style={{ borderBottom: '1px solid #E5E7EB' }}>
              <td style={{ padding: '12px 8px' }}><strong>{req.name}</strong><br/><span style={{ fontFamily: 'monospace', fontSize: '0.85rem' }}>{req.nric}</span></td>
              <td style={{ padding: '12px 8px', textTransform: 'capitalize' }}>{req.type}</td>
              <td style={{ padding: '12px 8px', color: '#6B7280' }}>{req.requestedAt}</td>
              <td style={{ padding: '12px 8px', textAlign: 'right' }}>
                <button onClick={() => handleAction(req.id, 'approve')} style={{ color: '#059669', background: 'none', border: 'none', cursor: 'pointer', fontWeight: '600', marginRight: '16px' }}>Approve</button>
                <button onClick={() => handleAction(req.id, 'reject')} style={{ color: '#DC2626', background: 'none', border: 'none', cursor: 'pointer', fontWeight: '600' }}>Reject</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}