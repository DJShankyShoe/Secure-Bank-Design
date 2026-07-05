import React, { useState, useEffect } from 'react';

export default function AdminUsers() {
  const [expandedUser, setExpandedUser] = useState(null);
  const [revealedNricUserId, setRevealedNricUserId] = useState(null);
  const [searchTerm, setSearchTerm] = useState('');

  const [users, setUsers] = useState([
    { 
      id: 'u_101', email: 'j.doe@example.com', name: 'John Doe', nric: 'T****123A', fullNric: 'T0123123A', role: 'customer', status: 'active',
      accounts: [
        { id: 'acc_201', number: '1029384756', type: 'savings', balance: 5400.00, status: 'active' },
        { id: 'acc_203', number: '1029384799', type: 'current', balance: 1250.50, status: 'suspended' }
      ]
    },
    { 
      id: 'u_102', email: 'm.tan@example.com', name: 'Mary Tan', nric: 'S****456B', fullNric: 'S0456456B', role: 'customer', status: 'locked',
      accounts: []
    }
  ]);

  useEffect(() => {
    const handleClick = () => setRevealedNricUserId(null);
    document.addEventListener('click', handleClick);
    return () => document.removeEventListener('click', handleClick);
  }, []);

  const handleRevealNric = (e, userId) => {
    e.stopPropagation(); 
    // TODO (Backend): GET /admin/users/{id}/nric
    setRevealedNricUserId(userId);
  };

  const handleToggleUserStatus = (userId, currentStatus) => {
    const action = currentStatus === 'active' ? 'suspend' : 'unlock';
    const reason = action === 'suspend' ? prompt("Enter reason for suspension:") : true;
    
    if (!reason || (action === 'unlock' && !window.confirm("Unlock user?"))) return;
    
    // TODO (Backend): POST /admin/users/{id}/suspend OR /unlock
    setUsers(users.map(u => u.id === userId ? { ...u, status: action === 'suspend' ? 'locked' : 'active' } : u));
  };

  const handleToggleAccountStatus = (userId, accountId, currentStatus) => {
    const action = currentStatus === 'active' ? 'suspend' : 'reactivate';
    const reason = action === 'suspend' ? prompt("Enter reason to suspend this specific account:") : true;
    
    if (!reason || (action === 'reactivate' && !window.confirm("Reactivate this account?"))) return;

    // TODO (Backend): POST /admin/accounts/{id}/suspend OR /reactivate
    setUsers(users.map(u => {
      if (u.id === userId) {
        return {
          ...u,
          accounts: u.accounts.map(acc => 
            acc.id === accountId ? { ...acc, status: action === 'suspend' ? 'suspended' : 'active' } : acc
          )
        };
      }
      return u;
    }));
  };

  const filteredUsers = users.filter(user => {
    const term = searchTerm.toLowerCase();
    return (
      user.name.toLowerCase().includes(term) ||
      user.email.toLowerCase().includes(term) ||
      user.nric.toLowerCase().includes(term) ||
      user.fullNric.toLowerCase().includes(term)
    );
  });

  return (
    <div className="content-card">
      
      {/* Header with Search Bar */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
        <h2 style={{ margin: 0 }}>User Directory</h2>
        
        <div style={{ position: 'relative', width: '320px' }}>
          <svg style={{ position: 'absolute', left: '12px', top: '12px', color: '#9CA3AF' }} width="20" height="20" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"></path>
          </svg>
          <input 
            type="text" 
            placeholder="Search by name, email, or NRIC..." 
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            style={{ 
              width: '100%', 
              padding: '10px 16px 10px 40px', 
              border: '1px solid #D1D5DB', 
              borderRadius: '8px', 
              fontSize: '0.95rem',
              outline: 'none',
              boxSizing: 'border-box'
            }} 
          />
        </div>
      </div>

      <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
        <thead>
          <tr style={{ borderBottom: '2px solid #E5E7EB', color: '#4B5563' }}>
            <th style={{ padding: '12px 8px', width: '40px' }}></th>
            <th style={{ padding: '12px 8px' }}>Name & Email</th>
            <th style={{ padding: '12px 8px' }}>NRIC</th>
            <th style={{ padding: '12px 8px' }}>Status</th>
            <th style={{ padding: '12px 8px', textAlign: 'right' }}>Actions</th>
          </tr>
        </thead>
        <tbody>
          {filteredUsers.length > 0 ? (
            filteredUsers.map(user => (
              <React.Fragment key={user.id}>
                
                {/* MAIN USER ROW */}
                <tr style={{ borderBottom: expandedUser === user.id ? 'none' : '1px solid #E5E7EB', backgroundColor: expandedUser === user.id ? '#F9FAFB' : 'transparent' }}>
                  <td style={{ padding: '12px 8px' }}>
                    <button onClick={() => setExpandedUser(expandedUser === user.id ? null : user.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#6B7280' }}>
                      {expandedUser === user.id ? '▼' : '▶'}
                    </button>
                  </td>
                  <td style={{ padding: '12px 8px' }}>
                    <strong style={{ color: '#111827' }}>{user.name}</strong><br/><span style={{ fontSize: '0.85rem', color: '#6B7280' }}>{user.email}</span>
                  </td>
                  <td style={{ padding: '12px 8px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <span style={{ fontFamily: 'monospace', fontWeight: revealedNricUserId === user.id ? '700' : 'normal', color: revealedNricUserId === user.id ? '#DC2626' : '#111827' }}>
                        {revealedNricUserId === user.id ? user.fullNric : user.nric}
                      </span>
                      {revealedNricUserId !== user.id && (
                        <button onClick={(e) => handleRevealNric(e, user.id)} style={{ fontSize: '0.75rem', cursor: 'pointer', padding: '2px 6px', border: '1px solid #D1D5DB', borderRadius: '4px', background: '#FFF' }}>Reveal</button>
                      )}
                    </div>
                  </td>
                  <td style={{ padding: '12px 8px' }}>
                    <span style={{ padding: '4px 8px', borderRadius: '12px', fontSize: '0.8rem', backgroundColor: user.status === 'active' ? '#DEF7EC' : '#FEE2E2', color: user.status === 'active' ? '#03543F' : '#9B1C1C', fontWeight: '600' }}>
                      {user.status.toUpperCase()}
                    </span>
                  </td>
                  <td style={{ padding: '12px 8px', textAlign: 'right' }}>
                    <button onClick={() => handleToggleUserStatus(user.id, user.status)} style={{ color: user.status === 'active' ? '#DC2626' : '#059669', background: 'none', border: 'none', cursor: 'pointer', fontWeight: '600' }}>
                      {user.status === 'active' ? 'Suspend' : 'Unlock'}
                    </button>
                  </td>
                </tr>
                
                {/* EXPANDED ACCOUNTS ROW */}
                {expandedUser === user.id && (
                  <tr style={{ backgroundColor: '#F9FAFB', borderBottom: '1px solid #E5E7EB' }}>
                    <td colSpan="5" style={{ padding: '0 24px 24px 48px' }}>
                      <div style={{ borderLeft: '2px solid #E32636', paddingLeft: '16px', marginTop: '8px' }}>
                        <h4 style={{ margin: '0 0 12px 0', fontSize: '0.9rem', color: '#4B5563', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Associated Accounts</h4>
                        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.9rem' }}>
                          <thead>
                            <tr style={{ borderBottom: '1px solid #D1D5DB', color: '#4B5563', textAlign: 'left' }}>
                              <th style={{ padding: '8px', fontWeight: '600' }}>Account Number</th>
                              <th style={{ padding: '8px', fontWeight: '600' }}>Type</th>
                              <th style={{ padding: '8px', fontWeight: '600', textAlign: 'right' }}>Balance</th>
                              <th style={{ padding: '8px', fontWeight: '600', textAlign: 'center' }}>Status</th>
                              <th style={{ padding: '8px', fontWeight: '600', textAlign: 'right' }}>Action</th>
                            </tr>
                          </thead>
                          <tbody>
                            {user.accounts.map(acc => (
                              <tr key={acc.id} style={{ borderBottom: '1px dashed #D1D5DB' }}>
                                <td style={{ padding: '8px', fontFamily: 'monospace', color: '#111827' }}>{acc.number}</td>
                                <td style={{ padding: '8px', textTransform: 'capitalize', color: '#4B5563' }}>{acc.type}</td>
                                <td style={{ padding: '8px', fontFamily: 'monospace', color: '#111827', textAlign: 'right' }}>SGD {acc.balance.toFixed(2)}</td>
                                <td style={{ padding: '8px', textAlign: 'center' }}>
                                  <span style={{ padding: '2px 8px', borderRadius: '12px', fontSize: '0.75rem', backgroundColor: acc.status === 'active' ? '#DEF7EC' : '#FEE2E2', color: acc.status === 'active' ? '#03543F' : '#9B1C1C', fontWeight: '600' }}>
                                    {acc.status.toUpperCase()}
                                  </span>
                                </td>
                                <td style={{ padding: '8px', textAlign: 'right' }}>
                                  <button onClick={() => handleToggleAccountStatus(user.id, acc.id, acc.status)} style={{ fontSize: '0.8rem', color: acc.status === 'active' ? '#DC2626' : '#059669', background: 'transparent', border: `1px solid ${acc.status === 'active' ? '#FCA5A5' : '#6EE7B7'}`, padding: '4px 8px', borderRadius: '4px', cursor: 'pointer', fontWeight: '500' }}>
                                    {acc.status === 'active' ? 'Suspend' : 'Reactivate'}
                                  </button>
                                </td>
                              </tr>
                            ))}
                            {user.accounts.length === 0 && (
                              <tr><td colSpan="5" style={{ padding: '8px', color: '#6B7280' }}>No active accounts found.</td></tr>
                            )}
                          </tbody>
                        </table>
                      </div>
                    </td>
                  </tr>
                )}
              </React.Fragment>
            ))
          ) : (
            <tr>
              <td colSpan="5" style={{ padding: '32px', textAlign: 'center', color: '#6B7280' }}>
                No users found matching "{searchTerm}"
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}