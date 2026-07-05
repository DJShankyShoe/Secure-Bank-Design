import React, { useEffect, useState } from 'react';
import { toast } from '../../ui/notify.jsx';
import { api } from '../../api/api';

/**
 * Settings for admin / superadmin staff: update email and change password.
 * Reuses the role-agnostic auth endpoints (POST /auth/email, POST
 * /auth/password/change) — the same ones customers use. No customer-only
 * notification preferences here.
 */
export default function StaffSettings() {
  const [newEmail, setNewEmail] = useState('');
  const [emailPassword, setEmailPassword] = useState('');
  const [passwordData, setPasswordData] = useState({ current: '', new: '', confirm: '' });
  const [submittingEmail, setSubmittingEmail] = useState(false);
  const [submittingPassword, setSubmittingPassword] = useState(false);

  const [currentEmail, setCurrentEmail] = useState(() => {
    try {
      return JSON.parse(sessionStorage.getItem('securebank_user') || '{}').email || '';
    } catch {
      return '';
    }
  });

  useEffect(() => {
    api.me().then((p) => p.email && setCurrentEmail(p.email)).catch(() => {});
  }, []);

  const handleUpdateEmail = async (e) => {
    e.preventDefault();
    if (submittingEmail) return;
    try {
      setSubmittingEmail(true);
      await api.requestEmailChange(newEmail, emailPassword);
      toast.success('Verification link sent to your new email. A security alert was sent to your current address.');
      setNewEmail('');
      setEmailPassword('');
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSubmittingEmail(false);
    }
  };

  const handleChangePassword = async (e) => {
    e.preventDefault();
    if (submittingPassword) return;
    if (passwordData.new !== passwordData.confirm) {
      toast.error('New passwords do not match.');
      return;
    }
    try {
      setSubmittingPassword(true);
      await api.changePassword(passwordData.current, passwordData.new);
      toast.success('Password updated successfully.');
      setPasswordData({ current: '', new: '', confirm: '' });
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSubmittingPassword(false);
    }
  };

  return (
    <section className="section" style={{ maxWidth: '900px' }}>
      <div className="section-header">
        <div>
          <h2 className="section-title">Account Settings</h2>
          <div className="helper-text">Manage your staff account credentials.</div>
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '32px' }}>
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
              <button type="submit" className="primary-button" disabled={submittingEmail}>
                {submittingEmail ? 'Sending…' : 'Send Verification Link'}
              </button>
            </div>
          </form>
        </div>

        {/* --- CHANGE PASSWORD --- */}
        <div className="content-card">
          <h3 className="card-title">Change Password</h3>
          <form onSubmit={handleChangePassword} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '24px', maxWidth: '600px', marginTop: '16px', alignItems: 'end' }}>
            <div className="field" style={{ marginBottom: 0 }}>
              <label>Current Password</label>
              <input type="password" required value={passwordData.current}
                onChange={(e) => setPasswordData({ ...passwordData, current: e.target.value })} />
            </div>
            <div className="field" style={{ marginBottom: 0 }}>
              <label>New Password (Min 12 characters)</label>
              <input type="password" required value={passwordData.new}
                onChange={(e) => setPasswordData({ ...passwordData, new: e.target.value })} />
            </div>
            <div className="field" style={{ marginBottom: 0 }}>
              <label>Confirm New Password</label>
              <input type="password" required value={passwordData.confirm}
                onChange={(e) => setPasswordData({ ...passwordData, confirm: e.target.value })} />
            </div>
            <div>
              <button type="submit" className="secondary-button" disabled={submittingPassword}
                style={{ borderColor: '#111827', color: '#111827', width: '100%', height: '42px', fontWeight: '600' }}>
                {submittingPassword ? 'Updating…' : 'Update Password'}
              </button>
            </div>
          </form>
        </div>
      </div>
    </section>
  );
}
