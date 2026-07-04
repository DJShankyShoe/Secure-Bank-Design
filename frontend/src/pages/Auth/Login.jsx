import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';

export default function Login({ onLoginSuccess }) {
  const navigate = useNavigate();
  
  // Tracks where the user is in the login flow: 'credentials', 'customer-pin', or 'admin-mfa'
  const [authStep, setAuthStep] = useState('credentials'); 
  
  const [credentials, setCredentials] = useState({ userId: '', password: '' });
  const [securityCode, setSecurityCode] = useState(''); // Shared state for both PIN and TOTP inputs
  const [error, setError] = useState('');

  const handlePrimaryAction = (e) => {
    e.preventDefault();
    setError('');

    if (authStep === 'customer-pin') {
      // --- STAGE 2: CUSTOMER PIN VERIFICATION ---
      if (securityCode.length === 6) {
        onLoginSuccess({ role: 'customer', emailVerified: true, totpConfirmed: true });
      } else {
        setError('Please enter your 6-digit transaction PIN.');
      }
    } 
    else if (authStep === 'admin-mfa') {
      // --- STAGE 2: ADMIN STAFF MFA VERIFICATION ---
      if (securityCode.length === 6) {
        onLoginSuccess({ role: 'admin', emailVerified: true, totpConfirmed: true });
      } else {
        setError('Please enter a valid 6-digit authenticator code.');
      }
    } 
    else {
      // --- STAGE 1: CREDENTIAL VERIFICATION ---
      const uid = credentials.userId.toUpperCase();
      const pwd = credentials.password;

      // 1. Existing Customer (Has PIN)
      if (uid === 'T1234567A' && pwd === 'password123') {
        setAuthStep('customer-pin');
      } 
      // 2. New Customer (Simulates Backend "Soft 403" verification_required)
      else if (uid === 'NEWUSER' && pwd === 'password123') {
        // Skip the PIN screen and send the unverified flags to App.jsx!
        onLoginSuccess({ 
          role: 'customer', 
          emailVerified: false, 
          totpConfirmed: false 
        });
      }
      // 3. Admin Staff (Uses Authenticator App)
      else if (uid === 'ADMIN99' && pwd === 'admin123') {
        setAuthStep('admin-mfa');
      } 
      // 4. Fail
      else {
        setError('Invalid NRIC/User ID or Password. Please check the testing credentials.');
      }
    }
  };

  return (
    <div style={{ minHeight: '100vh', display: 'flex', fontFamily: 'system-ui, -apple-system, sans-serif' }}>
      
      {/* LEFT PANEL: Branding & Engagement */}
      <div style={{ flex: '1.2', backgroundColor: '#111827', color: '#ffffff', display: 'flex', flexDirection: 'column', position: 'relative', overflow: 'hidden' }}>
        <div style={{ position: 'absolute', top: '-10%', left: '-10%', width: '600px', height: '600px', backgroundColor: '#E32636', borderRadius: '50%', filter: 'blur(120px)', opacity: '0.15', zIndex: 0 }}></div>

        <div style={{ padding: '40px 60px', zIndex: 1, display: 'flex', alignItems: 'center', gap: '16px' }}>
          <div style={{ backgroundColor: '#E32636', color: '#ffffff', width: '48px', height: '48px', borderRadius: '8px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: '800', fontSize: '1.4rem', letterSpacing: '-1px' }}>
            SB
          </div>
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <span style={{ fontSize: '1.5rem', fontWeight: '700', letterSpacing: '-0.5px', color: '#F9FAFB' }}>SecureBank</span>
            <span style={{ fontSize: '0.85rem', color: '#9CA3AF', fontWeight: '500', textTransform: 'uppercase', letterSpacing: '1px' }}>Personal Banking</span>
          </div>
        </div>

        <div style={{ padding: '60px', flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', zIndex: 1 }}>
          <h1 style={{ fontSize: '3.5rem', fontWeight: '800', lineHeight: '1.1', marginBottom: '24px', color: '#F9FAFB' }}>
            Secure.<br />
            <span style={{ color: '#E32636' }}>Seamless.</span><br />
            Simple.
          </h1>
          <p style={{ fontSize: '1.2rem', color: '#D1D5DB', maxWidth: '480px', lineHeight: '1.6', marginBottom: '48px' }}>
            Experience next-generation digital banking protected by layered security controls. Manage your wealth with absolute confidence.
          </p>

          {/* TEMPORARY DEV BOX FOR MOCK CREDENTIALS */}
          <div style={{ backgroundColor: 'rgba(59, 130, 246, 0.1)', borderLeft: '4px solid #3B82F6', padding: '24px', borderRadius: '0 8px 8px 0', maxWidth: '500px', backdropFilter: 'blur(8px)' }}>
            <h3 style={{ color: '#93C5FD', fontSize: '1.05rem', margin: '0 0 12px 0', display: 'flex', alignItems: 'center', gap: '8px', fontWeight: '600' }}>
              🛠️ Developer Testing Credentials
            </h3>
            <div style={{ color: '#E5E7EB', fontSize: '0.95rem', margin: 0, lineHeight: '1.6' }}>
              <strong>1. Existing Customer (Has PIN):</strong><br/>
              ID: <code style={{ backgroundColor: '#1E3A8A', padding: '2px 6px', borderRadius: '4px' }}>T1234567A</code><br/>
              Pass: <code style={{ backgroundColor: '#1E3A8A', padding: '2px 6px', borderRadius: '4px' }}>password123</code>
              <div style={{ margin: '8px 0', borderTop: '1px solid #1E40AF' }}></div>
              
              <strong>2. New Customer (Soft 403 test):</strong><br/>
              ID: <code style={{ backgroundColor: '#1E3A8A', padding: '2px 6px', borderRadius: '4px' }}>NEWUSER</code><br/>
              Pass: <code style={{ backgroundColor: '#1E3A8A', padding: '2px 6px', borderRadius: '4px' }}>password123</code>
              <div style={{ margin: '8px 0', borderTop: '1px solid #1E40AF' }}></div>
              
              <strong>3. Admin View:</strong><br/>
              ID: <code style={{ backgroundColor: '#1E3A8A', padding: '2px 6px', borderRadius: '4px' }}>ADMIN99</code><br/>
              Pass: <code style={{ backgroundColor: '#1E3A8A', padding: '2px 6px', borderRadius: '4px' }}>admin123</code>
              
              <p style={{ marginTop: '12px', fontSize: '0.85rem', color: '#93C5FD' }}>* For accounts that require a 2nd step, enter any 6 digits.</p>
            </div>
          </div>
        </div>
      </div>

      {/* RIGHT PANEL: Authentication Form */}
      <div style={{ flex: '1', backgroundColor: '#FFFFFF', display: 'flex', flexDirection: 'column', justifyContent: 'center', padding: '0 8%', minWidth: '500px' }}>
        
        <div style={{ maxWidth: '440px', width: '100%', margin: '0 auto' }}>
          
          <div style={{ marginBottom: '40px' }}>
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', padding: '6px 12px', backgroundColor: '#ECFDF5', color: '#065F46', borderRadius: '20px', fontSize: '0.85rem', fontWeight: '600', marginBottom: '24px' }}>
              <svg width="16" height="16" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M5 9V7a5 5 0 0110 0v2a2 2 0 012 2v5a2 2 0 01-2 2H5a2 2 0 01-2-2v-5a2 2 0 012-2zm8-2v2H7V7a3 3 0 016 0z" clipRule="evenodd" /></svg>
              End-to-End Encrypted
            </div>
            
            {/* Dynamic Headers based on user type */}
            <h2 style={{ fontSize: '2rem', color: '#111827', margin: '0 0 12px 0', fontWeight: '700', letterSpacing: '-0.5px' }}>
              {authStep === 'customer-pin' && "Security PIN"}
              {authStep === 'admin-mfa' && "Staff Authentication"}
              {authStep === 'credentials' && "Welcome Back"}
            </h2>
            <p style={{ color: '#4B5563', fontSize: '1.05rem', margin: 0 }}>
              {authStep === 'customer-pin' && "Please enter your 6-digit transaction PIN to confirm your identity."}
              {authStep === 'admin-mfa' && "Enter the 6-digit code generated by your corporate authenticator app."}
              {authStep === 'credentials' && "Please enter your credentials to securely access your accounts."}
            </p>
          </div>

          {error && (
            <div style={{ padding: '12px 16px', backgroundColor: '#FEF2F2', border: '1px solid #F87171', color: '#B91C1C', borderRadius: '8px', marginBottom: '24px', fontSize: '0.95rem', fontWeight: '500' }}>
              {error}
            </div>
          )}

          <form onSubmit={handlePrimaryAction} style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
            
            {authStep === 'credentials' ? (
              <>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  <label htmlFor="userId" style={{ fontSize: '0.95rem', fontWeight: '600', color: '#374151' }}>NRIC / User ID</label>
                  <input 
                    id="userId"
                    type="text" 
                    required
                    placeholder="e.g. T1234567A" 
                    value={credentials.userId}
                    onChange={(e) => setCredentials({...credentials, userId: e.target.value})}
                    style={{ padding: '14px 16px', border: '2px solid #E5E7EB', borderRadius: '8px', fontSize: '1rem', color: '#111827', outline: 'none', transition: 'border-color 0.2s', backgroundColor: '#F9FAFB' }} 
                    onFocus={(e) => e.target.style.borderColor = '#E32636'}
                    onBlur={(e) => e.target.style.borderColor = '#E5E7EB'}
                  />
                </div>
                
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <label htmlFor="password" style={{ fontSize: '0.95rem', fontWeight: '600', color: '#374151' }}>Password</label>
                    <button type="button" onClick={() => navigate('/forgot-password')} style={{ fontSize: '0.9rem', color: '#E32636', border: 'none', background: 'none', padding: 0, fontWeight: '600', cursor: 'pointer' }}>Forgot password?</button>
                  </div>
                  <input 
                    id="password"
                    type="password" 
                    required
                    placeholder="Enter your password" 
                    value={credentials.password}
                    onChange={(e) => setCredentials({...credentials, password: e.target.value})}
                    style={{ padding: '14px 16px', border: '2px solid #E5E7EB', borderRadius: '8px', fontSize: '1rem', color: '#111827', outline: 'none', transition: 'border-color 0.2s', backgroundColor: '#F9FAFB' }}
                    onFocus={(e) => e.target.style.borderColor = '#E32636'}
                    onBlur={(e) => e.target.style.borderColor = '#E5E7EB'} 
                  />
                </div>
              </>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <label htmlFor="securityCode" style={{ fontSize: '0.95rem', fontWeight: '600', color: '#374151' }}>
                  {authStep === 'customer-pin' ? "6-Digit PIN" : "6-Digit TOTP Code"}
                </label>
                <input 
                  id="securityCode"
                  type="password" 
                  inputMode="numeric"
                  maxLength="6"
                  required
                  placeholder="• • • • • •" 
                  value={securityCode}
                  onChange={(e) => setSecurityCode(e.target.value.replace(/\D/g, ''))}
                  style={{ padding: '16px', border: '2px solid #E5E7EB', borderRadius: '8px', fontSize: '1.5rem', letterSpacing: '8px', textAlign: 'center', color: '#111827', outline: 'none', transition: 'border-color 0.2s', backgroundColor: '#F9FAFB', fontWeight: '700' }}
                  onFocus={(e) => e.target.style.borderColor = '#E32636'}
                  onBlur={(e) => e.target.style.borderColor = '#E5E7EB'} 
                />
              </div>
            )}

            <div style={{ marginTop: '8px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <button 
                type="submit" 
                style={{ width: '100%', padding: '16px', backgroundColor: '#E32636', color: '#FFFFFF', border: 'none', borderRadius: '8px', fontSize: '1.05rem', fontWeight: '700', cursor: 'pointer', transition: 'background-color 0.2s', boxShadow: '0 4px 6px -1px rgba(227, 38, 54, 0.2), 0 2px 4px -1px rgba(227, 38, 54, 0.1)' }}
                onMouseOver={(e) => e.target.style.backgroundColor = '#B91C1C'}
                onMouseOut={(e) => e.target.style.backgroundColor = '#E32636'}
              >
                {authStep !== 'credentials' ? "Authenticate" : "Secure Log In"}
              </button>
              
              {authStep !== 'credentials' ? (
                <button 
                  type="button" 
                  onClick={() => {
                    setAuthStep('credentials');
                    setSecurityCode('');
                  }}
                  style={{ width: '100%', padding: '14px', backgroundColor: 'transparent', color: '#6B7280', border: 'none', cursor: 'pointer', fontSize: '0.95rem', fontWeight: '600', transition: 'color 0.2s' }}
                  onMouseOver={(e) => e.target.style.color = '#111827'}
                  onMouseOut={(e) => e.target.style.color = '#6B7280'}
                >
                  Return to credential entry
                </button>
              ) : (
                <div style={{ textAlign: 'center', fontSize: '0.95rem', color: '#6B7280' }}>
                  New to SecureBank?{' '}
                  <button type="button" onClick={() => navigate('/register')} style={{ background: 'none', border: 'none', color: '#111827', cursor: 'pointer', padding: 0, fontSize: '0.95rem', fontWeight: '700', textDecoration: 'underline' }}>
                    Register for access
                  </button>
                </div>
              )}
            </div>
          </form>
        </div>

      </div>
    </div>
  );
}