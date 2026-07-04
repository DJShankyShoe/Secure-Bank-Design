import React, { useState } from 'react';

export default function Settings() {
  const [newEmail, setNewEmail] = useState('');
  const [passwordData, setPasswordData] = useState({ current: '', new: '', confirm: '' });
  
  // Controls the notification preferences
  const [notifyOnTransfer, setNotifyOnTransfer] = useState(true);
  const [notifyOnLogin, setNotifyOnLogin] = useState(true);

  const handleUpdateEmail = async (e) => {
    e.preventDefault();
    // TODO (Backend):
    // 1. Send "Confirm your new SecureBank email" to the NEW email address.
    // 2. Send "SecureBank email change requested" alert to the OLD/CURRENT email address.
    // 3. Do NOT change the email in the DB until the link in the new email is clicked.
    console.log("Mock Email Update request for:", newEmail);
    alert("Verification link sent to your new email. A security alert has been sent to your current email.");
    setNewEmail('');
  };

  const handleChangePassword = async (e) => {
    e.preventDefault();
    if (passwordData.new !== passwordData.confirm) {
      alert("New passwords do not match.");
      return;
    }
    if (passwordData.new.length < 12) {
      alert("Password must be at least 12 characters.");
      return;
    }
    // TODO (Backend): Verify current password, hash new password, update DB, invalidate all sessions.
    console.log("Mock Password Change");
    alert("Password updated successfully.");
    setPasswordData({ current: '', new: '', confirm: '' });
  };

  const handleToggleTransfer = (e) => {
    const isChecked = e.target.checked;
    setNotifyOnTransfer(isChecked);
    // TODO (Backend): Update user.notify_on_transfer = isChecked in DB.
    console.log("Mock Preference Update: notify_on_transfer =", isChecked);
  };

  const handleToggleLogin = (e) => {
    const isChecked = e.target.checked;
    setNotifyOnLogin(isChecked);
    // TODO (Backend): Update user.notify_on_login = isChecked in DB.
    console.log("Mock Preference Update: notify_on_login =", isChecked);
  };

  return (
    <section className="section" style={{ maxWidth: '900px' }}>
      <div className="section-header">
        <div>
          <h2 className="section-title">Security & Settings</h2>
          <div className="helper-text">Manage your credentials, contact information, and notifications.</div>
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '32px' }}>
        
        {/* --- NOTIFICATION PREFERENCES --- */}
        <div className="content-card">
          <h3 className="card-title">Notification Preferences</h3>
          
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', marginTop: '16px' }}>
            {/* Transfer Preference */}
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                <input 
                  type="checkbox" 
                  id="notifyTransfer"
                  checked={notifyOnTransfer}
                  onChange={handleToggleTransfer}
                  style={{ width: '18px', height: '18px', cursor: 'pointer' }}
                />
                <label htmlFor="notifyTransfer" style={{ cursor: 'pointer', fontSize: '1rem', color: '#374151', fontWeight: '500' }}>
                  Send email receipts for successful fund transfers and bill payments.
                </label>
              </div>
              <p className="helper-text" style={{ marginTop: '4px', marginLeft: '30px' }}>
                If disabled, you can still view your receipts in the Transaction History tab.
              </p>
            </div>

            {/* Login Preference */}
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                <input 
                  type="checkbox" 
                  id="notifyLogin"
                  checked={notifyOnLogin}
                  onChange={handleToggleLogin}
                  style={{ width: '18px', height: '18px', cursor: 'pointer' }}
                />
                <label htmlFor="notifyLogin" style={{ cursor: 'pointer', fontSize: '1rem', color: '#374151', fontWeight: '500' }}>
                  Send an email alert upon every successful login.
                </label>
              </div>
              <p className="helper-text" style={{ marginTop: '4px', marginLeft: '30px' }}>
                Recommended for maximum security to monitor unauthorized access.
              </p>
            </div>
          </div>
        </div>

        {/* --- UPDATE EMAIL --- */}
        <div className="content-card">
          <h3 className="card-title">Update Email Address</h3>
          <form onSubmit={handleUpdateEmail} style={{ display: 'flex', flexDirection: 'column', gap: '16px', maxWidth: '400px', marginTop: '16px' }}>
            <div className="field">
              <label>New Email Address</label>
              <input 
                type="email" 
                required 
                placeholder="e.g. new.email@example.com"
                value={newEmail} 
                onChange={(e) => setNewEmail(e.target.value)} 
              />
            </div>
            <div>
              <button type="submit" className="primary-button">Send Verification Link</button>
            </div>
          </form>
        </div>

        {/* --- CHANGE PASSWORD --- */}
        <div className="content-card">
          <h3 className="card-title">Change Password</h3>
          <form onSubmit={handleChangePassword} style={{ 
            display: 'grid', 
            gridTemplateColumns: '1fr 1fr', 
            gap: '24px', 
            maxWidth: '600px', 
            marginTop: '16px',
            alignItems: 'end'
          }}>
            <div className="field" style={{ marginBottom: 0 }}>
              <label>Current Password</label>
              <input 
                type="password" 
                required 
                value={passwordData.current} 
                onChange={(e) => setPasswordData({...passwordData, current: e.target.value})} 
              />
            </div>
            <div className="field" style={{ marginBottom: 0 }}>
              <label>New Password (Min 12 characters)</label>
              <input 
                type="password" 
                required 
                value={passwordData.new} 
                onChange={(e) => setPasswordData({...passwordData, new: e.target.value})} 
              />
            </div>
            <div className="field" style={{ marginBottom: 0 }}>
              <label>Confirm New Password</label>
              <input 
                type="password" 
                required 
                value={passwordData.confirm} 
                onChange={(e) => setPasswordData({...passwordData, confirm: e.target.value})} 
              />
            </div>
            <div>
              <button type="submit" className="secondary-button" style={{ borderColor: '#111827', color: '#111827', width: '100%', height: '42px', fontWeight: '600' }}>
                Update Password
              </button>
            </div>
          </form>
        </div>

      </div>
    </section>
  );
}