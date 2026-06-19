import React from 'react';
import { Outlet, useNavigate, useLocation } from 'react-router-dom';

const navItems = [
  { id: "dashboard", label: "Dashboard", badge: "", path: "/dashboard" },
  { id: "accounts", label: "Accounts", badge: "", path: "/accounts" },
  { id: "transfer", label: "Transfers", badge: "", path: "/transfer" },
  { id: "bills", label: "Bill Payment", badge: "", path: "/bills" },
  { id: "admin", label: "Admin View", badge: "ADMIN ONLY", path: "/admin" },
];

export default function Layout({ onLogout }) {
  const navigate = useNavigate();
  const location = useLocation();

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand">
          <div className="brand-mark">SB</div>
          <div className="brand-text">
            <strong>SecureBank</strong>
            <span>Personal Internet Banking</span>
          </div>
        </div>
        <div className="topbar-actions">
          <button className="ghost-button" onClick={onLogout}>Log out</button>
        </div>
      </header>

      <div className="layout">
        <aside className="sidebar">
          <div className="profile-card">
            <div className="avatar">BJ</div>
            <strong>Bobby Jones</strong>
            <p>Retail customer · Session expires in 11:42</p>
          </div>
          <div className="nav-group">
            <div className="nav-label">Workspace</div>
            {navItems.map((item) => (
              <button
                key={item.id}
                className={`nav-button ${location.pathname.includes(item.path) ? "active" : ""}`}
                onClick={() => navigate(item.path)}
              >
                <span>{item.label}</span>
                <span className="nav-badge">{item.badge}</span>
              </button>
            ))}
          </div>
        </aside>

        <main className="main-panel">
          {/* This Outlet is the "window" where Dashboard, Transfer, etc. will render */}
          <Outlet /> 
        </main>
      </div>
    </div>
  );
}