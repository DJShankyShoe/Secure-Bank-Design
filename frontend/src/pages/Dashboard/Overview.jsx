import React, { useEffect, useState } from 'react';
import { toast } from '../../ui/notify.jsx';
import { useNavigate } from 'react-router-dom';
import { api } from '../../api/api';

export default function Dashboard() {
  const navigate = useNavigate();

  const [accounts, setAccounts] = useState([]);
  const [transactions, setTransactions] = useState([]);
  const [loading, setLoading] = useState(true);

  // Profile is cached at login (from /auth/me); greet the user by first name.
  const storedUser = JSON.parse(sessionStorage.getItem("securebank_user") || "{}");
  const firstName = (storedUser.full_name || "").trim().split(" ")[0];

  useEffect(() => {
    const loadDashboard = async () => {
      try {
        const accountsRes = await api.getAccounts();
        const loadedAccounts = accountsRes.accounts || [];
        setAccounts(loadedAccounts);

        // GET /accounts intentionally returns every account regardless of status
        // (so closed-account history stays visible in Manage Account) — the first
        // one isn't necessarily usable, so pull recent activity from the first
        // ACTIVE account instead of just loadedAccounts[0].
        const firstActive = loadedAccounts.find(
          (a) => String(a.status || "").toLowerCase() === "active"
        );
        if (firstActive) {
          const txnRes = await api.getTransactions(firstActive.account_id);
          setTransactions((txnRes.items || []).slice(0, 5));
        }

      } catch (err) {
        toast.error(err.message);
      } finally {
        setLoading(false);
      }
    };

    loadDashboard();
  }, []);

  // Only 'active' accounts are usable/available — a closed (or open_requested /
  // suspended / close_requested) account shouldn't inflate the count or balance
  // shown here. Allowlist rather than denylist so a new status can never
  // silently slip through (matches Transfer.jsx / PayBill.jsx / History.jsx).
  const activeAccounts = accounts.filter(
    (account) => String(account.status || "").toLowerCase() === "active"
  );

  const availableBalanceCents = activeAccounts.reduce(
    (sum, account) => sum + (account.balance_cents || 0),
    0
  );

  // Per-account balances shown on the dashboard: active accounts plus suspended
  // ones (the money is still theirs, just frozen) -- but NOT open_requested /
  // close_requested / closed, which either aren't usable yet or are done.
  const visibleAccounts = accounts.filter((account) => {
    const status = String(account.status || "").toLowerCase();
    return status === "active" || status === "suspended";
  });

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
          <p className="eyebrow">{firstName ? `Welcome back, ${firstName}` : "Welcome back"}</p>
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
          <div className="metric-value">{loading ? "Loading..." : activeAccounts.length}</div>
        </div>
      </section>

      <section className="section">
        <div className="content-card">
          <h3 className="card-title">Your accounts</h3>
          {loading ? (
            <div className="table-muted">Loading accounts...</div>
          ) : visibleAccounts.length > 0 ? (
            <ul className="stack-list">
              {visibleAccounts.map((account) => (
                <li key={account.account_id} className="account-row">
                  <div>
                    <strong style={{ textTransform: 'capitalize' }}>{account.account_type}</strong>
                    <div className="table-muted" style={{ fontSize: '0.85rem' }}>{account.account_number}</div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                    {account.status === 'suspended' && (
                      <span className="tag warning">Suspended</span>
                    )}
                    <span className="amount" style={{ fontSize: '1.1rem' }}>
                      SGD {((account.balance_cents || 0) / 100).toFixed(2)}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <div className="table-muted">No accounts to show.</div>
          )}
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