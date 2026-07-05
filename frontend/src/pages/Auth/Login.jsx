import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from "../../api/api";

export default function Login({ onLoginSuccess }) {
  const navigate = useNavigate();

  // UI State
  const [authStep, setAuthStep] = useState('credentials'); // 'credentials' or 'mfa'
  const [error, setError] = useState('');

  // Data State
  const [credentials, setCredentials] = useState({ email: '', password: '' });
  const [securityCode, setSecurityCode] = useState('');
  const [mfaToken, setMfaToken] = useState('');

  const handlePrimaryAction = async (e) => {
    e.preventDefault();
    setError('');

    if (authStep === 'credentials') {
      // --- STAGE 1: CREDENTIAL VERIFICATION ---
      try {
        const response = await api.login(credentials.email, credentials.password);

        // If login succeeds and requires a second step, the backend gives us an MFA token
        setMfaToken(response.mfa_token);
        setAuthStep('mfa');

      } catch (err) {
        // --- SOFT 403 HANDLING (The Traffic Cop Integration) ---
        // If the backend throws an error but it's specifically our verification prompt...
        if (err.status === 403 && err.data && err.data.status === "verification_required") {

          // Stash the email so the next page can prefill / resend to it
          sessionStorage.setItem("securebank_pending_email", credentials.email);

          // Backend reports which step is outstanding via two booleans.
          // Finish TOTP enrolment first (if not yet confirmed), otherwise the
          // remaining step is signup email verification.
          if (!err.data.totp_confirmed) {
            navigate('/register/totp', { state: { email: credentials.email } });
          } else {
            navigate('/verify-email', { state: { email: credentials.email } });
          }
          return;
        }

        // Otherwise, it's a real error (e.g., wrong password)
        setError(err.message || 'Invalid Email or Password. Please try again.');
      }

    } else {
      // --- STAGE 2: MFA / PIN VERIFICATION ---
      try {
        await api.verifyMfa(mfaToken, securityCode);

        // Pull the profile so the app can personalise the UI (sidebar, dashboard)
        // and gate by the real role. Non-fatal if it fails — fall back to defaults.
        let profile = {};
        try {
          profile = await api.me();
          sessionStorage.setItem("securebank_user", JSON.stringify(profile));
        } catch (profileErr) {
          console.error(profileErr);
        }

        // ✅ PIN status comes from its own endpoint, not /auth/me.
        // GET /transactions/pin -> { pin_set: true/false }
        let pinSetupCompleted = false;
        try {
          const pinStatus = await api.getPinStatus();
          pinSetupCompleted = pinStatus.pin_set ?? false;
        } catch (pinErr) {
          console.error("Could not check PIN status", pinErr);
        }

        // If MFA succeeds, they are fully verified on the credentials front.
        onLoginSuccess({
          role: profile.role || 'customer',
          emailVerified: profile.email_verified ?? true,
          totpConfirmed: true,
          pinSetupCompleted
        });

      } catch (err) {
        setError(err.message || 'Invalid security code. Please try again.');
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

            <h2 style={{ fontSize: '2rem', color: '#111827', margin: '0 0 12px 0', fontWeight: '700', letterSpacing: '-0.5px' }}>
              {authStep === 'mfa' ? "Security Verification" : "Welcome Back"}
            </h2>
            <p style={{ color: '#4B5563', fontSize: '1.05rem', margin: 0 }}>
              {authStep === 'mfa' ? "Please enter the 6-digit code from your authenticator app to confirm your identity." : "Please enter your credentials to securely access your accounts."}
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
                  <label htmlFor="email" style={{ fontSize: '0.95rem', fontWeight: '600', color: '#374151' }}>Email Address</label>
                  <input
                    id="email"
                    type="email"
                    required
                    placeholder="name@example.com"
                    value={credentials.email}
                    onChange={(e) => setCredentials({ ...credentials, email: e.target.value })}
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
                    onChange={(e) => setCredentials({ ...credentials, password: e.target.value })}
                    style={{ padding: '14px 16px', border: '2px solid #E5E7EB', borderRadius: '8px', fontSize: '1rem', color: '#111827', outline: 'none', transition: 'border-color 0.2s', backgroundColor: '#F9FAFB' }}
                    onFocus={(e) => e.target.style.borderColor = '#E32636'}
                    onBlur={(e) => e.target.style.borderColor = '#E5E7EB'}
                  />
                </div>
              </>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <label htmlFor="securityCode" style={{ fontSize: '0.95rem', fontWeight: '600', color: '#374151' }}>6-Digit Authenticator Code (OTP)</label>
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