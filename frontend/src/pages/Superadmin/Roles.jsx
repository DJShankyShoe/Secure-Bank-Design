import React, { useCallback, useEffect, useState } from 'react';
import { api } from '../../api/api';
import { toast, confirm, promptReason } from '../../ui/notify.jsx';

const ROLES = ['customer', 'admin', 'superadmin'];

const ROLE_LABEL = { customer: 'Customer', admin: 'Admin', superadmin: 'Superadmin' };

const statusColor = (s) =>
  s === 'active' ? '#059669' : s === 'suspended' ? '#DC2626' : '#6B7280';

export default function SuperadminRoles() {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [applied, setApplied] = useState('');
  const [busyId, setBusyId] = useState(null);

  // The signed-in superadmin — used to disable actions on their own row
  // (the backend also blocks self-actions with a 403).
  const me = (() => {
    try {
      return JSON.parse(sessionStorage.getItem('securebank_user') || '{}');
    } catch {
      return {};
    }
  })();

  const load = useCallback(async (q) => {
    setLoading(true);
    try {
      const res = await api.getRoleDirectory(q);
      setUsers(res.users || []);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load(applied);
  }, [applied, load]);

  const handleSearch = (e) => {
    e.preventDefault();
    setApplied(search.trim());
  };

  const changeRole = async (user, newRole) => {
    if (newRole === user.role) return;
    const ok = await confirm({
      title: 'Change role',
      message: `Change ${user.email} from ${ROLE_LABEL[user.role]} to ${ROLE_LABEL[newRole]}? `
        + 'Their active sessions will be revoked.',
      confirmText: 'Change role',
      danger: newRole === 'superadmin' || user.role === 'superadmin',
    });
    if (!ok) return;
    setBusyId(user.user_id);
    try {
      await api.setUserRole(user.user_id, newRole);
      toast.success(`${user.email} is now ${ROLE_LABEL[newRole]}.`);
      await load(applied);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusyId(null);
    }
  };

  const suspend = async (user) => {
    const reason = await promptReason({
      title: 'Suspend account',
      message: `Suspend ${user.email}? They will be signed out and unable to log in.`,
      label: 'Reason',
      placeholder: 'e.g. offboarding, policy review',
      danger: true,
      confirmText: 'Suspend',
    });
    if (reason === null) return;
    setBusyId(user.user_id);
    try {
      await api.suspendAdmin(user.user_id, reason);
      toast.success(`${user.email} suspended.`);
      await load(applied);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusyId(null);
    }
  };

  const reactivate = async (user) => {
    setBusyId(user.user_id);
    try {
      await api.reactivateAdmin(user.user_id);
      toast.success(`${user.email} reactivated.`);
      await load(applied);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="content-card">
      <h2 style={{ marginBottom: '4px' }}>Role Management</h2>
      <p style={{ color: '#6B7280', margin: '0 0 20px 0', fontSize: '0.95rem' }}>
        Assign roles and manage admin accounts. You cannot change your own role or status —
        another superadmin must.
      </p>

      <form onSubmit={handleSearch} style={{ display: 'flex', gap: '12px', marginBottom: '24px' }}>
        <input
          type="text"
          placeholder="Search by name or email"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ padding: '10px 12px', flex: 1, border: '1px solid #D1D5DB', borderRadius: '6px' }}
        />
        <button type="submit" className="primary-button" style={{ padding: '8px 24px', backgroundColor: '#111827', color: 'white', border: 'none', borderRadius: '6px', cursor: 'pointer' }}>Search</button>
      </form>

      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
          <thead>
            <tr style={{ borderBottom: '2px solid #E5E7EB', color: '#4B5563' }}>
              <th style={{ padding: '12px 8px' }}>User</th>
              <th style={{ padding: '12px 8px' }}>Role</th>
              <th style={{ padding: '12px 8px' }}>Status</th>
              <th style={{ padding: '12px 8px' }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan="4" style={{ padding: '32px', textAlign: 'center', color: '#6B7280' }}>Loading…</td></tr>
            ) : users.length === 0 ? (
              <tr><td colSpan="4" style={{ padding: '32px', textAlign: 'center', color: '#6B7280' }}>No users found.</td></tr>
            ) : users.map((u) => {
              const isSelf = u.user_id === me.user_id;
              const isStaff = u.role === 'admin' || u.role === 'superadmin';
              const busy = busyId === u.user_id;
              return (
                <tr key={u.user_id} style={{ borderBottom: '1px solid #E5E7EB' }}>
                  <td style={{ padding: '12px 8px' }}>
                    <div style={{ fontWeight: '600', color: '#111827' }}>{u.full_name}</div>
                    <div style={{ color: '#6B7280', fontSize: '0.9rem' }}>{u.email}</div>
                  </td>
                  <td style={{ padding: '12px 8px' }}>
                    <select
                      value={u.role}
                      disabled={isSelf || busy}
                      onChange={(e) => changeRole(u, e.target.value)}
                      style={{ padding: '6px 8px', border: '1px solid #D1D5DB', borderRadius: '6px', cursor: isSelf ? 'not-allowed' : 'pointer' }}
                    >
                      {ROLES.map((r) => (
                        <option key={r} value={r}>{ROLE_LABEL[r]}</option>
                      ))}
                    </select>
                  </td>
                  <td style={{ padding: '12px 8px', color: statusColor(u.account_status), fontWeight: '600' }}>
                    {String(u.account_status || '').toUpperCase()}
                  </td>
                  <td style={{ padding: '12px 8px' }}>
                    {isSelf ? (
                      <span style={{ color: '#9CA3AF', fontSize: '0.9rem' }}>You</span>
                    ) : !isStaff ? (
                      <span style={{ color: '#9CA3AF', fontSize: '0.9rem' }}>Managed by admins</span>
                    ) : u.account_status === 'suspended' ? (
                      <button
                        onClick={() => reactivate(u)}
                        disabled={busy}
                        style={{ padding: '6px 14px', border: '1px solid #059669', color: '#059669', background: 'white', borderRadius: '6px', cursor: 'pointer', fontWeight: '600' }}
                      >
                        Reactivate
                      </button>
                    ) : (
                      <button
                        onClick={() => suspend(u)}
                        disabled={busy}
                        style={{ padding: '6px 14px', border: '1px solid #DC2626', color: '#DC2626', background: 'white', borderRadius: '6px', cursor: 'pointer', fontWeight: '600' }}
                      >
                        Suspend
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
