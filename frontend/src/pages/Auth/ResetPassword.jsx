import React, { useState, useEffect } from 'react';
import { toast } from '../../ui/notify.jsx';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { api } from "../../api/api";

export default function ResetPassword() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const token = searchParams.get("token"); // Extracts the ?token=xyz from the URL

  const [formData, setFormData] = useState({
    newPassword: '',
    confirmPassword: '',
    authCode: ''
  });
  const [error, setError] = useState('');

  // Gate the form on the token: verify it server-side before rendering anything.
  // 'checking' shows a spinner, 'valid' shows the form, 'invalid' shows an
  // "expired link" panel. This is a real round-trip to GET /auth/password/reset/check
  // (which never consumes the token), so a bad/expired/already-used link never
  // reaches the form.
  const [status, setStatus] = useState(token ? 'checking' : 'invalid');

  useEffect(() => {
    if (!token) return;
    let active = true;
    api.checkResetToken(token)
      .then((res) => { if (active) setStatus(res && res.valid ? 'valid' : 'invalid'); })
      .catch(() => { if (active) setStatus('invalid'); });
    return () => { active = false; };
  }, [token]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    if (!token) {
      setError('Missing or invalid reset token.');
      return;
    }

    if (formData.newPassword !== formData.confirmPassword) {
      setError('Passwords do not match. Please try again.');
      return;
    }

    if (formData.newPassword.length < 12) {
      setError('Password must be at least 12 characters long.');
      return;
    }

    try {
      await api.resetPassword(
        token,
        formData.newPassword,
        formData.authCode
      );

      toast.success("Password reset successfully. Please log in with your new credentials.");
      navigate('/login');
    } catch (err) {
      setError(err.message);
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
            Secure your<br />
            <span style={{ color: '#E32636' }}>Account.</span>
          </h1>
          <p style={{ fontSize: '1.2rem', color: '#D1D5DB', maxWidth: '480px', lineHeight: '1.6', marginBottom: '48px' }}>
            Choose a strong, unique password to protect your finances. SecureBank requires a minimum of 12 characters.
          </p>

          <div style={{ backgroundColor: 'rgba(254, 242, 242, 0.1)', borderLeft: '4px solid #EF4444', padding: '24px', borderRadius: '0 8px 8px 0', maxWidth: '500px', backdropFilter: 'blur(8px)' }}>
            <h3 style={{ color: '#FCA5A5', fontSize: '1.05rem', margin: '0 0 12px 0', display: 'flex', alignItems: 'center', gap: '8px', fontWeight: '600' }}>
              <svg width="20" height="20" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M2.166 4.999A11.954 11.954 0 0010 1.944 11.954 11.954 0 0017.834 5c.11.65.166 1.32.166 2.001 0 5.225-3.34 9.67-8 11.317C5.34 16.67 2 12.225 2 7c0-.682.057-1.35.166-2.001zm11.541 3.708a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" /></svg>
              Best Practices
            </h3>
            <ul style={{ color: '#E5E7EB', fontSize: '0.95rem', margin: 0, paddingLeft: '20px', lineHeight: '1.6' }}>
              <li>Never reuse passwords across different sites.</li>
              <li>Avoid using personal information like birthdays or names.</li>
              <li>Use a mix of uppercase, lowercase, numbers, and symbols.</li>
            </ul>
          </div>
        </div>
      </div>

      {/* RIGHT PANEL: Reset Form */}
      <div style={{ flex: '1', backgroundColor: '#FFFFFF', display: 'flex', flexDirection: 'column', justifyContent: 'center', padding: '0 8%', minWidth: '500px' }}>
        
        <div style={{ maxWidth: '440px', width: '100%', margin: '0 auto' }}>

          {status === 'checking' && (
            <div style={{ textAlign: 'center', padding: '40px 0' }}>
              <div style={{ margin: '0 auto 20px', width: '40px', height: '40px', border: '4px solid #E5E7EB', borderTopColor: '#E32636', borderRadius: '50%', animation: 'reset-spin 0.8s linear infinite' }} />
              <h2 style={{ fontSize: '1.5rem', color: '#111827', margin: '0 0 8px 0', fontWeight: '700' }}>Verifying your reset link…</h2>
              <p style={{ color: '#6B7280', fontSize: '1rem', margin: 0 }}>This will only take a moment.</p>
              <style>{`@keyframes reset-spin { to { transform: rotate(360deg); } }`}</style>
            </div>
          )}

          {status === 'invalid' && (
            <div style={{ textAlign: 'center', padding: '20px 0' }}>
              <div style={{ margin: '0 auto 20px', width: '56px', height: '56px', borderRadius: '50%', backgroundColor: '#FEF2F2', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <svg width="28" height="28" fill="#DC2626" viewBox="0 0 20 20"><path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-8-5a1 1 0 011 1v4a1 1 0 11-2 0V6a1 1 0 011-1zm0 9a1 1 0 100-2 1 1 0 000 2z" clipRule="evenodd" /></svg>
              </div>
              <h2 style={{ fontSize: '1.75rem', color: '#111827', margin: '0 0 12px 0', fontWeight: '700', letterSpacing: '-0.5px' }}>This reset link is invalid or has expired</h2>
              <p style={{ color: '#4B5563', fontSize: '1.05rem', margin: '0 0 28px 0', lineHeight: '1.5' }}>
                Password reset links are single-use and expire after 30 minutes. Please request a new one.
              </p>
              <button
                type="button"
                onClick={() => navigate('/forgot-password')}
                style={{ width: '100%', padding: '16px', backgroundColor: '#E32636', color: '#FFFFFF', border: 'none', borderRadius: '8px', fontSize: '1.05rem', fontWeight: '700', cursor: 'pointer', transition: 'background-color 0.2s', boxShadow: '0 4px 6px -1px rgba(227, 38, 54, 0.2)' }}
                onMouseOver={(e) => e.target.style.backgroundColor = '#B91C1C'}
                onMouseOut={(e) => e.target.style.backgroundColor = '#E32636'}
              >
                Request a new reset link
              </button>
              <button
                type="button"
                onClick={() => navigate('/login')}
                style={{ background: 'none', border: 'none', color: '#6B7280', cursor: 'pointer', padding: '8px', fontSize: '0.95rem', fontWeight: '600', marginTop: '12px' }}
              >
                Back to log in
              </button>
            </div>
          )}

          {status === 'valid' && (<>
          <div style={{ marginBottom: '32px' }}>
            <h2 style={{ fontSize: '2rem', color: '#111827', margin: '0 0 12px 0', fontWeight: '700', letterSpacing: '-0.5px' }}>
              Reset your password
            </h2>
            <p style={{ color: '#4B5563', fontSize: '1.05rem', margin: 0, lineHeight: '1.5' }}>
              Please enter your new password and verify your identity with your authenticator app.
            </p>
          </div>

          {error && (
            <div style={{ padding: '12px 16px', backgroundColor: '#FEF2F2', border: '1px solid #F87171', color: '#B91C1C', borderRadius: '8px', marginBottom: '24px', fontSize: '0.95rem', fontWeight: '500' }}>
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
            
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <label htmlFor="newPassword" style={{ fontSize: '0.95rem', fontWeight: '600', color: '#374151' }}>New Password</label>
              <input 
                id="newPassword"
                type="password" 
                required
                placeholder="Enter your new password" 
                value={formData.newPassword}
                onChange={(e) => setFormData({...formData, newPassword: e.target.value})}
                style={{ padding: '14px 16px', border: '2px solid #E5E7EB', borderRadius: '8px', fontSize: '1rem', color: '#111827', outline: 'none', transition: 'border-color 0.2s', backgroundColor: '#F9FAFB' }} 
                onFocus={(e) => e.target.style.borderColor = '#E32636'}
                onBlur={(e) => e.target.style.borderColor = '#E5E7EB'}
              />
            </div>
            
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <label htmlFor="confirmPassword" style={{ fontSize: '0.95rem', fontWeight: '600', color: '#374151' }}>Confirm Password</label>
              <input 
                id="confirmPassword"
                type="password" 
                required
                placeholder="Re-enter your new password" 
                value={formData.confirmPassword}
                onChange={(e) => setFormData({...formData, confirmPassword: e.target.value})}
                style={{ padding: '14px 16px', border: '2px solid #E5E7EB', borderRadius: '8px', fontSize: '1rem', color: '#111827', outline: 'none', transition: 'border-color 0.2s', backgroundColor: '#F9FAFB' }}
                onFocus={(e) => e.target.style.borderColor = '#E32636'}
                onBlur={(e) => e.target.style.borderColor = '#E5E7EB'} 
              />
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '8px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <label htmlFor="authCode" style={{ fontSize: '0.95rem', fontWeight: '600', color: '#374151' }}>Authenticator Code</label>
              </div>
              <input 
                id="authCode"
                type="text" 
                required
                placeholder="e.g. 123456" 
                value={formData.authCode}
                onChange={(e) => setFormData({...formData, authCode: e.target.value.replace(/\s/g, '')})} // Remove spaces, allows letters for backup codes
                style={{ padding: '14px 16px', border: '2px solid #E5E7EB', borderRadius: '8px', fontSize: '1.2rem', letterSpacing: '2px', color: '#111827', outline: 'none', transition: 'border-color 0.2s', backgroundColor: '#F9FAFB' }}
                onFocus={(e) => e.target.style.borderColor = '#E32636'}
                onBlur={(e) => e.target.style.borderColor = '#E5E7EB'} 
              />
            </div>

            <div style={{ marginTop: '16px' }}>
              <button 
                type="submit" 
                style={{ width: '100%', padding: '16px', backgroundColor: '#E32636', color: '#FFFFFF', border: 'none', borderRadius: '8px', fontSize: '1.05rem', fontWeight: '700', cursor: 'pointer', transition: 'background-color 0.2s', boxShadow: '0 4px 6px -1px rgba(227, 38, 54, 0.2), 0 2px 4px -1px rgba(227, 38, 54, 0.1)' }}
                onMouseOver={(e) => e.target.style.backgroundColor = '#B91C1C'}
                onMouseOut={(e) => e.target.style.backgroundColor = '#E32636'}
              >
                Reset password
              </button>
            </div>
            
            <div style={{ textAlign: 'center', marginTop: '8px' }}>
              <button 
                type="button" 
                onClick={() => navigate('/login')}
                style={{ background: 'none', border: 'none', color: '#6B7280', cursor: 'pointer', padding: '8px', fontSize: '0.95rem', fontWeight: '600', transition: 'color 0.2s' }}
                onMouseOver={(e) => e.target.style.color = '#111827'}
                onMouseOut={(e) => e.target.style.color = '#6B7280'}
              >
                Cancel and return to log in
              </button>
            </div>
          </form>
          </>)}
        </div>

      </div>
    </div>
  );
}