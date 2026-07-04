import React, { useState } from 'react';

export default function ManageAccount() {
  const [openData, setOpenData] = useState({ type: 'savings' });
  const [closeData, setCloseData] = useState({ accountId: '', totpCode: '' });

  const handleOpenAccount = async (e) => {
    e.preventDefault();
    // TODO (Backend): POST /admin/accounts/requests
    // Creates a new request with status 'pending' for admin approval.
    console.log("Mock Open Account Request:", openData);
    alert("Account opening request submitted for review.");
  };

  const handleCloseAccount = async (e) => {
    e.preventDefault();
    // TODO (Backend): POST /admin/accounts/{id}/closure
    // 1. Verify account balance == 0.
    // 2. Verify the TOTP code.
    // 3. Mark account status as 'close_requested' for admin approval.
    console.log(`Mock Close Account Request:`, closeData);
    alert("Account closure request submitted for review.");
  };

  return (
    <section className="section">
      <div className="section-header">
        <div>
          <h2 className="section-title">Account Management</h2>
          <div className="helper-text">Request a new account or close an existing one.</div>
        </div>
      </div>

      <div className="dual-grid">
        
        {/* LEFT: Request New Account */}
        <div className="content-card">
          <h3 className="card-title">Open New Account</h3>
          <p className="helper-text" style={{ marginBottom: '16px' }}>
            Submit a request to open an additional account. All requests are subject to approval.
          </p>
          <form onSubmit={handleOpenAccount} className="form-grid">
            <div className="field">
              <label>Account Type</label>
              <select required value={openData.type} onChange={(e) => setOpenData({...openData, type: e.target.value})}>
                <option value="savings">Savings Account</option>
                <option value="current">Current Account</option>
                <option value="fixed_deposit">Fixed Deposit Account</option>
              </select>
            </div>
            <div className="hero-actions" style={{ marginTop: '10px' }}>
              <button type="submit" className="primary-button">Submit Request</button>
            </div>
          </form>
        </div>

        {/* RIGHT: Close Existing Account */}
        <div className="content-card">
          <h3 className="card-title" style={{ color: '#DC2626' }}>Close Account</h3>
          <p className="helper-text" style={{ marginBottom: '16px' }}>
            Account balance must be exactly SGD 0.00 to proceed. Requires TOTP verification.
          </p>
          <form onSubmit={handleCloseAccount} className="form-grid">
            <div className="field">
              <label>Select Account to Close</label>
              <select required value={closeData.accountId} onChange={(e) => setCloseData({...closeData, accountId: e.target.value})}>
                <option value="">-- Select Account --</option>
                <option value="acc_1">Savings (****4831)</option>
                <option value="acc_2">Current (****9264)</option>
              </select>
            </div>
            <div className="field">
              <label>Authenticator Code (TOTP)</label>
              <input 
                type="text" 
                inputMode="numeric"
                maxLength="6" 
                required 
                placeholder="123456" 
                value={closeData.totpCode} 
                onChange={(e) => setCloseData({...closeData, totpCode: e.target.value.replace(/\D/g, '')})} 
              />
            </div>
            <div className="hero-actions" style={{ marginTop: '10px' }}>
              <button type="submit" className="secondary-button" style={{ borderColor: '#DC2626', color: '#DC2626' }}>Request Closure</button>
            </div>
          </form>
        </div>

      </div>
    </section>
  );
}