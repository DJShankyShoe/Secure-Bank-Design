import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from "../../api/api";

export default function CreateAccount() {
  const navigate = useNavigate();
  const [accountType, setAccountType] = useState('savings');

  const handleCreate = async (e) => {
  e.preventDefault();

    try {
      const response = await api.createAccount(accountType);

      console.log(response);

      alert(
        `Account created successfully!\nAccount Number: ${response.account_number}`
      );

      navigate("/dashboard");

    } catch (err) {
      alert(err.message);
    }
  };

  return (
    <section className="section">
      <div className="section-header">
        <div>
          <h2 className="section-title">Open a New Account</h2>
          <div className="helper-text">Select the type of account you wish to open. The opening balance will be SGD 0.00.</div>
        </div>
      </div>

      <div className="content-card" style={{ maxWidth: '600px' }}>
        <form onSubmit={handleCreate} className="form-grid">
          <div className="field">
            <label>Account Type</label>
            <select value={accountType} onChange={(e) => setAccountType(e.target.value)}>
              <option value="savings">Savings Account</option>
              <option value="current">Current Account</option>
            </select>
          </div>
          
          <div className="field full">
            <div className="inline-note">
              By proceeding, you agree to the SecureBank Terms & Conditions for new deposit accounts.
            </div>
          </div>

          <div className="hero-actions">
            <button type="submit" className="primary-button">Open Account</button>
            <button type="button" className="secondary-button" onClick={() => navigate('/dashboard')}>Cancel</button>
          </div>
        </form>
      </div>
    </section>
  );
}