import React, { useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams, useLocation } from 'react-router-dom';
import { api } from "../../api/api";

export default function VerifyEmail({ onVerificationComplete, mode = "signup" }) {
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const token = searchParams.get("token");

  // "change" = confirming a NEW email address (FR-04); "signup" = activating a
  // new account's email (FR-01). They hit different backend endpoints.
  const isChange = mode === "change";

  const RESEND_COOLDOWN_SECONDS = 60;

  const [status, setStatus] = useState(token ? 'loading' : (isChange ? 'error' : 'prompt'));
  const [isResending, setIsResending] = useState(false);
  const [resendMessage, setResendMessage] = useState('');
  const [cooldown, setCooldown] = useState(0);

  // The account to verify is known from context (registration flow or a login
  // redirect) — never chosen here. No free-text email entry.
  const email =
    location.state?.email ||
    sessionStorage.getItem("securebank_pending_email") ||
    "";

  // Client-side resend throttle: the backend is intentionally generic (it can't
  // tell us it's rate-limited without leaking account existence), so we pace the
  // button ourselves.
  useEffect(() => {
    if (cooldown <= 0) return undefined;
    const timer = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(timer);
  }, [cooldown]);

  // Persists across React StrictMode's dev-mode double-invoke (mount ->
  // cleanup -> remount), unlike component state — needed because the token is
  // single-use server-side: without this, the double-invoke fires two real
  // verify requests, and whichever one loses the race gets "already used",
  // which can overwrite a genuine success with "Link Expired or Invalid".
  const verifyStartedRef = useRef(false);

  useEffect(() => {
    if (!token) {
      setStatus(isChange ? 'error' : 'prompt');
      return;
    }
    // Guards the CALL, not the result: since the ref makes this the only
    // verifyEmail() invocation that will ever run for this token, its result
    // is always the right one to apply, including from the StrictMode
    // "discarded" first effect instance — there is no second call to race.
    if (verifyStartedRef.current) return;
    verifyStartedRef.current = true;

    const verifyEmail = async () => {
      try {
        if (isChange) {
          await api.verifyEmailChange(token);
        } else {
          await api.verifySignupEmail(token);
        }
        setStatus('success');
      } catch (err) {
        console.error(err);
        setStatus('error');
      }
    };

    verifyEmail();
  }, [token, isChange]);

  const handleResendEmail = async () => {
    if (!email) {
      setResendMessage("Please log in first so we know which account to verify.");
      return;
    }
    if (cooldown > 0 || isResending) return;

    setIsResending(true);
    setResendMessage('');

    try {
      await api.resendVerificationEmail(email);
      sessionStorage.setItem("securebank_pending_email", email);
      setResendMessage("If your account still needs verifying, a new link is on its way. Please check your inbox.");
    } catch (err) {
      console.error(err);
      setResendMessage("Unable to resend right now. Please try again shortly.");
    } finally {
      setIsResending(false);
      // Start the cooldown regardless of the (generic) outcome, so repeated
      // taps can't hammer the endpoint.
      setCooldown(RESEND_COOLDOWN_SECONDS);
    }
  };

  const handleContinue = () => {
    if (onVerificationComplete) {
      onVerificationComplete();
    }

    sessionStorage.removeItem("securebank_pending_email");
    navigate('/login');
  };

  // Plain "go back" — no session/logout side effects, since at this point
  // (redirected from a failed login attempt) there usually isn't an active session yet.
  const handleBackToLogin = () => {
    navigate('/login');
  };

  return (
    <div style={{ minHeight: '100vh', display: 'flex', fontFamily: 'system-ui, -apple-system, sans-serif' }}>

      {/* LEFT PANEL */}
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

      {/* RIGHT PANEL */}
      <div style={{ flex: '1', backgroundColor: '#FFFFFF', display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', padding: '0 8%', minWidth: '500px', textAlign: 'center' }}>

        <div style={{ maxWidth: '400px', width: '100%' }}>

          {status === 'prompt' && (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '24px' }}>
              <div style={{ width: '64px', height: '64px', backgroundColor: '#EFF6FF', color: '#2563EB', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: '8px' }}>
                <svg width="32" height="32" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"></path>
                </svg>
              </div>

              <div>
                <h2 style={{ fontSize: '2 rem', color: '#111827', margin: '0 0 8px 0', fontWeight: '700' }}>Check Your Inbox</h2>
                <p style={{ color: '#4B5563', margin: 0, fontSize: '1.05rem', lineHeight: '1.5' }}>
                  We've sent a verification link to your registered email address. Click it to activate
                  your account. Didn't get it? You can resend it below.
                </p>
              </div>

              <div style={{ width: '100%', marginTop: '8px' }}>
                {(() => {
                  const resendDisabled = isResending || cooldown > 0;
                  const resendLabel = isResending
                    ? 'Sending...'
                    : cooldown > 0
                      ? `Resend available in ${cooldown}s`
                      : 'Resend Verification Email';
                  return (
                    <button
                      onClick={handleResendEmail}
                      disabled={resendDisabled}
                      style={{
                        width: '100%',
                        padding: '16px',
                        backgroundColor: resendDisabled ? '#F3F4F6' : '#111827',
                        color: resendDisabled ? '#9CA3AF' : '#FFFFFF',
                        border: 'none',
                        borderRadius: '8px',
                        fontSize: '1.05rem',
                        fontWeight: '700',
                        cursor: resendDisabled ? 'not-allowed' : 'pointer',
                        transition: 'background-color 0.2s'
                      }}
                    >
                      {resendLabel}
                    </button>
                  );
                })()}

                {resendMessage && (
                  <p style={{ color: '#059669', fontSize: '0.9rem', marginTop: '12px', fontWeight: '500' }}>
                    ✓ {resendMessage}
                  </p>
                )}

                {/* NEW: Back button */}
                <button
                  onClick={handleBackToLogin}
                  style={{
                    width: '100%',
                    padding: '14px',
                    marginTop: '12px',
                    backgroundColor: 'transparent',
                    color: '#374151',
                    border: '2px solid #E5E7EB',
                    borderRadius: '8px',
                    fontSize: '0.95rem',
                    fontWeight: '600',
                    cursor: 'pointer',
                    transition: 'border-color 0.2s, color 0.2s'
                  }}
                  onMouseOver={(e) => { e.target.style.borderColor = '#111827'; }}
                  onMouseOut={(e) => { e.target.style.borderColor = '#E5E7EB'; }}
                >
                  ← Back to Login
                </button>
              </div>
            </div>
          )}

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
                <svg width="32" height="32" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                </svg>
              </div>

              <div>
                <h2 style={{ fontSize: '1.75rem', color: '#111827', margin: '0 0 8px 0', fontWeight: '700' }}>{isChange ? 'Email Updated' : 'Email Verified'}</h2>
                <p style={{ color: '#4B5563', margin: 0, fontSize: '1.05rem', lineHeight: '1.5' }}>
                  {isChange
                    ? 'Your email address has been updated.'
                    : 'Your email address has been successfully confirmed. You can now log in.'}
                </p>
              </div>

              <button
                onClick={isChange ? () => navigate('/settings') : handleContinue}
                style={{ width: '100%', padding: '16px', backgroundColor: '#E32636', color: '#FFFFFF', border: 'none', borderRadius: '8px', fontSize: '1.05rem', fontWeight: '700', cursor: 'pointer', transition: 'background-color 0.2s', marginTop: '16px' }}
              >
                {isChange ? 'Back to Settings' : 'Proceed to Log In'}
              </button>
            </div>
          )}

          {status === 'error' && (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '24px' }}>
              <div style={{ width: '64px', height: '64px', backgroundColor: '#FEE2E2', color: '#DC2626', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: '8px' }}>
                <svg width="32" height="32" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
                </svg>
              </div>

              <div>
                <h2 style={{ fontSize: '1.75rem', color: '#111827', margin: '0 0 8px 0', fontWeight: '700' }}>Link Expired or Invalid</h2>
                <p style={{ color: '#4B5563', margin: 0, fontSize: '1.05rem', lineHeight: '1.5' }}>
                  {isChange
                    ? 'This email-change link is invalid or has already expired. Please request the change again from Settings.'
                    : 'This verification link is invalid or has already expired.'}
                </p>
              </div>

              {isChange ? (
                <button
                  onClick={() => navigate('/settings')}
                  style={{ width: '100%', padding: '16px', backgroundColor: '#271711', color: '#FFFFFF', border: 'none', borderRadius: '8px', fontSize: '1.05rem', fontWeight: '700', cursor: 'pointer', transition: 'background-color 0.2s', marginTop: '16px' }}
                >
                  Back to Settings
                </button>
              ) : (
                <>
                  <button
                    onClick={() => {
                      navigate('/verify-email');
                      setStatus('prompt');
                    }}
                    style={{ width: '100%', padding: '16px', backgroundColor: '#271711', color: '#FFFFFF', border: 'none', borderRadius: '8px', fontSize: '1.05rem', fontWeight: '700', cursor: 'pointer', transition: 'background-color 0.2s', marginTop: '16px' }}
                  >
                    Request a new link
                  </button>

                  {/* NEW: Back button on error state too */}
                  <button
                    onClick={handleBackToLogin}
                    style={{
                      width: '100%',
                      padding: '14px',
                      backgroundColor: 'transparent',
                      color: '#6B7280',
                      border: 'none',
                      cursor: 'pointer',
                      fontSize: '0.95rem',
                      fontWeight: '600'
                    }}
                  >
                    ← Back to Login
                  </button>
                </>
              )}
            </div>
          )}

        </div>
      </div>
    </div>
  );
}