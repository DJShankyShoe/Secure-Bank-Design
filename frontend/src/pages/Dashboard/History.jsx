import React, { useEffect, useState } from "react";
import { api } from "../../api/api";

export default function History() {

  const [filters, setFilters] = useState({
    dateRange: "",
    type: "",
    minAmount: ""
  });

  const [accounts, setAccounts] = useState([]);
  const [selectedAccount, setSelectedAccount] = useState("");
  const [transactions, setTransactions] = useState([]);

  //load account
  useEffect(() => {
    const loadAccounts = async () => {
      try {
        const response = await api.getAccounts();

        setAccounts(response.accounts);

        if (response.accounts.length > 0) {
          setSelectedAccount(response.accounts[0].account_id);
        }

      } catch (err) {
        alert(err.message);
      }
    };

    loadAccounts();
  }, []);

//load transaction
  useEffect(() => {
    if (!selectedAccount) return;

    const loadTransactions = async () => {
      try {
        const response = await api.getTransactions(selectedAccount);

        setTransactions(response.items);

      } catch (err) {
        alert(err.message);
      }
    };

    loadTransactions();

  }, [selectedAccount]);

  const filteredTransactions = transactions;

  const handleFilterSubmit = (e) => {
    e.preventDefault();

    // Backend filtering can be added later
  };

  const activeAccounts = accounts.filter((account) => {
  const status = String(account.status || "").toLowerCase();

    return (
      status !== "closed" &&
      status !== "inactive" &&
      !account.closed_at &&
      account.is_closed !== true
    );
  });


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
        <form onSubmit={handleFilterSubmit} className="form-grid" style={{ gridTemplateColumns: '1fr 1fr 1fr 1fr auto', alignItems: 'end' }}>
          <div className="field">
            <label>Account</label>

            <select
              value={selectedAccount}
              onChange={(e) => setSelectedAccount(e.target.value)}
            >
              {activeAccounts.map((account) => (
                <option
                  key={account.account_id}
                  value={account.account_id}
                >
                  {account.account_number}
                </option>
              ))}
            </select>
          </div>

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
              const amount = txn.amount_cents / 100;
              const isPositive = txn.direction === "credit";
              return (
                <div className="table-row" key={txn.transaction_id} style={{ gridTemplateColumns: '2fr 1.5fr 1.5fr 1fr 1fr', alignItems: 'center' }}>
                  
                  {/* Title and Reference */}
                  <div>
                    <strong style={{ display: 'block', color: '#111827' }}>{txn.transaction_type}</strong>
                    <span className="helper-text" style={{ fontSize: '0.8rem' }}>{txn.transaction_type} · Ref: {txn.reference_number}</span>
                  </div>
                  
                  {/* Date */}
                  <div style={{ color: '#4b5563', fontSize: '0.9rem' }}>{new Date(txn.timestamp).toLocaleString()}</div>
                  
                  {/* Counterpart */}
                  <div style={{ color: '#4b5563', fontSize: '0.9rem' }}>{txn.counterparty}</div>
                  
                  {/* Amount with conditional color formatting */}
                  <div style={{ 
                    textAlign: 'right', 
                    fontWeight: '600', 
                    color: isPositive ? '#059669' : '#111827' 
                  }}>
                    {isPositive ? '+' : ''}SGD {amount.toFixed(2)}
                  </div>
                  
                  {/* Status Tag */}
                  <div style={{ textAlign: 'right' }}>
                    <span className={`tag ${txn.status === 'Complete' ? 'chip-muted' : txn.status === 'Pending' ? 'warning' : ''}`} style={{ display: 'inline-block' }}>
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