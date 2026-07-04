import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from "../../api/api";

export default function Register() {
  const navigate = useNavigate();
  const [formData, setFormData] = useState({
    fullName: '',
    nric: '',
    email: '',
    password: '',
    confirmPassword: ''
  });

  const handleSubmit = async (e) => {
  e.preventDefault();

  if (formData.password !== formData.confirmPassword) {
    alert("Passwords do not match");
    return;
  }

  try {
    const response = await api.register(
      formData.fullName,
      formData.nric,
      formData.email,
      formData.password
    );

    console.log(response);

    /*
      Backend returns:
      {
          user_id,
          provisioning_uri,
          backup_codes
      }
    */

    navigate("/register/totp", {
      state: {
        email: formData.email,
        provisioningUri: response.provisioning_uri,
        backupCodes: response.backup_codes,
      },
    });

  } catch (err) {
    alert(err.message);
  }
};

  return (
    <div className="login-screen">
      <div className="login-portal">
        <header className="login-topbar">
          <div className="brand">
            <div className="brand-mark">SB</div>
            <div className="brand-text">
              <strong>SecureBank</strong>
              <span>Personal Internet Banking</span>
            </div>
          </div>
        </header>

        <div className="login-shell" style={{ maxWidth: '500px', margin: '0 auto' }}>
          <section className="login-panel">
            <div className="login-panel-header">
              <h2 className="section-title">Create an Account</h2>
            </div>

            <form onSubmit={handleSubmit} className="form-grid login-form" style={{ marginTop: "18px", gridTemplateColumns: "1fr" }}>
              <div className="field">
                <label>Full Name (as in NRIC)</label>
                <input type="text" required onChange={(e) => setFormData({...formData, fullName: e.target.value})} />
              </div>
              <div className="field">
                <label>NRIC</label>
                <input type="text" required onChange={(e) => setFormData({...formData, nric: e.target.value})} />
              </div>
              <div className="field">
                <label>Email Address</label>
                <input type="email" required onChange={(e) => setFormData({...formData, email: e.target.value})} />
              </div>
              <div className="field">
                <label>Password (Min 12 characters)</label>
                <input type="password" required onChange={(e) => setFormData({...formData, password: e.target.value})} />
              </div>
              <div className="field">
                <label>Confirm Password</label>
                <input type="password" required onChange={(e) => setFormData({...formData, confirmPassword: e.target.value})} />
              </div>
              
              <div className="hero-actions login-actions" style={{ marginTop: '20px' }}>
                <button type="submit" className="primary-button">Register</button>
                <button type="button" className="ghost-button" onClick={() => navigate('/login')}>Back to Login</button>
              </div>
            </form>
          </section>
        </div>
      </div>
    </div>
  );
}