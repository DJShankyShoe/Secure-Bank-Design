import React, { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { api } from "../../api/api";

export default function VerifyEmail({ onVerificationComplete }) {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const token = searchParams.get("token"); // e.g., ?token=12345abcdef
  
  // If there's a token in the URL, verify it. Otherwise, show the prompt!
  const [status, setStatus] = useState(token ? 'loading' : 'prompt');
  
  const [isResending, setIsResending] = useState(false);
  const [resendMessage, setResendMessage] = useState('');

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
            Security<br />
            <span style={{ color: '#E32636' }}>Requires</span><br />
            Certainty.
          </h1>
          <p style={{ fontSize: '1.2rem', color: '#D1D5DB', maxWidth: '480px', lineHeight: '1.6', marginBottom: '48px' }}>
            Confirming your email address ensures we can securely deliver important transaction receipts, OTPs, and account alerts.
          </p>
        </div>
      </div>

      {/* RIGHT PANEL: Verification Status */}
      <div style={{ flex: '1', backgroundColor: '#FFFFFF', display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', padding: '0 8%', minWidth: '500px', textAlign: 'center' }}>
        
        <div style={{ maxWidth: '400px', width: '100%' }}>
          
          {/* MODE 1: THE WAITING ROOM (No token, trapped user) */}
          {status === 'prompt' && (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '24px' }}>
              <div style={{ width: '64px', height: '64px', backgroundColor: '#EFF6FF', color: '#2563EB', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: '8px' }}>
                <svg width="32" height="32" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"></path></svg>
              </div>
              <div>
                <h2 style={{ fontSize: '1.75rem', color: '#111827', margin: '0 0 8px 0', fontWeight: '700' }}>Check Your Inbox</h2>
                <p style={{ color: '#4B5563', margin: 0, fontSize: '1.05rem', lineHeight: '1.5' }}>
                  We've sent a secure verification link to your email address. Please click the link to activate your account.
                </p>
              </div>
              
              <div style={{ width: '100%', marginTop: '8px' }}>
                <button 
                  onClick={handleResendEmail}
                  disabled={isResending}
                  style={{ width: '100%', padding: '16px', backgroundColor: isResending ? '#F3F4F6' : '#111827', color: isResending ? '#9CA3AF' : '#FFFFFF', border: 'none', borderRadius: '8px', fontSize: '1.05rem', fontWeight: '700', cursor: isResending ? 'not-allowed' : 'pointer', transition: 'background-color 0.2s' }}
                >
                  {isResending ? 'Sending...' : 'Resend Verification Email'}
                </button>
                
                {resendMessage && (
                  <p style={{ color: '#059669', fontSize: '0.9rem', marginTop: '12px', fontWeight: '500' }}>
                    ✓ {resendMessage}
                  </p>
                )}
              </div>
              
              {/* Escape Hatch in case they logged into the wrong account */}
              <button 
                onClick={handleLogout}
                style={{ background: 'none', border: 'none', color: '#6B7280', fontSize: '0.95rem', marginTop: '16px', cursor: 'pointer', textDecoration: 'underline' }}
              >
                Log in with a different account
              </button>
            </div>
          )}

          {/* MODE 2: PROCESSING A TOKEN */}
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

          {/* MODE 3: SUCCESS */}
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
                onClick={handleContinue}
                style={{ width: '100%', padding: '16px', backgroundColor: '#E32636', color: '#FFFFFF', border: 'none', borderRadius: '8px', fontSize: '1.05rem', fontWeight: '700', cursor: 'pointer', transition: 'background-color 0.2s', marginTop: '16px' }}
              >
                Continue to Dashboard
              </button>
            </div>
          )}

          {/* MODE 4: ERROR / EXPIRED LINK */}
          {status === 'error' && (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '24px' }}>
              <div style={{ width: '64px', height: '64px', backgroundColor: '#FEE2E2', color: '#DC2626', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: '8px' }}>
                <svg width="32" height="32" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" /></svg>
              </div>
              <div>
                <h2 style={{ fontSize: '1.75rem', color: '#111827', margin: '0 0 8px 0', fontWeight: '700' }}>Link Expired or Invalid</h2>
                <p style={{ color: '#4B5563', margin: 0, fontSize: '1.05rem', lineHeight: '1.5' }}>This verification link is invalid or has already expired.</p>
              </div>
              <button 
                onClick={() => {
                  navigate('/verify-email'); // Clears the token from the URL
                  setStatus('prompt');       // Sends them back to the Waiting Room
                }}
                style={{ width: '100%', padding: '16px', backgroundColor: '#111827', color: '#FFFFFF', border: 'none', borderRadius: '8px', fontSize: '1.05rem', fontWeight: '700', cursor: 'pointer', transition: 'background-color 0.2s', marginTop: '16px' }}
              >
                Request a new link
              </button>
            </div>
          )}

        </div>
      </div>
    </div>
  );
}