import React, { useState } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { api } from "./api/api";

// Layouts
import Layout from './components/Layout.jsx';
import AdminLayout from './components/AdminLayout.jsx';

// Auth Pages
import Login from './pages/Auth/Login.jsx';
import Register from './pages/Auth/Register.jsx';
import ForgotPassword from './pages/Auth/ForgotPassword.jsx';
import ResetPassword from './pages/Auth/ResetPassword.jsx';
import SetupPin from './pages/Auth/SetupPin.jsx';
import VerifyEmail from './pages/Auth/VerifyEmail.jsx';
import RegisterTotpSetup from "./pages/Auth/RegisterTotpSetup";

// Customer Pages
import Dashboard from './pages/Dashboard/Overview.jsx';
import History from './pages/Dashboard/History.jsx';
import Transfer from './pages/Transactions/Transfer.jsx';
import PayBill from './pages/Transactions/PayBill.jsx';
import ManageAccount from './pages/Accounts/Manage.jsx';
import Settings from './pages/Settings/Settings.jsx';

// Admin Pages
import AdminUsers from './pages/Admin/Users.jsx';
import AdminOpenings from './pages/Admin/Openings.jsx';
import AdminClosures from './pages/Admin/Closures.jsx';
import AdminAudit from './pages/Admin/Audit.jsx';

// ============================
// Protected Route
// ============================
const ProtectedCustomerRoute = ({ auth, children }) => {
  if (!auth.isAuthenticated) return <Navigate to="/login" replace />;
  if (auth.role !== 'customer') return <Navigate to="/login" replace />;

  // Email must be verified first
  if (!auth.emailVerified) return <Navigate to="/verify-email" replace />;

  // BANK PIN (NOT OTP)
  if (!auth.pinSetupCompleted) return <Navigate to="/setup-pin" replace />;

  return children;
};

export default function App() {

  const [auth, setAuth] = useState({
    isAuthenticated: false,
    role: null,
    emailVerified: true,
    pinSetupCompleted: true   // ✅ FIXED: this is BANK PIN, NOT OTP
  });

  const handleLogout = async () => {
    try {
      await api.logout();
    } finally {
      setAuth({
        isAuthenticated: false,
        role: null,
        emailVerified: true,
        pinSetupCompleted: true
      });
    }
  };

  const handleLoginSuccess = (loginData) => {
    const emailVerified = loginData.emailVerified;
    const pinSetupCompleted = loginData.pinSetupCompleted;

    setAuth({
      isAuthenticated: emailVerified && pinSetupCompleted,
      role: loginData.role,
      emailVerified,
      pinSetupCompleted
    });
  };

  return (
    <Router>
      <Routes>

        {/* PUBLIC ROUTES */}
        <Route
          path="/login"
          element={
            !auth.isAuthenticated ? (
              <Login onLoginSuccess={handleLoginSuccess} />
            ) : (
              <Navigate to={auth.role === 'admin' ? "/admin/users" : "/dashboard"} replace />
            )
          }
        />

        <Route path="/register" element={<Register />} />
        <Route path="/forgot-password" element={<ForgotPassword />} />
        <Route path="/reset-password" element={<ResetPassword />} />
        <Route path="/register/totp" element={<RegisterTotpSetup />} />

        {/* EMAIL VERIFICATION PAGE (RESTORED) */}
        <Route
          path="/verify-email"
          element={
            <VerifyEmail
              onVerificationComplete={() =>
                setAuth(prev => ({
                  ...prev,
                  emailVerified: true
                }))
              }
            />
          }
        />

        {/* BANK PIN SETUP (NOT OTP) */}
        <Route
          path="/setup-pin"
          element={
            <SetupPin
              onSetupComplete={() =>
                setAuth(prev => ({
                  ...prev,
                  pinSetupCompleted: true
                }))
              }
            />
          }
        />

        {/* CUSTOMER AREA */}
        <Route element={<Layout onLogout={handleLogout} />}>
          <Route path="/dashboard" element={<ProtectedCustomerRoute auth={auth}><Dashboard /></ProtectedCustomerRoute>} />
          <Route path="/history" element={<ProtectedCustomerRoute auth={auth}><History /></ProtectedCustomerRoute>} />
          <Route path="/transfer" element={<ProtectedCustomerRoute auth={auth}><Transfer /></ProtectedCustomerRoute>} />
          <Route path="/bills" element={<ProtectedCustomerRoute auth={auth}><PayBill /></ProtectedCustomerRoute>} />
          <Route path="/accounts" element={<ProtectedCustomerRoute auth={auth}><ManageAccount /></ProtectedCustomerRoute>} />
          <Route path="/settings" element={<ProtectedCustomerRoute auth={auth}><Settings /></ProtectedCustomerRoute>} />
        </Route>

        {/* ADMIN AREA */}
        <Route element={<AdminLayout onLogout={handleLogout} />}>
          <Route path="/admin/users" element={<AdminUsers />} />
          <Route path="/admin/openings" element={<AdminOpenings />} />
          <Route path="/admin/closures" element={<AdminClosures />} />
          <Route path="/admin/audit" element={<AdminAudit />} />
        </Route>

        {/* FALLBACK */}
        <Route path="*" element={<Navigate to="/login" replace />} />

      </Routes>
    </Router>
  );
}