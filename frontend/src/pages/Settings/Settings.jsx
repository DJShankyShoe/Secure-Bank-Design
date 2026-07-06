import React, { useState, useEffect } from 'react';
import { toast } from '../../ui/notify.jsx';
import { api } from '../../api/api';

export default function Settings() {
  const [newEmail, setNewEmail] = useState('');
  const [emailPassword, setEmailPassword] = useState('');
  const [passwordData, setPasswordData] = useState({ current: '', new: '', confirm: '' });
  // Transaction PIN (SR-12): first-time setup needs no password; replacing an
  // existing PIN re-verifies the current password (matches POST /transactions/pin).
  const [pinData, setPinData] = useState({ password: '', pin: '', confirm: '' });
  const [pinIsSet, setPinIsSet] = useState(false);
  const [notifyOnTransfer, setNotifyOnTransfer] = useState(true);
  const [notifyOnLogin, setNotifyOnLogin] = useState(true);
  const [isSubmittingEmail, setIsSubmittingEmail] = useState(false);
  const [isSubmittingPassword, setIsSubmittingPassword] = useState(false);
  const [isSubmittingPin, setIsSubmittingPin] = useState(false);

  // Show instantly from the cached profile, then refresh from the server.
  const [currentEmail, setCurrentEmail] = useState(() => {
    try {
      return JSON.parse(sessionStorage.getItem('securebank_user') || '{}').email || '';
    } catch {
      return '';
    }
  });

  useEffect(() => {
    api.getAccountPreferences()
      .then(data => {
        setNotifyOnTransfer(data.notify_on_transfer);
        setNotifyOnLogin(data.notify_on_login);
      })
      .catch(() => {});

    api.me()
      .then(profile => profile.email && setCurrentEmail(profile.email))
      .catch(() => {});

    api.getPinStatus()
      .then(data => setPinIsSet(!!data.pin_set))
      .catch(() => {});
  }, []);

  const handleUpdateEmail = async (e) => {
    e.preventDefault();
    if (isSubmittingEmail) return;
    try {
      setIsSubmittingEmail(true);
      await api.requestEmailChange(newEmail, emailPassword);
      toast.success("Verification link sent to your new email. A security alert has been sent to your current email.");
      setNewEmail('');
      setEmailPassword('');
    } catch (err) {
      toast.error(err.message);
    } finally {
      setIsSubmittingEmail(false);
    }
  };

  const handleChangePassword = async (e) => {
    e.preventDefault();
    if (isSubmittingPassword) return;
    if (passwordData.new !== passwordData.confirm) {
      toast.error("New passwords do not match.");
      return;
    }
    try {
      setIsSubmittingPassword(true);
      await api.changePassword(passwordData.current, passwordData.new);
      toast.success("Password updated successfully.");
      setPasswordData({ current: '', new: '', confirm: '' });
    } catch (err) {
      toast.error(err.message || "Could not update password.");
    } finally {
      setIsSubmittingPassword(false);
    }
  };

  const handleChangePin = async (e) => {
    e.preventDefault();
    if (isSubmittingPin) return;
    if (!/^\d{6}$/.test(pinData.pin)) {
      toast.error("PIN must be exactly 6 digits.");
      return;
    }
    if (pinData.pin !== pinData.confirm) {
      toast.error("PINs do not match.");
      return;
    }
    // Replacing an existing PIN requires the current password (backend enforces it
    // too; a first-time setup does not).
    if (pinIsSet && !pinData.password) {
      toast.error("Enter your current password to change your PIN.");
      return;
    }
    try {
      setIsSubmittingPin(true);
      await api.setTransactionPin(pinData.pin, pinIsSet ? pinData.password : null);
      toast.success(pinIsSet ? "Transaction PIN updated." : "Transaction PIN set.");
      setPinData({ password: '', pin: '', confirm: '' });
      setPinIsSet(true);
    } catch (err) {
      toast.error(err.message || "Could not update PIN.");
    } finally {
      setIsSubmittingPin(false);
    }
  };

  const handleToggleTransfer = async (e) => {
    const isChecked = e.target.checked;
    setNotifyOnTransfer(isChecked);
    try {
      await api.updateAccountPreferences({ notify_on_transfer: isChecked });
    } catch {
      setNotifyOnTransfer(!isChecked);
    }
  };

  const handleToggleLogin = async (e) => {
    const isChecked = e.target.checked;
    setNotifyOnLogin(isChecked);
    try {
      await api.updateAccountPreferences({ notify_on_login: isChecked });
    } catch {
      setNotifyOnLogin(!isChecked);
    }
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
          <div className="helper-text" style={{ marginTop: '8px' }}>
            Current email: <strong style={{ color: '#111827' }}>{currentEmail || '—'}</strong>
          </div>
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
            <div className="field">
              <label>Current Password</label>
              <input
                type="password"
                required
                placeholder="Confirm your password to change email"
                value={emailPassword}
                onChange={(e) => setEmailPassword(e.target.value)}
              />
            </div>
            <div>
              <button type="submit" className="primary-button" disabled={isSubmittingEmail}>{isSubmittingEmail ? "Sending..." : "Send Verification Link"}</button>
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
              <button type="submit" className="secondary-button" disabled={isSubmittingPassword} style={{ borderColor: '#111827', color: '#111827', width: '100%', height: '42px', fontWeight: '600' }}>
                {isSubmittingPassword ? "Updating..." : "Update Password"}
              </button>
            </div>
          </form>
        </div>

        {/* --- TRANSACTION PIN --- */}
        <div className="content-card">
          <h3 className="card-title">{pinIsSet ? "Change Transaction PIN" : "Set Transaction PIN"}</h3>
          <p style={{ color: '#6B7280', margin: '4px 0 0 0', fontSize: '0.9rem' }}>
            A 6-digit PIN is required to confirm transfers of SGD 1,000 or more.
            {pinIsSet
              ? " Changing it re-verifies your current password."
              : " You haven't set one yet."}
          </p>
          <form onSubmit={handleChangePin} style={{
            display: 'grid',
            gridTemplateColumns: '1fr 1fr',
            gap: '24px',
            maxWidth: '600px',
            marginTop: '16px',
            alignItems: 'end'
          }}>
            {pinIsSet && (
              <div className="field" style={{ marginBottom: 0 }}>
                <label>Current Password</label>
                <input
                  type="password"
                  required
                  value={pinData.password}
                  onChange={(e) => setPinData({ ...pinData, password: e.target.value })}
                />
              </div>
            )}
            <div className="field" style={{ marginBottom: 0 }}>
              <label>New 6-digit PIN</label>
              <input
                type="password"
                inputMode="numeric"
                maxLength={6}
                required
                value={pinData.pin}
                onChange={(e) => setPinData({ ...pinData, pin: e.target.value.replace(/\D/g, '') })}
              />
            </div>
            <div className="field" style={{ marginBottom: 0 }}>
              <label>Confirm New PIN</label>
              <input
                type="password"
                inputMode="numeric"
                maxLength={6}
                required
                value={pinData.confirm}
                onChange={(e) => setPinData({ ...pinData, confirm: e.target.value.replace(/\D/g, '') })}
              />
            </div>
            <div>
              <button type="submit" className="secondary-button" disabled={isSubmittingPin} style={{ borderColor: '#111827', color: '#111827', width: '100%', height: '42px', fontWeight: '600' }}>
                {isSubmittingPin ? "Saving..." : (pinIsSet ? "Update PIN" : "Set PIN")}
              </button>
            </div>
          </form>
        </div>

      </div>
    </section>
  );
}