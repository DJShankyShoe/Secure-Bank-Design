import React, { useMemo } from 'react';

export default function Transfer() {
  const projectedFee = useMemo(() => "SGD 0.00", []);

  return (
    <section className="section">
      <div className="section-header">
        <div>
          <h2 className="section-title">Transfer funds</h2>
          <div className="helper-text">Transfer funds between your accounts or to third-party beneficiaries.</div>
        </div>
      </div>

      <div className="dual-grid">
        <div className="content-card">
          <h3 className="card-title">Transfer form</h3>
          <div className="form-grid">
            <div className="field">
              <label>From account</label>
              <select defaultValue="Savings Account • ****4831">
                <option>Savings Account • ****4831</option>
                <option>Current Account • ****9264</option>
              </select>
            </div>
            <div className="field">
              <label>Beneficiary account number</label>
              <input type="text" defaultValue="1029384756" />
            </div>
            <div className="field">
              <label>Amount</label>
              <input type="number" defaultValue="1250" />
            </div>
          </div>
          <div className="hero-actions" style={{ marginTop: '20px' }}>
            <button className="primary-button">Continue</button>
          </div>
        </div>

        <div className="content-card">
          <h3 className="card-title">Transfer summary</h3>
          <ul className="stack-list">
            <li className="row-between">
              <span className="table-muted">Transfer amount</span>
              <strong>SGD 1,250.00</strong>
            </li>
            <li className="row-between">
              <span className="table-muted">Security threshold</span>
              <span className="tag warning">Additional confirmation required</span>
            </li>
          </ul>

          <div className="mini-card" style={{ marginTop: "20px" }}>
            <h4 className="card-title">Confirmation</h4>
            <div className="field">
              <label>Enter 6-digit transaction PIN</label>
              <input type="password" placeholder="••••••" maxLength="6" />
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}