import React, { useState } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { api } from "./api/api";

// Layouts
import Layout from './components/Layout.jsx';
import AdminLayout from './components/AdminLayout.jsx';

// Settings
import Settings from './pages/Settings/Settings.jsx';

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

// Admin Pages
import AdminUsers from './pages/Admin/Users.jsx';
import AdminOpenings from './pages/Admin/Openings.jsx';
import AdminClosures from './pages/Admin/Closures.jsx';
import AdminAudit from './pages/Admin/Audit.jsx';

// ==========================================
// THE TRAFFIC COP (Protected Route Wrapper)
// ==========================================
const ProtectedCustomerRoute = ({ auth, children }) => {
  // 1. Check Authentication & Role
  if (!auth.isAuthenticated) return <Navigate to="/login" replace />;
  if (auth.role !== 'customer') return <Navigate to="/login" replace />;
  
  // 2. Enforce Onboarding Steps based on Backend Flags (Order matters!)
  if (auth.emailVerified === false) return <Navigate to="/verify-email" replace />;
  if (auth.totpConfirmed === false) return <Navigate to="/setup-pin" replace />;
  
  // 3. If they pass all checks, render the requested page!
  return children;
};

export default function App() {
  // Track authentication, role, AND onboarding flags provided by the backend
  const [auth, setAuth] = useState({ 
    isAuthenticated: false, 
    role: null,
    emailVerified: true, // Default to true so admins don't get trapped
    totpConfirmed: true  // Default to true so admins don't get trapped
  });

  // Uses the API call
  const handleLogout = async () => {
    try {
      await api.logout();
    } catch (err) {
      console.error("Logout failed:", err);
    } finally {
      sessionStorage.removeItem("securebank_user");
      setAuth({ isAuthenticated: false, role: null, emailVerified: true, totpConfirmed: true });
    }
  };

  // The login handler now accepts the exact payload from the backend / Login.jsx
  const handleLoginSuccess = (loginData) => {
    setAuth({ 
      isAuthenticated: true, 
      role: loginData.role, 
      emailVerified: loginData.emailVerified, 
      totpConfirmed: loginData.totpConfirmed 
    });
  };

  return (
    <Router>
      <Routes>
        
        {/* ========================================= */}
        {/* PUBLIC ROUTES                             */}
        {/* ========================================= */}
        <Route 
          path="/login" 
          element={!auth.isAuthenticated ? (
            <Login onLoginSuccess={handleLoginSuccess} /> 
          ) : (
            <Navigate to={auth.role === 'admin' ? "/admin/users" : "/dashboard"} replace />
          )} 
        />
        <Route path="/register" element={<Register />} />
        <Route path="/forgot-password" element={<ForgotPassword />} />
        <Route path="/reset-password" element={<ResetPassword />} />
        <Route path="/register/totp" element={<RegisterTotpSetup />} />
        
        {/* Onboarding Routes update the App state when completed */}
        <Route 
          path="/verify-email" 
          element={<VerifyEmail onVerificationComplete={() => setAuth({ ...auth, emailVerified: true })} />} 
        />
        <Route 
          path="/setup-pin" 
          element={<SetupPin onSetupComplete={() => setAuth({ ...auth, totpConfirmed: true })} />} 
        />

        {/* ========================================= */}
        {/* CUSTOMER PORTAL (Guarded by Traffic Cop)  */}
        {/* ========================================= */}
        <Route element={<Layout onLogout={handleLogout} />}>
          <Route path="/dashboard" element={<ProtectedCustomerRoute auth={auth}><Dashboard /></ProtectedCustomerRoute>} />
          <Route path="/history" element={<ProtectedCustomerRoute auth={auth}><History /></ProtectedCustomerRoute>} />
          <Route path="/transfer" element={<ProtectedCustomerRoute auth={auth}><Transfer /></ProtectedCustomerRoute>} />
          <Route path="/bills" element={<ProtectedCustomerRoute auth={auth}><PayBill /></ProtectedCustomerRoute>} />
          <Route path="/accounts" element={<ProtectedCustomerRoute auth={auth}><ManageAccount /></ProtectedCustomerRoute>} />
          <Route path="/settings" element={<ProtectedCustomerRoute auth={auth}><Settings /></ProtectedCustomerRoute>} />
        </Route>

        {/* ========================================= */}
        {/* ADMIN PORTAL (Strictly locked)            */}
        {/* ========================================= */}
        <Route element={<AdminLayout onLogout={handleLogout} />}>
          <Route path="/admin/users" element={auth.isAuthenticated && auth.role === 'admin' ? <AdminUsers /> : <Navigate to="/login" replace />} />
          <Route path="/admin/openings" element={auth.isAuthenticated && auth.role === 'admin' ? <AdminOpenings /> : <Navigate to="/login" replace />} />
          <Route path="/admin/closures" element={auth.isAuthenticated && auth.role === 'admin' ? <AdminClosures /> : <Navigate to="/login" replace />} />
          <Route path="/admin/audit" element={auth.isAuthenticated && auth.role === 'admin' ? <AdminAudit /> : <Navigate to="/login" replace />} />
          <Route path="/admin" element={<Navigate to="/admin/users" replace />} />
        </Route>

        {/* ========================================= */}
        {/* FALLBACK ROUTE                            */}
        {/* ========================================= */}
        <Route path="*" element={<Navigate to={auth.isAuthenticated ? (auth.role === 'admin' ? "/admin/users" : "/dashboard") : "/login"} replace />} />
        
      </Routes>
    </Router>
  );
}