import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';

export default function ForgotPassword() {
  const navigate = useNavigate();
  const [step, setStep] = useState(1);
  const [recoveryData, setRecoveryData] = useState({ userId: '', email: '' });

  const handleSubmit = (e) => {
    e.preventDefault();
    // TODO (Backend):
    // 1. Verify if userId and email match a valid user in the DB.
    // 2. Generate a secure, time-limited JWT reset token.
    // 3. Send email via SMTPLib (from your Python stack).
    // 4. Always return a generic success message to prevent user enumeration (SR-10).
    console.log("Mock Recovery Request for:", recoveryData);
    setStep(2); // Move to success confirmation step
  };

  return (
    <div style={{ minHeight: '100vh', display: 'flex', fontFamily: 'system-ui, -apple-system, sans-serif' }}>
      
      {/* LEFT PANEL: Branding (Matches Login) */}
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
            Account<br />
            <span style={{ color: '#E32636' }}>Recovery.</span>
          </h1>
          <p style={{ fontSize: '1.2rem', color: '#D1D5DB', maxWidth: '480px', lineHeight: '1.6' }}>
            Regain access to your accounts safely. Our multi-layered security ensures your identity is protected at every step.
          </p>
        </div>
      </div>

      {/* RIGHT PANEL: Recovery Form */}
      <div style={{ flex: '1', backgroundColor: '#FFFFFF', display: 'flex', flexDirection: 'column', justifyContent: 'center', padding: '0 8%', minWidth: '500px' }}>
        
        <div style={{ maxWidth: '440px', width: '100%', margin: '0 auto' }}>
          
          <div style={{ marginBottom: '40px' }}>
            <button 
              onClick={() => navigate('/login')}
              style={{ background: 'none', border: 'none', color: '#6B7280', display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', padding: 0, marginBottom: '24px', fontSize: '0.95rem', fontWeight: '600', transition: 'color 0.2s' }}
              onMouseOver={(e) => e.target.style.color = '#111827'}
              onMouseOut={(e) => e.target.style.color = '#6B7280'}
            >
              <svg width="16" height="16" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M9.707 16.707a1 1 0 01-1.414 0l-6-6a1 1 0 010-1.414l6-6a1 1 0 011.414 1.414L5.414 9H17a1 1 0 110 2H5.414l4.293 4.293a1 1 0 010 1.414z" clipRule="evenodd" /></svg>
              Back to log in
            </button>
            <h2 style={{ fontSize: '2rem', color: '#111827', margin: '0 0 12px 0', fontWeight: '700', letterSpacing: '-0.5px' }}>
              {step === 1 ? "Forgot your password?" : "Check your inbox"}
            </h2>
            <p style={{ color: '#4B5563', fontSize: '1.05rem', margin: 0, lineHeight: '1.5' }}>
              {step === 1 
                ? "Enter your details below and we will send you a secure link to reset your password." 
                : "If the details provided match an active account, a password reset link has been sent to your email address. It will expire in 15 minutes."}
            </p>
          </div>

          {step === 1 ? (
            <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <label htmlFor="userId" style={{ fontSize: '0.95rem', fontWeight: '600', color: '#374151' }}>NRIC / User ID</label>
                <input 
                  id="userId"
                  type="text" 
                  required
                  placeholder="e.g. T1234567A" 
                  value={recoveryData.userId}
                  onChange={(e) => setRecoveryData({...recoveryData, userId: e.target.value})}
                  style={{ padding: '14px 16px', border: '2px solid #E5E7EB', borderRadius: '8px', fontSize: '1rem', color: '#111827', outline: 'none', transition: 'border-color 0.2s', backgroundColor: '#F9FAFB' }} 
                  onFocus={(e) => e.target.style.borderColor = '#E32636'}
                  onBlur={(e) => e.target.style.borderColor = '#E5E7EB'}
                />
              </div>
              
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <label htmlFor="email" style={{ fontSize: '0.95rem', fontWeight: '600', color: '#374151' }}>Registered Email Address</label>
                <input 
                  id="email"
                  type="email" 
                  required
                  placeholder="e.g. name@example.com" 
                  value={recoveryData.email}
                  onChange={(e) => setRecoveryData({...recoveryData, email: e.target.value})}
                  style={{ padding: '14px 16px', border: '2px solid #E5E7EB', borderRadius: '8px', fontSize: '1rem', color: '#111827', outline: 'none', transition: 'border-color 0.2s', backgroundColor: '#F9FAFB' }}
                  onFocus={(e) => e.target.style.borderColor = '#E32636'}
                  onBlur={(e) => e.target.style.borderColor = '#E5E7EB'} 
                />
              </div>

              <div style={{ marginTop: '8px' }}>
                <button 
                  type="submit" 
                  style={{ width: '100%', padding: '16px', backgroundColor: '#E32636', color: '#FFFFFF', border: 'none', borderRadius: '8px', fontSize: '1.05rem', fontWeight: '700', cursor: 'pointer', transition: 'background-color 0.2s', boxShadow: '0 4px 6px -1px rgba(227, 38, 54, 0.2), 0 2px 4px -1px rgba(227, 38, 54, 0.1)' }}
                  onMouseOver={(e) => e.target.style.backgroundColor = '#B91C1C'}
                  onMouseOut={(e) => e.target.style.backgroundColor = '#E32636'}
                >
                  Send Recovery Link
                </button>
              </div>
            </form>
          ) : (
            <div style={{ marginTop: '8px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <button 
                onClick={() => navigate('/login')}
                style={{ width: '100%', padding: '16px', backgroundColor: '#E32636', color: '#FFFFFF', border: 'none', borderRadius: '8px', fontSize: '1.05rem', fontWeight: '700', cursor: 'pointer', transition: 'background-color 0.2s', boxShadow: '0 4px 6px -1px rgba(227, 38, 54, 0.2), 0 2px 4px -1px rgba(227, 38, 54, 0.1)' }}
                onMouseOver={(e) => e.target.style.backgroundColor = '#B91C1C'}
                onMouseOut={(e) => e.target.style.backgroundColor = '#E32636'}
              >
                Return to log in
              </button>
            </div>
          )}
        </div>

        {/* Minimal Footer */}
        <div style={{ position: 'absolute', bottom: '32px', right: '8%', display: 'flex', gap: '24px', fontSize: '0.85rem', color: '#9CA3AF', fontWeight: '500' }}>
          <a href="#help" style={{ color: 'inherit', textDecoration: 'none' }}>Help Centre</a>
          <a href="#security" style={{ color: 'inherit', textDecoration: 'none' }}>Security</a>
        </div>
      </div>

    </div>
  );
}