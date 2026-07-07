import React, { useEffect, useState } from "react";
import { toast } from '../../ui/notify.jsx';
import { api } from "../../api/api";

export default function History() {

  const [filters, setFilters] = useState({
    dateFrom: "",
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

        // Default to the first account that can have history — not a pending
        // 'open_requested' one, which would otherwise be selected but hidden
        // from the dropdown.
        const eligible = (response.accounts || []).filter((a) =>
          ["active", "suspended", "close_requested"].includes(
            String(a.status || "").toLowerCase()
          )
        );
        if (eligible.length > 0) {
          setSelectedAccount(eligible[0].account_id);
        }

      } catch (err) {
        toast.error(err.message);
      }
    };

    loadAccounts();
  }, []);

//load transaction
  const loadTransactions = async (accountId, currentFilters) => {
    try {
      const amountMin = currentFilters.minAmount
        ? Math.round(parseFloat(currentFilters.minAmount) * 100)
        : null;
      if (currentFilters.minAmount && (!Number.isFinite(amountMin) || amountMin < 0)) {
        toast.error("Min amount must be a positive number.");
        return;
      }
      const response = await api.getTransactions(accountId, {
        type: currentFilters.type || undefined,
        dateFrom: currentFilters.dateFrom || undefined,
        amountMin,
      });
      setTransactions(response.items || []);
    } catch (err) {
      toast.error(err.message);
    }
  };

  useEffect(() => {
    if (!selectedAccount) return;
    loadTransactions(selectedAccount, filters);
    // Only re-run when the account changes — filter changes apply via "Apply Filters".
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedAccount]);

  const handleFilterSubmit = (e) => {
    e.preventDefault();
    if (!selectedAccount) return;
    loadTransactions(selectedAccount, filters);
  };

  // Show accounts that can actually have a transaction history. A pre-approval
  // 'open_requested' account has none (and isn't usable yet), so it's excluded;
  // the frozen states (suspended / close_requested) still have viewable history.
  const activeAccounts = accounts.filter((account) =>
    ["active", "suspended", "close_requested"].includes(
      String(account.status || "").toLowerCase()
    )
  );


  return (
    <section className="section">
      <div className="section-header">
        <div>
          <h2 className="section-title">Transaction History</h2>
          <div className="helper-text">Review, filter, and audit your complete transaction records.</div>
        </div>
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
              value={filters.dateFrom}
              onChange={(e) => setFilters({...filters, dateFrom: e.target.value})}
            />
          </div>

          <div className="field">
            <label>Transaction Type</label>
            <select value={filters.type} onChange={(e) => setFilters({...filters, type: e.target.value})}>
              <option value="">All Transactions</option>
              <option value="transfer">Transfers</option>
              <option value="bill_payment">Bill Payments</option>
            </select>
          </div>
          <div className="field">
            <label>Min Amount (SGD)</label>
            <input
              type="number"
              min="0"
              step="0.01"
              placeholder="e.g. 100.00"
              value={filters.minAmount}
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
          
          {transactions.length > 0 ? (
            transactions.map((txn) => {
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