import React, { useState } from 'react';

export default function History() {
  const [filters, setFilters] = useState({ dateRange: '', type: '', amount: '' });

  const handleFilter = (e) => {
    e.preventDefault();
    // TODO (Backend):
    // 1. Fetch paginated records from Flask (25 records/page) within 3s SLA (NFR-01).
    // 2. SQLAlchemy must use parameterized queries here to prevent SQLi (SR-04).
    console.log("Mock Filtering history by:", filters);
  };

  return (
    <section className="section">
      <div className="section-header">
        <div>
          <h2 className="section-title">Transaction History</h2>
          <div className="helper-text">Review and filter your past transactions.</div>
        </div>
      </div>

      <div className="content-card" style={{ marginBottom: '24px' }}>
        <form onSubmit={handleFilter} className="form-grid" style={{ gridTemplateColumns: '1fr 1fr 1fr auto', alignItems: 'end' }}>
          <div className="field">
            <label>Date Range</label>
            <input type="date" onChange={(e) => setFilters({...filters, dateRange: e.target.value})} />
          </div>
          <div className="field">
            <label>Transaction Type</label>
            <select onChange={(e) => setFilters({...filters, type: e.target.value})}>
              <option value="">All</option>
              <option value="transfer">Transfer</option>
              <option value="bill_payment">Bill Payment</option>
            </select>
          </div>
          <div className="field">
            <label>Amount (SGD)</label>
            <input type="number" placeholder="Min Amount" onChange={(e) => setFilters({...filters, amount: e.target.value})} />
          </div>
          <button type="submit" className="secondary-button" style={{ marginBottom: '8px' }}>Filter</button>
        </form>
      </div>

      <div className="content-card">
        <div className="table">
          <div className="table-head">
            <div>Description / Reference</div>
            <div>Date</div>
            <div>Counterpart</div>
            <div>Amount</div>
            <div>Status</div>
          </div>
          
          {/* Mapped records would go here */}
          <div className="table-row">
            <div className="table-strong">Salary credit<br/><span className="helper-text">REF: 882910</span></div>
            <div>23 May 2026</div>
            <div>Ficta Labs Pte Ltd</div>
            <div style={{ color: 'green' }}>+ SGD 5,400.00</div>
            <div><span className="chip-muted">Completed</span></div>
          </div>
          
        </div>
      </div>
    </section>
  );
}