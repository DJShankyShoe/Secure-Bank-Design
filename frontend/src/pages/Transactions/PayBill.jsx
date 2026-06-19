import React, { useState } from 'react';

export default function PayBill() {
  const [paymentData, setPaymentData] = useState({
    billerId: 'SP Utilities',
    sourceAccount: 'Savings Account • ****4831',
    amount: '',
    date: ''
  });

  // Strict Currency Validator
  const handleAmountChange = (e) => {
    const value = e.target.value;
    if (value === '' || /^\d*\.?\d{0,2}$/.test(value)) {
      setPaymentData({ ...paymentData, amount: value });
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    // TODO (Backend):
    // 1. Enforce Idempotency-Key header on this POST request.
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
        
        {/* Left Side: Payment Form */}
        <div className="content-card">
          <h3 className="card-title">Payment Flow</h3>
          <form onSubmit={handleSubmit} className="form-grid">
            <div className="field">
              <label>Registered Biller</label>
              <select 
                value={paymentData.billerId} 
                onChange={(e) => setPaymentData({...paymentData, billerId: e.target.value})}
              >
                <option value="SP Utilities">SP Utilities</option>
                <option value="StarHub Broadband">StarHub Broadband</option>
                <option value="SecureCard Platinum">SecureCard Platinum</option>
              </select>
            </div>
            <div className="field">
              <label>Pay From</label>
              <select 
                value={paymentData.sourceAccount} 
                onChange={(e) => setPaymentData({...paymentData, sourceAccount: e.target.value})}
              >
                <option>Savings Account • ****4831</option>
                <option>Current Account • ****9264</option>
              </select>
            </div>
            <div className="field">
              <label>Amount (SGD)</label>
              <input 
                type="text" 
                inputMode="decimal"
                placeholder="0.00" 
                required 
                value={paymentData.amount} 
                onChange={handleAmountChange} 
              />
            </div>
            <div className="field">
              <label>Payment Date</label>
              <input 
                type="date" 
                required 
                value={paymentData.date} 
                onChange={(e) => setPaymentData({...paymentData, date: e.target.value})} 
              />
            </div>
            
            <div className="field full">
              <div className="inline-note">
                Please review the payment amount and payment date before submission.
              </div>
            </div>

            <div className="hero-actions" style={{ marginTop: '16px' }}>
              <button type="submit" className="primary-button">Confirm Payment</button>
              <button type="button" className="secondary-button">Payment history</button>
            </div>
          </form>
        </div>

        {/* Right Side: Payment Summary */}
        <div className="content-card">
          <h3 className="card-title">Payment Summary</h3>
          <ul className="stack-list">
            <li className="row-between">
              <span className="table-muted">Biller</span>
              <strong>{paymentData.billerId}</strong>
            </li>
            <li className="row-between">
              <span className="table-muted">Account</span>
              <strong style={{ fontSize: '0.9rem' }}>{paymentData.sourceAccount}</strong>
            </li>
            <li className="row-between">
              <span className="table-muted">Payment Amount</span>
              <strong>SGD {paymentData.amount ? parseFloat(paymentData.amount).toFixed(2) : '0.00'}</strong>
            </li>
            <li className="row-between">
              <span className="table-muted">Payment Date</span>
              <strong>{paymentData.date || 'Not selected'}</strong>
            </li>
          </ul>
        </div>

      </div>
    </section>
  );
}