import React from 'react';
import AdminAudit from '../Admin/Audit.jsx';
import { api } from '../../api/api';

// Superadmin audit view (FR-08, SR-14): the full, unfiltered log — including
// staff-to-staff activity (role changes, admin/superadmin logins) that the
// admin (customer-oversight) view withholds. Reuses the admin audit component,
// pointing it at the superadmin-scoped endpoints.
export default function SuperadminAudit() {
  return (
    <AdminAudit
      fetchLogs={api.getSuperadminAuditLogs}
      fetchUsers={() => api.getRoleDirectory()}
      title="System Audit Logs — Full Scope"
    />
  );
}
