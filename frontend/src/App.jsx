import React, { useState, useEffect } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { api, setUnauthorizedHandler } from "./api/api";

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
    pinSetupCompleted: true   // default optimistic value until checks resolve
  });

  // Until we've asked the backend whether a session already exists, we don't know
  // if the user is logged in — hold rendering so we don't flash the login page.
  const [authReady, setAuthReady] = useState(false);

  // On load, restore the session from the server-side cookie (if any) so a refresh
  // or a direct visit to /login correctly recognises an already-logged-in user.
  useEffect(() => {
    api.me()
      .then(async (profile) => {
        sessionStorage.setItem("securebank_user", JSON.stringify(profile));

        // PIN status comes from its own endpoint, not /auth/me.
        // GET /transactions/pin -> { pin_set: true/false }
        let pinSetupCompleted = false;
        try {
          const pinStatus = await api.getPinStatus();
          pinSetupCompleted = pinStatus.pin_set ?? false;
        } catch (pinErr) {
          console.error("Could not check PIN status", pinErr);
        }

        setAuth({
          isAuthenticated: true,
          role: profile.role,
          emailVerified: profile.email_verified ?? true,
          pinSetupCompleted
        });
      })
      .catch(() => {
        // No valid session (401) — stay logged out.
      })
      .finally(() => setAuthReady(true));
  }, []);

  // Any 401 from the API (expired/revoked/missing session) clears auth; the route
  // guards then redirect to /login — for both customer and admin areas.
  useEffect(() => {
    setUnauthorizedHandler(() => {
      sessionStorage.removeItem("securebank_user");
      setAuth({
        isAuthenticated: false,
        role: null,
        emailVerified: true,
        pinSetupCompleted: true
      });
    });
  }, []);

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
    const { role, emailVerified, pinSetupCompleted } = loginData;

    setAuth({
      isAuthenticated: true,
      role,
      emailVerified,
      pinSetupCompleted
    });
  };

  if (!authReady) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'system-ui, -apple-system, sans-serif', color: '#6B7280' }}>
        Loading...
      </div>
    );
  }

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
              <Navigate to={auth.role === 'admin' ? "/console/users" : "/dashboard"} replace />
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

        {/* EMAIL CHANGE VERIFICATION (link sent to the NEW address, FR-04) */}
        <Route path="/verify-email-change" element={<VerifyEmail mode="change" />} />

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
        <Route
          element={
            auth.isAuthenticated && auth.role === 'customer'
              ? <Layout onLogout={handleLogout} />
              : <Navigate to="/login" replace />
          }
        >
          <Route path="/dashboard" element={<ProtectedCustomerRoute auth={auth}><Dashboard /></ProtectedCustomerRoute>} />
          <Route path="/history" element={<ProtectedCustomerRoute auth={auth}><History /></ProtectedCustomerRoute>} />
          <Route path="/transfer" element={<ProtectedCustomerRoute auth={auth}><Transfer /></ProtectedCustomerRoute>} />
          <Route path="/bills" element={<ProtectedCustomerRoute auth={auth}><PayBill /></ProtectedCustomerRoute>} />
          <Route path="/account" element={<ProtectedCustomerRoute auth={auth}><ManageAccount /></ProtectedCustomerRoute>} />
          <Route path="/settings" element={<ProtectedCustomerRoute auth={auth}><Settings /></ProtectedCustomerRoute>} />
        </Route>

        {/* ADMIN AREA */}
        <Route
          element={
            auth.isAuthenticated && auth.role === 'admin'
              ? <AdminLayout onLogout={handleLogout} />
              : <Navigate to="/login" replace />
          }
        >
          <Route path="/console/users" element={<AdminUsers />} />
          <Route path="/console/openings" element={<AdminOpenings />} />
          <Route path="/console/closures" element={<AdminClosures />} />
          <Route path="/console/audit" element={<AdminAudit />} />
        </Route>

        {/* FALLBACK */}
        <Route path="*" element={<Navigate to="/login" replace />} />

      </Routes>
    </Router>
  );
}