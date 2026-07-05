import React, { useState, useEffect } from 'react';
import { api } from '../../api/api';

export default function AdminUsers() {
  const [expandedUser, setExpandedUser] = useState(null);
  const [revealedNricUserId, setRevealedNricUserId] = useState(null);
  const [searchTerm, setSearchTerm] = useState('');

  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  // Lazy-loaded per-user data keyed by user_id: { accounts, fullNric }.
  const [details, setDetails] = useState({});

  const loadUsers = async () => {
    setLoading(true);
    try {
      const res = await api.getUsers();
      setUsers(res.users || []);
    } catch (err) {
      alert(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadUsers();
  }, []);

  useEffect(() => {
    const handleClick = () => setRevealedNricUserId(null);
    document.addEventListener('click', handleClick);
    return () => document.removeEventListener('click', handleClick);
  }, []);

  const patchDetails = (userId, patch) =>
    setDetails((prev) => ({ ...prev, [userId]: { ...prev[userId], ...patch } }));

  const handleToggleExpand = async (userId) => {
    if (expandedUser === userId) {
      setExpandedUser(null);
      return;
    }
    setExpandedUser(userId);
    // Lazy-load the user's accounts the first time the row is opened.
    if (!details[userId]?.accounts) {
      try {
        const res = await api.getUserAccounts(userId);
        patchDetails(userId, { accounts: res.accounts || [] });
      } catch (err) {
        alert(err.message);
      }
    }
  };

  const handleRevealNric = async (e, userId) => {
    e.stopPropagation();
    setRevealedNricUserId(userId);
    if (!details[userId]?.fullNric) {
      try {
        const res = await api.getUserNric(userId);
        patchDetails(userId, { fullNric: res.nric });
      } catch (err) {
        alert(err.message);
      }
    }
  };

  const handleToggleUserStatus = async (userId, currentStatus) => {
    const suspend = currentStatus === 'active';
    let reason = true;
    if (suspend) {
      reason = prompt('Enter reason for suspension:');
      if (!reason) return;
    } else if (!window.confirm('Reactivate this user?')) {
      return;
    }

    try {
      const res = suspend
        ? await api.suspendUser(userId, reason)
        : await api.unlockUser(userId);
      setUsers((prev) =>
        prev.map((u) =>
          u.user_id === userId ? { ...u, account_status: res.status } : u
        )
      );
    } catch (err) {
      alert(err.message);
    }
  };

  const handleToggleAccountStatus = async (userId, accountId, currentStatus) => {
    const suspend = currentStatus === 'active';
    let reason = true;
    if (suspend) {
      reason = prompt('Enter reason to suspend this account:');
      if (!reason) return;
    } else if (!window.confirm('Reactivate this account?')) {
      return;
    }

    try {
      const res = suspend
        ? await api.suspendAccount(accountId, reason)
        : await api.unsuspendAccount(accountId);
      patchDetails(userId, {
        accounts: (details[userId]?.accounts || []).map((acc) =>
          acc.account_id === accountId ? { ...acc, status: res.status } : acc
        ),
      });
    } catch (err) {
      alert(err.message);
    }
  };

  const filteredUsers = users.filter((user) => {
    const term = searchTerm.toLowerCase();
    if (!term) return true;
    return (
      (user.full_name || '').toLowerCase().includes(term) ||
      (user.email || '').toLowerCase().includes(term) ||
      (user.nric_masked || '').toLowerCase().includes(term) ||
      (details[user.user_id]?.fullNric || '').toLowerCase().includes(term)
    );
  });

  const statusPill = (status) => {
    const ok = status === 'active';
    return (
      <span style={{ padding: '4px 8px', borderRadius: '12px', fontSize: '0.8rem', backgroundColor: ok ? '#DEF7EC' : '#FEE2E2', color: ok ? '#03543F' : '#9B1C1C', fontWeight: '600' }}>
        {String(status || '').toUpperCase()}
      </span>
    );
  };

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
          {loading ? (
            <tr><td colSpan="5" style={{ padding: '32px', textAlign: 'center', color: '#6B7280' }}>Loading users...</td></tr>
          ) : filteredUsers.length > 0 ? (
            filteredUsers.map((user) => {
              const uid = user.user_id;
              const revealed = revealedNricUserId === uid;
              const fullNric = details[uid]?.fullNric;
              const accounts = details[uid]?.accounts;
              return (
                <React.Fragment key={uid}>

                  {/* MAIN USER ROW */}
                  <tr style={{ borderBottom: expandedUser === uid ? 'none' : '1px solid #E5E7EB', backgroundColor: expandedUser === uid ? '#F9FAFB' : 'transparent' }}>
                    <td style={{ padding: '12px 8px' }}>
                      <button onClick={() => handleToggleExpand(uid)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#6B7280' }}>
                        {expandedUser === uid ? '▼' : '▶'}
                      </button>
                    </td>
                    <td style={{ padding: '12px 8px' }}>
                      <strong style={{ color: '#111827' }}>{user.full_name}</strong><br /><span style={{ fontSize: '0.85rem', color: '#6B7280' }}>{user.email}</span>
                    </td>
                    <td style={{ padding: '12px 8px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <span style={{ fontFamily: 'monospace', fontWeight: revealed ? '700' : 'normal', color: revealed ? '#DC2626' : '#111827' }}>
                          {revealed ? (fullNric || 'Revealing...') : user.nric_masked}
                        </span>
                        {!revealed && (
                          <button onClick={(e) => handleRevealNric(e, uid)} style={{ fontSize: '0.75rem', cursor: 'pointer', padding: '2px 6px', border: '1px solid #D1D5DB', borderRadius: '4px', background: '#FFF' }}>Reveal</button>
                        )}
                      </div>
                    </td>
                    <td style={{ padding: '12px 8px' }}>{statusPill(user.account_status)}</td>
                    <td style={{ padding: '12px 8px', textAlign: 'right' }}>
                      <button onClick={() => handleToggleUserStatus(uid, user.account_status)} style={{ color: user.account_status === 'active' ? '#DC2626' : '#059669', background: 'none', border: 'none', cursor: 'pointer', fontWeight: '600' }}>
                        {user.account_status === 'active' ? 'Suspend' : 'Unlock'}
                      </button>
                    </td>
                  </tr>

                  {/* EXPANDED ACCOUNTS ROW */}
                  {expandedUser === uid && (
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
                              {accounts === undefined ? (
                                <tr><td colSpan="5" style={{ padding: '8px', color: '#6B7280' }}>Loading accounts...</td></tr>
                              ) : accounts.length === 0 ? (
                                <tr><td colSpan="5" style={{ padding: '8px', color: '#6B7280' }}>No accounts found.</td></tr>
                              ) : accounts.map((acc) => (
                                <tr key={acc.account_id} style={{ borderBottom: '1px dashed #D1D5DB' }}>
                                  <td style={{ padding: '8px', fontFamily: 'monospace', color: '#111827' }}>{acc.account_number}</td>
                                  <td style={{ padding: '8px', textTransform: 'capitalize', color: '#4B5563' }}>{acc.account_type}</td>
                                  <td style={{ padding: '8px', fontFamily: 'monospace', color: '#111827', textAlign: 'right' }}>SGD {((acc.balance_cents || 0) / 100).toFixed(2)}</td>
                                  <td style={{ padding: '8px', textAlign: 'center' }}>{statusPill(acc.status)}</td>
                                  <td style={{ padding: '8px', textAlign: 'right' }}>
                                    {(acc.status === 'active' || acc.status === 'suspended') ? (
                                      <button onClick={() => handleToggleAccountStatus(uid, acc.account_id, acc.status)} style={{ fontSize: '0.8rem', color: acc.status === 'active' ? '#DC2626' : '#059669', background: 'transparent', border: `1px solid ${acc.status === 'active' ? '#FCA5A5' : '#6EE7B7'}`, padding: '4px 8px', borderRadius: '4px', cursor: 'pointer', fontWeight: '500' }}>
                                        {acc.status === 'active' ? 'Suspend' : 'Reactivate'}
                                      </button>
                                    ) : (
                                      <span style={{ fontSize: '0.8rem', color: '#9CA3AF' }}>—</span>
                                    )}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              );
            })
          ) : (
            <tr>
              <td colSpan="5" style={{ padding: '32px', textAlign: 'center', color: '#6B7280' }}>
                No users found{searchTerm ? ` matching "${searchTerm}"` : ''}
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
