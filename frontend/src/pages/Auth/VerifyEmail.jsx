import React, { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { api } from "../../api/api";

export default function VerifyEmail() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const token = searchParams.get("token");
  
  // States: 'loading', 'success', 'error'
  const [status, setStatus] = useState('loading');

  useEffect(() => {
    const verifyEmail = async () => {
      if (!token) {
        setStatus('error');
        return;
      }

      try {
        await api.verifySignupEmail(token);
        setStatus('success');
      } catch (err) {
        console.error(err);
        setStatus('error');
      }
    };

    verifyEmail();
  }, [token]);

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
            Identity<br />
            <span style={{ color: '#E32636' }}>Verified.</span>
          </h1>
          <p style={{ fontSize: '1.2rem', color: '#D1D5DB', maxWidth: '480px', lineHeight: '1.6', marginBottom: '48px' }}>
            Confirming your email address ensures we can securely deliver important transaction receipts and account alerts.
          </p>
        </div>
      </div>

      {/* RIGHT PANEL: Verification Status */}
      <div style={{ flex: '1', backgroundColor: '#FFFFFF', display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', padding: '0 8%', minWidth: '500px', textAlign: 'center' }}>
        
        <div style={{ maxWidth: '400px', width: '100%' }}>
          
          {status === 'loading' && (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '24px' }}>
              <div style={{ width: '48px', height: '48px', border: '4px solid #F3F4F6', borderTopColor: '#E32636', borderRadius: '50%', animation: 'spin 1s linear infinite' }} />
              <style>
                {`@keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }`}
              </style>
              <div>
                <h2 style={{ fontSize: '1.75rem', color: '#111827', margin: '0 0 8px 0', fontWeight: '700' }}>Verifying email...</h2>
                <p style={{ color: '#6B7280', margin: 0, fontSize: '1.05rem', lineHeight: '1.5' }}>Please wait while we confirm your secure token.</p>
              </div>
            </div>
          )}

          {status === 'success' && (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '24px' }}>
              <div style={{ width: '64px', height: '64px', backgroundColor: '#DEF7EC', color: '#059669', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: '8px' }}>
                <svg width="32" height="32" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" /></svg>
              </div>
              <div>
                <h2 style={{ fontSize: '1.75rem', color: '#111827', margin: '0 0 8px 0', fontWeight: '700' }}>Email Verified</h2>
                <p style={{ color: '#4B5563', margin: 0, fontSize: '1.05rem', lineHeight: '1.5' }}>Your email address has been successfully confirmed. Your account is now fully active.</p>
              </div>
              <button 
                onClick={() => navigate('/login')}
                style={{ width: '100%', padding: '16px', backgroundColor: '#E32636', color: '#FFFFFF', border: 'none', borderRadius: '8px', fontSize: '1.05rem', fontWeight: '700', cursor: 'pointer', transition: 'background-color 0.2s', marginTop: '16px' }}
                onMouseOver={(e) => e.target.style.backgroundColor = '#B91C1C'}
                onMouseOut={(e) => e.target.style.backgroundColor = '#E32636'}
              >
                Proceed to Log In
              </button>
            </div>
          )}

          {status === 'error' && (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '24px' }}>
              <div style={{ width: '64px', height: '64px', backgroundColor: '#FEE2E2', color: '#DC2626', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: '8px' }}>
                <svg width="32" height="32" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" /></svg>
              </div>
              <div>
                <h2 style={{ fontSize: '1.75rem', color: '#111827', margin: '0 0 8px 0', fontWeight: '700' }}>Link Expired or Invalid</h2>
                <p style={{ color: '#4B5563', margin: 0, fontSize: '1.05rem', lineHeight: '1.5' }}>This verification link is invalid or has already expired. Please log in to request a new link.</p>
              </div>
              <button 
                onClick={() => navigate('/login')}
                style={{ width: '100%', padding: '16px', backgroundColor: '#111827', color: '#FFFFFF', border: 'none', borderRadius: '8px', fontSize: '1.05rem', fontWeight: '700', cursor: 'pointer', transition: 'background-color 0.2s', marginTop: '16px' }}
                onMouseOver={(e) => e.target.style.backgroundColor = '#374151'}
                onMouseOut={(e) => e.target.style.backgroundColor = '#111827'}
              >
                Return to Log In
              </button>
            </div>
          )}

        </div>
      </div>
    </div>
  );
}