import React from 'react';
import { Outlet, useNavigate, useLocation } from 'react-router-dom';

const adminNavItems = [
  { id: "users", label: "User Directory", badge: "", path: "/admin/users" },
  { id: "openings", label: "Account Openings", badge: "1", path: "/admin/openings" },
  { id: "closures", label: "Account Closures", badge: "1", path: "/admin/closures" },
  { id: "audit", label: "System Audit Logs", badge: "", path: "/admin/audit" }
];

export default function AdminLayout({ onLogout }) {
  const navigate = useNavigate();
  const location = useLocation();

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
            <div className="avatar" style={{ backgroundColor: '#4B5563', color: 'white' }}>AD</div>
            <strong>System Admin</strong>
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