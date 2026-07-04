import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';

export default function SetupPin({ onSetupComplete }) {
  const navigate = useNavigate();
  const [pinData, setPinData] = useState({ pin: '', confirmPin: '' });
  const [error, setError] = useState('');

  const handleSubmit = (e) => {
    e.preventDefault();
    setError('');

    // Strict validation
    if (pinData.pin.length !== 6) {
      setError('Your transaction PIN must be exactly 6 digits.');
      return;
    }
    if (pinData.pin !== pinData.confirmPin) {
      setError('The PINs do not match. Please try again.');
      return;
    }

    // TODO (Backend):
    // 1. Hash the PIN (Argon2id or bcrypt) before storing it in the database.
    // 2. Mark the user's `requires_pin_setup` flag as false in the database.
    console.log("Mock PIN Setup Complete:", pinData.pin);
    
    if (onSetupComplete) {
      onSetupComplete('customer');
    } 
    navigate('/dashboard');
  };

  return (
    <div style={{ minHeight: '100vh', display: 'flex', fontFamily: 'system-ui, -apple-system, sans-serif' }}>
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
            <span style={{ color: '#E32636' }}>Transactions.</span>
          </h1>
          <p style={{ fontSize: '1.2rem', color: '#D1D5DB', maxWidth: '480px', lineHeight: '1.6', marginBottom: '48px' }}>
            Before accessing your dashboard, please set up a 6-digit transaction PIN. This provides an extra layer of security for high-value transfers.
          </p>
        </div>
      </div>

      {/* PIN Setup Form */}
      <div style={{ flex: '1', backgroundColor: '#FFFFFF', display: 'flex', flexDirection: 'column', justifyContent: 'center', padding: '0 8%', minWidth: '500px' }}>
        
        <div style={{ maxWidth: '440px', width: '100%', margin: '0 auto' }}>
          
          <div style={{ marginBottom: '32px' }}>
            <h2 style={{ fontSize: '2rem', color: '#111827', margin: '0 0 12px 0', fontWeight: '700', letterSpacing: '-0.5px' }}>
              Create Transaction PIN
            </h2>
            <p style={{ color: '#4B5563', fontSize: '1.05rem', margin: 0, lineHeight: '1.5' }}>
              This PIN will be required for any fund transfers exceeding SGD 1,000. Do not share this PIN with anyone.
            </p>
          </div>

          {error && (
            <div style={{ padding: '12px 16px', backgroundColor: '#FEF2F2', border: '1px solid #F87171', color: '#B91C1C', borderRadius: '8px', marginBottom: '24px', fontSize: '0.95rem', fontWeight: '500' }}>
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
            
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <label htmlFor="pin" style={{ fontSize: '0.95rem', fontWeight: '600', color: '#374151' }}>Enter 6-Digit PIN</label>
              <input 
                id="pin"
                type="password" 
                inputMode="numeric"
                maxLength="6"
                required
                placeholder="• • • • • •" 
                value={pinData.pin}
                onChange={(e) => setPinData({...pinData, pin: e.target.value.replace(/\D/g, '')})}
                style={{ padding: '16px', border: '2px solid #E5E7EB', borderRadius: '8px', fontSize: '1.5rem', letterSpacing: '8px', textAlign: 'center', color: '#111827', outline: 'none', transition: 'border-color 0.2s', backgroundColor: '#F9FAFB', fontWeight: '700' }} 
                onFocus={(e) => e.target.style.borderColor = '#E32636'}
                onBlur={(e) => e.target.style.borderColor = '#E5E7EB'}
              />
            </div>
            
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <label htmlFor="confirmPin" style={{ fontSize: '0.95rem', fontWeight: '600', color: '#374151' }}>Confirm 6-Digit PIN</label>
              <input 
                id="confirmPin"
                type="password" 
                inputMode="numeric"
                maxLength="6"
                required
                placeholder="• • • • • •" 
                value={pinData.confirmPin}
                onChange={(e) => setPinData({...pinData, confirmPin: e.target.value.replace(/\D/g, '')})}
                style={{ padding: '16px', border: '2px solid #E5E7EB', borderRadius: '8px', fontSize: '1.5rem', letterSpacing: '8px', textAlign: 'center', color: '#111827', outline: 'none', transition: 'border-color 0.2s', backgroundColor: '#F9FAFB', fontWeight: '700' }}
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
                Complete Setup
              </button>
            </div>
          </form>
        </div>

      </div>
    </div>
  );
}