import React, { useState } from 'react';

export default function AdminClosures() {
  const [closures, setClosures] = useState([
    { id: 'acc_202', number: '9876543210', owner: 'Mary Tan', nric: 'S****456B', type: 'current', balance: 0.00, requestedAt: '2026-05-23 14:15:00' }
  ]);

  const handleAction = (accId, action) => {
    if (action === 'approve' && !window.confirm("Approve closure? Ensure balance is 0.")) return;
    if (action === 'reject' && !prompt("Reason for rejection?")) return;
    
    // TODO (Backend): POST /admin/accounts/{id}/closure/{approve|reject}
    setClosures(closures.filter(r => r.id !== accId));
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
          {closures.map(req => (
            <tr key={req.id} style={{ borderBottom: '1px solid #E5E7EB' }}>
              <td style={{ padding: '12px 8px', fontFamily: 'monospace' }}>{req.number}</td>
              <td style={{ padding: '12px 8px', textTransform: 'capitalize' }}>{req.type}</td>
              <td style={{ padding: '12px 8px' }}>
                <strong>{req.owner}</strong><br/>
                <span style={{ fontFamily: 'monospace', fontSize: '0.85rem' }}>{req.nric}</span>
              </td>
              <td style={{ padding: '12px 8px', textAlign: 'right', fontFamily: 'monospace', color: req.balance === 0 ? '#059669' : '#DC2626' }}>
                SGD {req.balance.toFixed(2)}
              </td>
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