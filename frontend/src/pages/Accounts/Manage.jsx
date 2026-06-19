import React, { useState } from 'react';

export default function ManageAccount() {
  const [newEmail, setNewEmail] = useState('');
  const [totpCode, setTotpCode] = useState('');
  const [accountToClose, setAccountToClose] = useState('');

  const handleUpdateEmail = async (e) => {
    e.preventDefault();
    // TODO 
    // 1. Validate email format (RFC 5322) server-side (SR-06).
    // 2. Send time-limited verification link (30 mins) to the new email.
    // 3. Do NOT change email until link is clicked.
    console.log("Mock Email Update request for:", newEmail);
    alert("Verification link sent to your new email.");
  };

  const handleCloseAccount = async (e) => {
    e.preventDefault();
    // TODO
    // 1. Verify account balance == 0.
    // 2. Verify the fresh TOTP code provided (SR-11).
    // 3. Mark account as closed and log to audit_events (SR-14).
    console.log(`Mock Close Account: ${accountToClose} with TOTP: ${totpCode}`);
    alert("Account closure request submitted.");
  };

  return (
    <section className="section">
      <div className="section-header">
        <div>
          <h2 className="section-title">Manage Accounts</h2>
          <div className="helper-text">Update your contact details or request account closure.</div>
        </div>
      </div>

      <div className="dual-grid">
        <div className="content-card">
          <h3 className="card-title">Update Email Address</h3>
          <form onSubmit={handleUpdateEmail} className="form-grid">
            <div className="field">
              <label>New Email Address</label>
              <input type="email" required value={newEmail} onChange={(e) => setNewEmail(e.target.value)} />
            </div>
            <div className="hero-actions" style={{ marginTop: '10px' }}>
              <button type="submit" className="primary-button">Send Verification Link</button>
            </div>
          </form>
        </div>

        <div className="content-card">
          <h3 className="card-title" style={{ color: '#d93025' }}>Close Account</h3>
          <p className="helper-text" style={{ marginBottom: '16px' }}>
            Account balance must be SGD 0.00 to proceed. Requires TOTP verification.
          </p>
          <form onSubmit={handleCloseAccount} className="form-grid">
            <div className="field">
              <label>Select Account to Close</label>
              <select required value={accountToClose} onChange={(e) => setAccountToClose(e.target.value)}>
                <option value="">-- Select Account --</option>
                <option value="acc_1">Savings (****4831)</option>
              </select>
            </div>
            <div className="field">
              <label>Authenticator Code (TOTP)</label>
              <input type="text" maxLength="6" required placeholder="123456" value={totpCode} onChange={(e) => setTotpCode(e.target.value)} />
            </div>
            <div className="hero-actions" style={{ marginTop: '10px' }}>
              <button type="submit" className="secondary-button" style={{ borderColor: '#d93025', color: '#d93025' }}>Close Account</button>
            </div>
          </form>
        </div>
      </div>
    </section>
  );
}