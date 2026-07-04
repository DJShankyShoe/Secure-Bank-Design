import React from 'react';
import { Outlet, useNavigate, useLocation } from 'react-router-dom';

const navItems = [
  { id: "dashboard", label: "Dashboard", badge: "", path: "/dashboard" },
  { id: "accounts", label: "Accounts", badge: "", path: "/accounts" },
  { id: "history", label: "Transaction History", badge: "", path: "/history" },
  { id: "transfer", label: "Transfers", badge: "", path: "/transfer" },
  { id: "bills", label: "Bill Payment", badge: "", path: "/bills" },
  { id: "settings", label: "Settings", badge: "", path: "/settings" },
];

export default function Layout({ onLogout }) {
  const navigate = useNavigate();
  const location = useLocation();
  const storedUser = JSON.parse(sessionStorage.getItem("securebank_user") || "{}");

  const displayName =
    storedUser.full_name ||
    storedUser.fullName ||
    storedUser.name ||
    storedUser.email ||
    "Customer";

  const initials = displayName
    .split(" ")
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  const roleLabel = storedUser.role || "Retail";

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
          <p> Session expires in 11:42 </p>
          <button className="ghost-button" onClick={onLogout}>Log out</button>
        </div>
      </header>

      <div className="layout">
        <aside className="sidebar">
          <div className="profile-card">
            <div className="avatar">{initials}</div>
            <strong>{displayName}</strong>
            <p>{roleLabel}</p>
          </div>
          <div className="nav-group">
            <div className="nav-label"></div>
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
          <Outlet /> 
        </main>
      </div>
    </div>
  );
}