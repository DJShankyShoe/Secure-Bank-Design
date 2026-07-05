import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../../api/api';

export default function Dashboard() {
  const navigate = useNavigate();

  const [accounts, setAccounts] = useState([]);
  const [transactions, setTransactions] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const loadDashboard = async () => {
      try {
        const accountsRes = await api.getAccounts();
        const loadedAccounts = accountsRes.accounts || [];
        setAccounts(loadedAccounts);

        if (loadedAccounts.length > 0) {
          const txnRes = await api.getTransactions(loadedAccounts[0].account_id);
          setTransactions((txnRes.items || []).slice(0, 5));
        }

      } catch (err) {
        alert(err.message);
      } finally {
        setLoading(false);
      }
    };

    loadDashboard();
  }, []);

  const availableBalanceCents = accounts.reduce(
    (sum, account) => sum + (account.balance_cents || 0),
    0
  );

  const formatAmount = (amountCents, direction) => {
    const amount = Math.abs(amountCents) / 100;
    const sign = direction === "credit" ? "+" : "-";
    return `${sign} SGD ${amount.toFixed(2)}`;
  };

  const formatDate = (timestamp) =>
    new Date(timestamp).toLocaleString("en-SG", {
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });

  return (
    <>
      <section className="hero">
        <div className="hero-copy">
          <p className="eyebrow">Welcome back</p>
          <h1>Your accounts, payments, and transfers in one place.</h1>
          <div className="hero-actions">
            <button className="primary-button" onClick={() => navigate('/transfer')}>Make a transfer</button>
            <button className="primary-button" onClick={() => navigate('/bills')}>Pay bills</button>
          </div>
        </div>
      </section>

      <section className="metrics-grid">
        <div className="metric-card">
          <div className="table-muted">Available balance</div>
          <div className="metric-value">
            {loading ? "Loading..." : `SGD ${(availableBalanceCents / 100).toFixed(2)}`}
          </div>
        </div>
        <div className="metric-card">
          <div className="table-muted">Accounts</div>
          <div className="metric-value">{loading ? "Loading..." : accounts.length}</div>
        </div>
      </section>

      <section className="section">
        <div className="content-card split-card">
          <div>
            <h3 className="card-title">Recent transactions</h3>
            {loading ? (
              <div className="table-muted">Loading transactions...</div>
            ) : transactions.length > 0 ? (
              <ul className="timeline">
                {transactions.map((entry) => (
                  <li key={entry.transaction_id}>
                    <span className="timeline-marker"></span>
                    <div style={{ flex: 1 }}>
                      <div className="timeline-title-row">
                        <strong>{entry.transaction_type}</strong>
                        <span className="amount">{formatAmount(entry.amount_cents, entry.direction)}</span>
                      </div>
                      <div className="timeline-meta">{entry.counterparty} · {formatDate(entry.timestamp)}</div>
                      <div className="timeline-description">Status: {entry.status}</div>
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="table-muted">No recent transactions.</div>
            )}
          </div>
        </div>
      </section>
    </>
  );
}