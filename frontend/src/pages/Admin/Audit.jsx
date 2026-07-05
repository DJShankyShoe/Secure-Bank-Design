import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { api } from '../../api/api';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Label shown in the user autocomplete — lets the admin find a person by any of
// name, email, or NRIC.
const userLabel = (u) => `${u.full_name} — ${u.email} — ${u.nric_masked}`;

export default function AdminAudit() {
  const [items, setItems] = useState([]);
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);

  const [filters, setFilters] = useState({ type: '', user: '' });
  const [applied, setApplied] = useState({ type: '', user: '' });

  const userMap = useMemo(
    () => Object.fromEntries(users.map((u) => [u.user_id, u])),
    [users]
  );

  const nameFor = useCallback(
    (id) => {
      if (!id) return null;
      const u = userMap[id];
      return u ? u.full_name || u.email : id;
    },
    [userMap]
  );

  // Resolve the typed term (email / NRIC / name / label / UUID) to a target user.
  const term = applied.user.trim();
  const isUuid = UUID_RE.test(term);
  const candidates = useMemo(() => {
    if (!term || isUuid) return [];
    const lc = term.toLowerCase();
    return users.filter(
      (u) =>
        (u.email || '').toLowerCase() === lc ||
        (u.nric_masked || '').toLowerCase() === lc ||
        userLabel(u).toLowerCase() === lc ||
        (u.full_name || '').toLowerCase().includes(lc) ||
        (u.email || '').toLowerCase().includes(lc) ||
        (u.nric_masked || '').toLowerCase().includes(lc)
    );
  }, [term, isUuid, users]);

  const matchedIds = useMemo(() => new Set(candidates.map((u) => u.user_id)), [candidates]);
  // A single resolved user -> filter server-side (works across every page).
  const serverUserId = isUuid ? term : (candidates.length === 1 ? candidates[0].user_id : '');

  const load = useCallback(async (pageNum, type, serverUser) => {
    setLoading(true);
    try {
      const res = await api.getAuditLogs(pageNum, type, serverUser);
      setItems(res.items || []);
      if (res.page_size) setPageSize(res.page_size);
    } catch (err) {
      alert(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  // Load the user directory once for id -> name resolution + autocomplete.
  useEffect(() => {
    api.getUsers()
      .then((res) => setUsers(res.users || []))
      .catch(() => setUsers([]));
  }, []);

  useEffect(() => {
    load(page, applied.type.trim(), serverUserId);
  }, [page, applied.type, serverUserId, load]);

  const handleFilter = (e) => {
    e.preventDefault();
    setPage(1);
    setApplied(filters);
  };

  const formatTs = (ts) =>
    ts ? new Date(ts).toLocaleString('en-SG', { timeZone: 'Asia/Singapore', hour12: false }) : '';

  // When the term matched multiple users (e.g. a common name), the server can't
  // filter by a single id — narrow the loaded page to the matched set client-side.
  const visible = items.filter((log) => {
    if (!term || serverUserId) return true;
    if (matchedIds.size === 0) return false; // typed something matching no user
    return matchedIds.has(log.actor_user_id) || matchedIds.has(log.target_user_id);
  });

  return (
    <div className="content-card">
      <h2 style={{ marginBottom: '16px' }}>System Audit Logs</h2>

      <form onSubmit={handleFilter} style={{ display: 'flex', gap: '16px', marginBottom: '24px', padding: '16px', backgroundColor: '#F9FAFB', borderRadius: '8px' }}>
        <input
          type="text"
          placeholder="Event Type (e.g. LOGIN_SUCCESS)"
          value={filters.type}
          onChange={(e) => setFilters({ ...filters, type: e.target.value })}
          style={{ padding: '8px', flex: 1 }}
        />
        <input
          type="text"
          list="audit-users"
          placeholder="User — by name, email, or NRIC"
          value={filters.user}
          onChange={(e) => setFilters({ ...filters, user: e.target.value })}
          style={{ padding: '8px', flex: 1 }}
        />
        <datalist id="audit-users">
          {users.map((u) => (
            <option key={u.user_id} value={userLabel(u)} />
          ))}
        </datalist>
        <button type="submit" className="primary-button" style={{ padding: '8px 24px', backgroundColor: '#111827', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer' }}>Filter</button>
      </form>

      {term && !serverUserId && matchedIds.size === 0 && (
        <p style={{ color: '#B45309', marginTop: '-8px', marginBottom: '16px', fontSize: '0.9rem' }}>
          No user matches "{term}".
        </p>
      )}

      <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
        <thead>
          <tr style={{ borderBottom: '2px solid #E5E7EB', color: '#4B5563' }}>
            <th style={{ padding: '12px 8px' }}>Timestamp (GMT+8)</th>
            <th style={{ padding: '12px 8px' }}>Event</th>
            <th style={{ padding: '12px 8px' }}>Actor</th>
            <th style={{ padding: '12px 8px' }}>Target</th>
            <th style={{ padding: '12px 8px' }}>Outcome</th>
          </tr>
        </thead>
        <tbody>
          {loading ? (
            <tr><td colSpan="5" style={{ padding: '32px', textAlign: 'center', color: '#6B7280' }}>Loading...</td></tr>
          ) : visible.length === 0 ? (
            <tr><td colSpan="5" style={{ padding: '32px', textAlign: 'center', color: '#6B7280' }}>No audit events.</td></tr>
          ) : visible.map((log) => (
            <tr key={log.event_id} style={{ borderBottom: '1px solid #E5E7EB' }}>
              <td style={{ padding: '12px 8px', color: '#6B7280' }}>{formatTs(log.event_timestamp)}</td>
              <td style={{ padding: '12px 8px', fontWeight: '600' }}>{log.event_type}</td>
              <td style={{ padding: '12px 8px' }}>
                {nameFor(log.actor_user_id) || (log.actor_role ? `(${log.actor_role})` : 'System')}
              </td>
              <td style={{ padding: '12px 8px' }}>{nameFor(log.target_user_id) || '—'}</td>
              <td style={{ padding: '12px 8px', color: log.outcome === 'success' ? '#059669' : '#DC2626' }}>{String(log.outcome || '').toUpperCase()}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '16px' }}>
        <button
          onClick={() => setPage((p) => Math.max(1, p - 1))}
          disabled={page <= 1 || loading}
          style={{ padding: '8px 16px', borderRadius: '6px', border: '1px solid #D1D5DB', background: page <= 1 ? '#F3F4F6' : '#FFF', cursor: page <= 1 ? 'not-allowed' : 'pointer' }}
        >
          ← Previous
        </button>
        <span style={{ color: '#6B7280', fontSize: '0.9rem' }}>Page {page}</span>
        <button
          onClick={() => setPage((p) => p + 1)}
          disabled={items.length < pageSize || loading}
          style={{ padding: '8px 16px', borderRadius: '6px', border: '1px solid #D1D5DB', background: items.length < pageSize ? '#F3F4F6' : '#FFF', cursor: items.length < pageSize ? 'not-allowed' : 'pointer' }}
        >
          Next →
        </button>
      </div>
    </div>
  );
}
