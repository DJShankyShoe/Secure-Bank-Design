import React, { useState } from 'react';

export default function AdminAudit() {
  const [logs] = useState([
    { id: '1', timestamp: '2026-05-24 10:00:00', type: 'LOGIN_SUCCESS', actor: 'John Doe', target: '-', outcome: 'success' },
    { id: '2', timestamp: '2026-05-24 10:15:00', type: 'FUND_TRANSFER', actor: 'John Doe', target: 'External Biller', outcome: 'success' },
    { id: '3', timestamp: '2026-05-24 14:22:00', type: 'ACCOUNT_SUSPENDED', actor: 'System Admin', target: 'Mary Tan', outcome: 'success' }
  ]);
  
  const [filters, setFilters] = useState({ type: '', user: '' });
  const [applied, setApplied] = useState({ type: '', user: '' });

  const handleFilter = (e) => {
    e.preventDefault();
    setApplied(filters);
    // TODO (Backend): GET /admin/audit?page=1&type=...
  };

  const filteredLogs = logs.filter(log => {
    const matchType = !applied.type || log.type.toLowerCase().includes(applied.type.toLowerCase());
    const matchUser = !applied.user || log.actor.toLowerCase().includes(applied.user.toLowerCase()) || log.target.toLowerCase().includes(applied.user.toLowerCase());
    return matchType && matchUser;
  });

  return (
    <div className="content-card">
      <h2 style={{ marginBottom: '16px' }}>System Audit Logs</h2>
      
      <form onSubmit={handleFilter} style={{ display: 'flex', gap: '16px', marginBottom: '24px', padding: '16px', backgroundColor: '#F9FAFB', borderRadius: '8px' }}>
        <input 
          type="text" 
          placeholder="Event Type" 
          value={filters.type} 
          onChange={e => setFilters({...filters, type: e.target.value})} 
          style={{ padding: '8px', flex: 1 }} 
        />
        <input 
          type="text" 
          placeholder="Search User..." 
          value={filters.user} 
          onChange={e => setFilters({...filters, user: e.target.value})} 
          style={{ padding: '8px', flex: 1 }} 
        />
        <button type="submit" className="primary-button" style={{ padding: '8px 24px', backgroundColor: '#111827', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer' }}>Filter</button>
      </form>

      <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
        <thead>
          <tr style={{ borderBottom: '2px solid #E5E7EB', color: '#4B5563' }}>
            <th style={{ padding: '12px 8px' }}>Timestamp (GMT+8)</th>
            <th style={{ padding: '12px 8px' }}>Event</th>
            <th style={{ padding: '12px 8px' }}>User</th>
            <th style={{ padding: '12px 8px' }}>Details</th>
            <th style={{ padding: '12px 8px' }}>Outcome</th>
          </tr>
        </thead>
        <tbody>
          {filteredLogs.map(log => (
            <tr key={log.id} style={{ borderBottom: '1px solid #E5E7EB' }}>
              <td style={{ padding: '12px 8px', color: '#6B7280' }}>{log.timestamp}</td>
              <td style={{ padding: '12px 8px', fontWeight: '600' }}>{log.type}</td>
              <td style={{ padding: '12px 8px' }}>{log.actor}</td>
              <td style={{ padding: '12px 8px' }}>{log.target}</td>
              <td style={{ padding: '12px 8px', color: log.outcome === 'success' ? '#059669' : '#DC2626' }}>{log.outcome.toUpperCase()}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}