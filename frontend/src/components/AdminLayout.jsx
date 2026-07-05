import React, { useEffect, useState } from 'react';
import { Outlet, useNavigate, useLocation } from 'react-router-dom';
import { api } from '../api/api';

export default function AdminLayout({ onLogout }) {
  const navigate = useNavigate();
  const location = useLocation();

  const storedUser = JSON.parse(sessionStorage.getItem('securebank_user') || '{}');
  const adminName = storedUser.full_name || 'System Admin';
  const adminInitials = adminName
    .split(' ')
    .map((part) => part[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();

  // Live pending-request counts drive the sidebar badges.
  const [counts, setCounts] = useState({ open_requested: 0, close_requested: 0 });
  useEffect(() => {
    api.getAdminAccounts()
      .then((res) => {
        const accts = res.accounts || [];
        setCounts({
          open_requested: accts.filter((a) => a.status === 'open_requested').length,
          close_requested: accts.filter((a) => a.status === 'close_requested').length,
        });
      })
      .catch(() => {});
  }, [location.pathname]);

  const adminNavItems = [
    { id: "users", label: "User Directory", badge: "", path: "/admin/users" },
    { id: "openings", label: "Account Openings", badge: counts.open_requested || "", path: "/admin/openings" },
    { id: "closures", label: "Account Closures", badge: counts.close_requested || "", path: "/admin/closures" },
    { id: "audit", label: "System Audit Logs", badge: "", path: "/admin/audit" }
  ];

  return (
    <div className="app-shell" style={{ backgroundColor: '#f3f4f6' }}>
      <header className="topbar" style={{ backgroundColor: '#111827', color: 'white' }}>
        <div className="brand">
          <div className="brand-mark" style={{ backgroundColor: '#E32636' }}>SB</div>
          <div className="brand-text">
            <strong style={{ color: 'white' }}>SecureBank</strong>
            <span style={{ color: '#9CA3AF' }}>Internal Staff Portal</span>
          </div>
        </div>
        <div className="topbar-actions">
          <p style={{ color: '#9CA3AF' }}> Session expires in 11:42 </p>
          <button className="ghost-button" style={{ color: '#FCA5A5' }} onClick={onLogout}>Log out</button>
        </div>
      </header>

      <div className="layout">
        <aside className="sidebar">
          <div className="profile-card" style={{ borderBottom: '1px solid #E5E7EB', paddingBottom: '16px', marginBottom: '16px' }}>
            <div className="avatar" style={{ backgroundColor: '#4B5563', color: 'white' }}>{adminInitials}</div>
            <strong>{adminName}</strong>
          </div>
          
          <div className="nav-group">
            <div className="nav-label">Operations</div>
            {adminNavItems.map((item) => {
              const isActive = location.pathname.includes(item.path);
              return (
                <button
                  key={item.id}
                  className={`nav-button ${isActive ? "active" : ""}`}
                  style={{
                    backgroundColor: isActive ? '#FEF2F2' : 'transparent',
                    color: isActive ? '#B91C1C' : 'inherit',
                    borderLeft: isActive ? '3px solid #E32636' : '3px solid transparent'
                  }}
                  onClick={() => navigate(item.path)}
                >
                  <span>{item.label}</span>
                  {item.badge && <span className="nav-badge" style={{ backgroundColor: isActive ? '#DC2626' : '#E5E7EB', color: isActive ? 'white' : '#4B5563' }}>{item.badge}</span>}
                </button>
              )
            })}
          </div>
        </aside>

        <main className="main-panel" style={{ padding: '32px' }}>
          <Outlet />
        </main>
      </div>
    </div>
  );
}