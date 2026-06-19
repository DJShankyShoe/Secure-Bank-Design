import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';

export default function Login({ onLoginSuccess }) {
  const navigate = useNavigate();
  const [showMfa, setShowMfa] = useState(false);
  const [credentials, setCredentials] = useState({ userId: '', password: '' });
  const [totp, setTotp] = useState('');

  const handlePrimaryAction = (e) => {
    e.preventDefault();
    if (showMfa) {
      console.log("Verifying TOTP:", totp);
      onLoginSuccess(); 
    } else {
      console.log("Verifying credentials for:", credentials.userId);
      setShowMfa(true); 
    }
  };

  return (
    <div style={{ minHeight: '100vh', display: 'flex', fontFamily: 'system-ui, -apple-system, sans-serif' }}>
      
      {/* LEFT PANEL: Branding & Engagement (Dark Mode for High Contrast) */}
      <div style={{ flex: '1.2', backgroundColor: '#111827', color: '#ffffff', display: 'flex', flexDirection: 'column', position: 'relative', overflow: 'hidden' }}>
        
        {/* Subtle Background Accent */}
        <div style={{ position: 'absolute', top: '-10%', left: '-10%', width: '600px', height: '600px', backgroundColor: '#E32636', borderRadius: '50%', filter: 'blur(120px)', opacity: '0.15', zIndex: 0 }}></div>

        {/* Header / Logo */}
        <div style={{ padding: '40px 60px', zIndex: 1, display: 'flex', alignItems: 'center', gap: '16px' }}>
          <div style={{ backgroundColor: '#E32636', color: '#ffffff', width: '48px', height: '48px', borderRadius: '8px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: '800', fontSize: '1.4rem', letterSpacing: '-1px' }}>
            SB
          </div>
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <span style={{ fontSize: '1.5rem', fontWeight: '700', letterSpacing: '-0.5px', color: '#F9FAFB' }}>SecureBank</span>
            <span style={{ fontSize: '0.85rem', color: '#9CA3AF', fontWeight: '500', textTransform: 'uppercase', letterSpacing: '1px' }}>Personal Banking</span>
          </div>
        </div>

        {/* Hero Content */}
        <div style={{ padding: '60px', flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', zIndex: 1 }}>
          <h1 style={{ fontSize: '3.5rem', fontWeight: '800', lineHeight: '1.1', marginBottom: '24px', color: '#F9FAFB' }}>
            Secure.<br />
            <span style={{ color: '#E32636' }}>Seamless.</span><br />
            Simple.
          </h1>
          <p style={{ fontSize: '1.2rem', color: '#D1D5DB', maxWidth: '480px', lineHeight: '1.6', marginBottom: '48px' }}>
            Experience next-generation digital banking protected by layered security controls. Manage your wealth with absolute confidence.
          </p>

          {/* High-Contrast Advisory Box */}
          <div style={{ backgroundColor: 'rgba(254, 242, 242, 0.1)', borderLeft: '4px solid #EF4444', padding: '24px', borderRadius: '0 8px 8px 0', maxWidth: '500px', backdropFilter: 'blur(8px)' }}>
            <h3 style={{ color: '#FCA5A5', fontSize: '1.05rem', margin: '0 0 12px 0', display: 'flex', alignItems: 'center', gap: '8px', fontWeight: '600' }}>
              <svg width="20" height="20" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" /></svg>
              Security Advisory
            </h3>
            <p style={{ color: '#E5E7EB', fontSize: '0.95rem', margin: 0, lineHeight: '1.6' }}>
              We will never ask for your password, PIN, or SMS OTP over the phone, email, or messaging apps. Always verify the website URL before logging in.
            </p>
          </div>
        </div>
      </div>

      {/* RIGHT PANEL: Authentication Form (Light Mode) */}
      <div style={{ flex: '1', backgroundColor: '#FFFFFF', display: 'flex', flexDirection: 'column', justifyContent: 'center', padding: '0 8%', minWidth: '500px' }}>
        
        <div style={{ maxWidth: '440px', width: '100%', margin: '0 auto' }}>
          
          <div style={{ marginBottom: '40px' }}>
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', padding: '6px 12px', backgroundColor: '#ECFDF5', color: '#065F46', borderRadius: '20px', fontSize: '0.85rem', fontWeight: '600', marginBottom: '24px' }}>
              <svg width="16" height="16" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M5 9V7a5 5 0 0110 0v2a2 2 0 012 2v5a2 2 0 01-2 2H5a2 2 0 01-2-2v-5a2 2 0 012-2zm8-2v2H7V7a3 3 0 016 0z" clipRule="evenodd" /></svg>
              End-to-End Encrypted
            </div>
            <h2 style={{ fontSize: '2rem', color: '#111827', margin: '0 0 12px 0', fontWeight: '700', letterSpacing: '-0.5px' }}>
              {showMfa ? "2-Step Verification" : "Welcome Back"}
            </h2>
            <p style={{ color: '#4B5563', fontSize: '1.05rem', margin: 0 }}>
              {showMfa ? "Enter the 6-digit code generated by your authenticator app to securely access your account." : "Please enter your credentials to securely access your accounts."}
            </p>
          </div>

          <form onSubmit={handlePrimaryAction} style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
            {!showMfa ? (
              <>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  <label htmlFor="userId" style={{ fontSize: '0.95rem', fontWeight: '600', color: '#374151' }}>User ID</label>
                  <input 
                    id="userId"
                    type="text" 
                    required
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
                    <a href="#forgot" style={{ fontSize: '0.9rem', color: '#E32636', textDecoration: 'none', fontWeight: '600' }}>Forgot password?</a>
                  </div>
                  <input 
                    id="password"
                    type="password" 
                    required
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
                <label htmlFor="totp" style={{ fontSize: '0.95rem', fontWeight: '600', color: '#374151' }}>6-Digit TOTP Code</label>
                <input 
                  id="totp"
                  type="text" 
                  maxLength="6"
                  required
                  placeholder="• • • • • •" 
                  value={totp}
                  onChange={(e) => setTotp(e.target.value.replace(/\D/g, ''))}
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
                {showMfa ? "Authenticate" : "Secure Log In"}
              </button>
              
              {showMfa ? (
                <button 
                  type="button" 
                  onClick={() => setShowMfa(false)}
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

        {/* Minimal Footer */}
        <div style={{ position: 'absolute', bottom: '32px', right: '8%', display: 'flex', gap: '24px', fontSize: '0.85rem', color: '#9CA3AF', fontWeight: '500' }}>
          <a href="#help" style={{ color: 'inherit', textDecoration: 'none' }}>Help Centre</a>
          <a href="#privacy" style={{ color: 'inherit', textDecoration: 'none' }}>Privacy</a>
          <a href="#terms" style={{ color: 'inherit', textDecoration: 'none' }}>Terms</a>
        </div>
      </div>

    </div>
  );
}