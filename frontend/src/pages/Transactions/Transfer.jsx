import React, { useMemo, useState } from 'react';

export default function Transfer() {
  const projectedFee = useMemo(() => "SGD 0.00", []);
  
  // Consolidate all form fields into one state object
  const [formData, setFormData] = useState({
    sourceAccount: 'Savings Account • ****4831',
    destinationType: 'Third-party',
    beneficiaryName: '',
    destinationAccount: '',
    amount: '',
    reference: ''
  });
  
  const [transactionPin, setTransactionPin] = useState('');

  // Strict Currency Validator
  const handleAmountChange = (e) => {
    const value = e.target.value;
    if (value === '' || /^\d*\.?\d{0,2}$/.test(value)) {
      setFormData({ ...formData, amount: value });
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    // TODO (Backend):
    // 1. Enforce Idempotency-Key header on this POST request.
    // 2. Verify sufficient balance server-side before execution.
    // 3. Ensure transfer PIN logic applies if >= 1000.
    console.log("Mock Transfer Payload:", formData, "PIN:", transactionPin);
    alert("Transfer initiated successfully.");
  };

  // Determine if PIN is required dynamically (>= 1000 SGD)
  const requiresPin = parseFloat(formData.amount || 0) >= 1000;

  return (
    <section className="section">
      <div className="section-header">
        <div>
          <h2 className="section-title">Transfer funds</h2>
          <div className="helper-text">Transfer funds between your accounts or to third-party beneficiaries.</div>
        </div>
      </div>

      <form onSubmit={handleSubmit}>
        <div className="dual-grid">
          
          {/* Left Side: Transfer Form */}
          <div className="content-card">
            <h3 className="card-title">Transfer form</h3>
            <div className="form-grid">
              <div className="field">
                <label>From account</label>
                <select 
                  value={formData.sourceAccount}
                  onChange={(e) => setFormData({...formData, sourceAccount: e.target.value})}
                >
                  <option>Savings Account • ****4831</option>
                  <option>Current Account • ****9264</option>
                </select>
              </div>
              <div className="field">
                <label>Transfer type</label>
                <select 
                  value={formData.destinationType}
                  onChange={(e) => setFormData({...formData, destinationType: e.target.value})}
                >
                  <option>Own account</option>
                  <option>Third-party</option>
                </select>
              </div>
              <div className="field">
                <label>Beneficiary name</label>
                <input 
                  type="text" 
                  placeholder="e.g. A. Tan"
                  value={formData.beneficiaryName}
                  onChange={(e) => setFormData({...formData, beneficiaryName: e.target.value})}
                  required 
                />
              </div>
              <div className="field">
                <label>Beneficiary account number</label>
                <input 
                  type="text" 
                  placeholder="e.g. 1029384756"
                  value={formData.destinationAccount}
                  onChange={(e) => setFormData({...formData, destinationAccount: e.target.value})}
                  required 
                />
              </div>
              <div className="field">
                <label>Amount (SGD)</label>
                <input 
                  type="text" 
                  inputMode="decimal"
                  placeholder="0.00"
                  value={formData.amount}
                  onChange={handleAmountChange}
                  required 
                />
              </div>
              <div className="field">
                <label>Reference</label>
                <input 
                  type="text" 
                  placeholder="e.g. May allowance"
                  value={formData.reference}
                  onChange={(e) => setFormData({...formData, reference: e.target.value})}
                />
              </div>
              <div className="field full">
                <div className="inline-note">
                  Transfers above SGD 1,000 require additional confirmation before submission.
                </div>
              </div>
            </div>
            
            <div className="hero-actions" style={{ marginTop: '20px' }}>
              <button type="submit" className="primary-button">Continue</button>
              <button type="button" className="secondary-button">Save beneficiary</button>
            </div>
          </div>

          {/* Right Side: Dynamic Summary */}
          <div className="content-card">
            <h3 className="card-title">Transfer summary</h3>
            <ul className="stack-list">
              <li className="row-between">
                <span className="table-muted">Transfer amount</span>
                <strong>SGD {formData.amount ? parseFloat(formData.amount).toFixed(2) : '0.00'}</strong>
              </li>
              <li className="row-between">
                <span className="table-muted">Security threshold</span>
                {requiresPin ? (
                  <span className="tag warning">Additional confirmation required</span>
                ) : (
                  <span className="tag chip-muted">Standard transfer</span>
                )}
              </li>
              <li className="row-between">
                <span className="table-muted">Projected fee</span>
                <strong>{projectedFee}</strong>
              </li>
              <li className="row-between">
                <span className="table-muted">Receipt channel</span>
                <strong>Email and transaction history</strong>
              </li>
            </ul>

            {/* Conditionally render the PIN input based on amount */}
            {requiresPin && (
              <div className="mini-card" style={{ marginTop: "20px", border: '1px solid #ffc107', backgroundColor: '#fffdf5' }}>
                <h4 className="card-title" style={{ color: '#856404' }}>Confirmation Required</h4>
                <div className="field">
                  <label>Enter 6-digit transaction PIN</label>
                  <input 
                    type="password" 
                    placeholder="••••••" 
                    maxLength="6"
                    required={requiresPin}
                    value={transactionPin}
                    onChange={(e) => setTransactionPin(e.target.value.replace(/\D/g, ''))} // Restrict to numbers
                  />
                </div>
              </div>
            )}
          </div>
          
        </div>
      </form>
    </section>
  );
}