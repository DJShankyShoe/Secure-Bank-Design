import React, { useState } from 'react';

export default function PayBill() {
  const [paymentData, setPaymentData] = useState({
    billerId: 'SP Utilities',
    sourceAccount: 'Savings Account • ****4831',
    amount: '',
    date: ''
  });

  const handleSubmit = async (e) => {
    e.preventDefault();
    // TODO (Backend - Team):
    // 1. Enforce Idempotency-Key header on this POST request (SR-08).
    // 2. Verify sufficient balance server-side before execution.
    // 3. Ensure biller exists in the application.billers allowlist table.
    console.log("Mock Pay Bill Payload:", paymentData);
    alert("Bill payment initiated successfully.");
  };

  return (
    <section className="section">
      <div className="section-header">
        <div>
          <h2 className="section-title">Bill Payment</h2>
          <div className="helper-text">Pay registered billers from your selected account.</div>
        </div>
      </div>

      <div className="dual-grid">
        <div className="content-card">
          <h3 className="card-title">Payment Flow</h3>
          <form onSubmit={handleSubmit} className="form-grid">
            <div className="field">
              <label>Registered Biller</label>
              <select value={paymentData.billerId} onChange={(e) => setPaymentData({...paymentData, billerId: e.target.value})}>
                <option value="SP Utilities">SP Utilities</option>
                <option value="StarHub Broadband">StarHub Broadband</option>
                <option value="SecureCard Platinum">SecureCard Platinum</option>
              </select>
            </div>
            <div className="field">
              <label>Pay From</label>
              <select value={paymentData.sourceAccount} onChange={(e) => setPaymentData({...paymentData, sourceAccount: e.target.value})}>
                <option>Savings Account • ****4831</option>
                <option>Current Account • ****9264</option>
              </select>
            </div>
            <div className="field">
              <label>Amount (SGD)</label>
              <input type="number" step="0.01" min="0.01" required value={paymentData.amount} onChange={(e) => setPaymentData({...paymentData, amount: e.target.value})} />
            </div>
            <div className="field">
              <label>Execution Date</label>
              <input type="date" required value={paymentData.date} onChange={(e) => setPaymentData({...paymentData, date: e.target.value})} />
            </div>
            
            <div className="hero-actions" style={{ marginTop: '16px' }}>
              <button type="submit" className="primary-button">Confirm Payment</button>
            </div>
          </form>
        </div>
      </div>
    </section>
  );
}