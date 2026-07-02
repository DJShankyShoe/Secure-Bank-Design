import React, { useState } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';

// 1. Import the Shared Layout
import Layout from './components/Layout';

// 2. Import all the Pages
import Login from './pages/Auth/Login';
import Register from './pages/Auth/Register';
import Dashboard from './pages/Dashboard/Overview';
import History from './pages/Dashboard/History';
import Transfer from './pages/Transactions/Transfer';
import PayBill from './pages/Transactions/PayBill';
import CreateAccount from './pages/Accounts/Create';
import ManageAccount from './pages/Accounts/Manage';
import AdminPanel from './pages/Admin/Panel';
import ForgotPassword from './pages/Auth/ForgotPassword.jsx';

export default function App() {
  const [isAuthenticated, setIsAuthenticated] = useState(false);

  return (
    <Router>
      <Routes>
        {/* Public Routes */}
        <Route 
          path="/login" 
          element={!isAuthenticated ? <Login onLoginSuccess={() => setIsAuthenticated(true)} /> : <Navigate to="/dashboard" replace />} 
        />
        <Route path="/register" element={<Register />} />
        <Route path="/forgot-password" element={<ForgotPassword />} />
        
        {/* Protected Routes wrapped in the Layout component */}
        <Route element={<Layout onLogout={() => setIsAuthenticated(false)} />}>
          <Route path="/dashboard" element={isAuthenticated ? <Dashboard /> : <Navigate to="/login" replace />} />
          <Route path="/history" element={isAuthenticated ? <History /> : <Navigate to="/login" replace />} />
          <Route path="/transfer" element={isAuthenticated ? <Transfer /> : <Navigate to="/login" replace />} />
          <Route path="/bills" element={isAuthenticated ? <PayBill /> : <Navigate to="/login" replace />} />
          <Route path="/accounts/create" element={isAuthenticated ? <CreateAccount /> : <Navigate to="/login" replace />} />
          <Route path="/accounts" element={isAuthenticated ? <ManageAccount /> : <Navigate to="/login" replace />} />
          <Route path="/admin" element={isAuthenticated ? <AdminPanel /> : <Navigate to="/login" replace />} />
        </Route>

        {/* Fallback - Catches any unknown URLs */}
        <Route path="*" element={<Navigate to={isAuthenticated ? "/dashboard" : "/login"} replace />} />
      </Routes>
    </Router>
  );
}