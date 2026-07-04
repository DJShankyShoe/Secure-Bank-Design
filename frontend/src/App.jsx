import React, { useState } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';

// Settings.jsx
import Settings from './pages/Settings/Settings.jsx';

// Layouts
import Layout from './components/Layout.jsx';
import AdminLayout from './components/AdminLayout.jsx';

// Auth Pages
import Login from './pages/Auth/Login.jsx';
import Register from './pages/Auth/Register.jsx';
import ForgotPassword from './pages/Auth/ForgotPassword.jsx';
import ResetPassword from './pages/Auth/ResetPassword.jsx';
import SetupPin from './pages/Auth/SetupPin.jsx';

// Customer Pages
import Dashboard from './pages/Dashboard/Overview.jsx';
import History from './pages/Dashboard/History.jsx';
import Transfer from './pages/Transactions/Transfer.jsx';
import PayBill from './pages/Transactions/PayBill.jsx';
import CreateAccount from './pages/Accounts/Create.jsx';
import ManageAccount from './pages/Accounts/Manage.jsx';

// Admin Pages
import AdminUsers from './pages/Admin/Users.jsx';
import AdminOpenings from './pages/Admin/Openings.jsx';
import AdminClosures from './pages/Admin/Closures.jsx';
import AdminAudit from './pages/Admin/Audit.jsx';


export default function App() {
  // Track both authentication status AND the user's role
  const [auth, setAuth] = useState({ isAuthenticated: false, role: null });

  // Helper function to handle logouts
  const handleLogout = () => {
    setAuth({ isAuthenticated: false, role: null });
  };

  return (
    <Router>
      <Routes>
        
        {/* PUBLIC ROUTES */}
        <Route 
          path="/login" 
          element={!auth.isAuthenticated ? (
            <Login onLoginSuccess={(role) => setAuth({ isAuthenticated: true, role })} /> 
          ) : (
            <Navigate to={auth.role === 'admin' ? "/admin/users" : "/dashboard"} replace />
          )} 
        />
        <Route path="/register" element={<Register />} />
        <Route path="/forgot-password" element={<ForgotPassword />} />
        <Route path="/reset-password" element={<ResetPassword />} />
        <Route path="/setup-pin" element={<SetupPin onSetupComplete={(role) => setAuth({ isAuthenticated: true, role })} />} />

        {/* CUSTOMER PORTAL (Strictly locked to role === 'customer') */}
        <Route element={<Layout onLogout={handleLogout} />}>
          <Route path="/dashboard" element={auth.isAuthenticated && auth.role === 'customer' ? <Dashboard /> : <Navigate to="/login" replace />} />
          <Route path="/history" element={auth.isAuthenticated && auth.role === 'customer' ? <History /> : <Navigate to="/login" replace />} />
          <Route path="/transfer" element={auth.isAuthenticated && auth.role === 'customer' ? <Transfer /> : <Navigate to="/login" replace />} />
          <Route path="/bills" element={auth.isAuthenticated && auth.role === 'customer' ? <PayBill /> : <Navigate to="/login" replace />} />
          <Route path="/accounts/create" element={auth.isAuthenticated && auth.role === 'customer' ? <CreateAccount /> : <Navigate to="/login" replace />} />
          <Route path="/accounts" element={auth.isAuthenticated && auth.role === 'customer' ? <ManageAccount /> : <Navigate to="/login" replace />} />
          <Route path="/settings" element={auth.isAuthenticated && auth.role === 'customer' ? <Settings /> : <Navigate to="/login" replace />} />
        </Route>

        {/* ADMIN PORTAL (Strictly locked to role === 'admin') */}
        <Route element={<AdminLayout onLogout={handleLogout} />}>
          <Route path="/admin/users" element={auth.isAuthenticated && auth.role === 'admin' ? <AdminUsers /> : <Navigate to="/login" replace />} />
          <Route path="/admin/openings" element={auth.isAuthenticated && auth.role === 'admin' ? <AdminOpenings /> : <Navigate to="/login" replace />} />
          <Route path="/admin/closures" element={auth.isAuthenticated && auth.role === 'admin' ? <AdminClosures /> : <Navigate to="/login" replace />} />
          <Route path="/admin/audit" element={auth.isAuthenticated && auth.role === 'admin' ? <AdminAudit /> : <Navigate to="/login" replace />} />
          <Route path="/admin" element={<Navigate to="/admin/users" replace />} />
        </Route>

        {/* FALLBACK: Redirect based on active role, or kick to login */}
        <Route path="*" element={<Navigate to={auth.isAuthenticated ? (auth.role === 'admin' ? "/admin/users" : "/dashboard") : "/login"} replace />} />
        
      </Routes>
    </Router>
  );
}