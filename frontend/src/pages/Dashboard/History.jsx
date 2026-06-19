import React, { useState } from 'react';

// Expanded mock data with deeper transaction details
const mockHistory = [
  { id: 'TXN-0921', title: "Home utility bill", counterpart: "SP Services", amount: "-124.90", type: "Bill Payment", date: "24 May 2026, 09:40", status: "Completed", ref: "REF-882910" },
  { id: 'TXN-0920', title: "Salary credit", counterpart: "Ficta Labs Pte Ltd", amount: "5400.00", type: "Transfer", date: "23 May 2026, 08:05", status: "Completed", ref: "REF-882901" },
  { id: 'TXN-0919', title: "Transfer to joint savings", counterpart: "Own Account", amount: "-650.00", type: "Transfer", date: "22 May 2026, 21:17", status: "Protected", ref: "REF-882855" },
  { id: 'TXN-0918', title: "Coffee & Co", counterpart: "Visa Debit", amount: "-6.50", type: "Card Spend", date: "21 May 2026, 14:30", status: "Completed", ref: "VISA-1029" },
  { id: 'TXN-0917', title: "Refund", counterpart: "TechStore SG", amount: "129.00", type: "Refund", date: "19 May 2026, 10:15", status: "Processing", ref: "REF-882110" },
];

export default function History() {
  const [filters, setFilters] = useState({ dateRange: '', type: '', minAmount: '' });

  // Frontend logic to make the mock filters actually work for UI testing
  const filteredTransactions = mockHistory.filter(txn => {
    const matchType = filters.type ? txn.type === filters.type : true;
    const matchAmount = filters.minAmount ? Math.abs(parseFloat(txn.amount)) >= parseFloat(filters.minAmount) : true;
    return matchType && matchAmount;
  });

  const handleFilterSubmit = (e) => {
    e.preventDefault();
    // TODO (Backend): 
    // 1. Hook this up to fetch paginated records from PostgreSQL via Flask.
    // 2. Ensure parameterized queries are used to prevent SQL Injection.
    console.log("Fetching history with filters:", filters);
  };

  return (
    <section className="section">
      <div className="section-header">
        <div>
          <h2 className="section-title">Transaction History</h2>
          <div className="helper-text">Review, filter, and audit your complete transaction records.</div>
        </div>
        <button className="secondary-button">Export as CSV</button>
      </div>

      {/* Filter Control Panel */}
      <div className="content-card" style={{ marginBottom: '24px', backgroundColor: '#f9fafb' }}>
        <form onSubmit={handleFilterSubmit} className="form-grid" style={{ gridTemplateColumns: '1fr 1fr 1fr auto', alignItems: 'end' }}>
          <div className="field">
            <label>Date Range (Start)</label>
            <input 
              type="date" 
              onChange={(e) => setFilters({...filters, dateRange: e.target.value})} 
            />
          </div>
          <div className="field">
            <label>Transaction Type</label>
            <select onChange={(e) => setFilters({...filters, type: e.target.value})}>
              <option value="">All Transactions</option>
              <option value="Transfer">Transfers</option>
              <option value="Bill Payment">Bill Payments</option>
              <option value="Card Spend">Card Spend</option>
              <option value="Refund">Refunds</option>
            </select>
          </div>
          <div className="field">
            <label>Min Amount (SGD)</label>
            <input 
              type="number" 
              placeholder="e.g. 100.00" 
              onChange={(e) => setFilters({...filters, minAmount: e.target.value})} 
            />
          </div>
          <button type="submit" className="primary-button" style={{ marginBottom: '8px', padding: '10px 24px' }}>
            Apply Filters
          </button>
        </form>
      </div>

      {/* Expanded Data Table */}
      <div className="content-card">
        <div className="table">
          <div className="table-head" style={{ gridTemplateColumns: '2fr 1.5fr 1.5fr 1fr 1fr' }}>
            <div>Description / Reference</div>
            <div>Date</div>
            <div>Counterpart</div>
            <div style={{ textAlign: 'right' }}>Amount</div>
            <div style={{ textAlign: 'right' }}>Status</div>
          </div>
          
          {filteredTransactions.length > 0 ? (
            filteredTransactions.map((txn) => {
              const isPositive = parseFloat(txn.amount) > 0;
              return (
                <div className="table-row" key={txn.id} style={{ gridTemplateColumns: '2fr 1.5fr 1.5fr 1fr 1fr', alignItems: 'center' }}>
                  
                  {/* Title and Reference */}
                  <div>
                    <strong style={{ display: 'block', color: '#111827' }}>{txn.title}</strong>
                    <span className="helper-text" style={{ fontSize: '0.8rem' }}>{txn.type} · Ref: {txn.ref}</span>
                  </div>
                  
                  {/* Date */}
                  <div style={{ color: '#4b5563', fontSize: '0.9rem' }}>{txn.date}</div>
                  
                  {/* Counterpart */}
                  <div style={{ color: '#4b5563', fontSize: '0.9rem' }}>{txn.counterpart}</div>
                  
                  {/* Amount with conditional color formatting */}
                  <div style={{ 
                    textAlign: 'right', 
                    fontWeight: '600', 
                    color: isPositive ? '#059669' : '#111827' 
                  }}>
                    {isPositive ? '+' : ''}SGD {Math.abs(parseFloat(txn.amount)).toFixed(2)}
                  </div>
                  
                  {/* Status Tag */}
                  <div style={{ textAlign: 'right' }}>
                    <span className={`tag ${txn.status === 'Completed' ? 'chip-muted' : txn.status === 'Protected' ? 'warning' : ''}`} style={{ display: 'inline-block' }}>
                      {txn.status}
                    </span>
                  </div>

                </div>
              );
            })
          ) : (
            <div style={{ padding: '40px', textAlign: 'center', color: '#6b7280' }}>
              No transactions found matching your criteria.
            </div>
          )}
        </div>
      </div>
    </section>
  );
}