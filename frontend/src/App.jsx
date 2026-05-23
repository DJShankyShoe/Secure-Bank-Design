import React, { useMemo, useState } from "react";

const navItems = [
  { id: "dashboard", label: "Dashboard", badge: "4" },
  { id: "accounts", label: "Accounts", badge: "2" },
  { id: "transfer", label: "Transfers", badge: "PIN" },
  { id: "bills", label: "Bill Payment", badge: "3" },
  { id: "settings", label: "Security Settings", badge: "MFA" },
  { id: "admin", label: "Admin View", badge: "RBAC" },
];

const accounts = [
  {
    type: "Savings Account",
    number: "**** 4831",
    balance: "SGD 18,420.55",
    progress: 72,
    status: "Primary",
  },
  {
    type: "Current Account",
    number: "**** 9264",
    balance: "SGD 4,880.20",
    progress: 38,
    status: "Daily Spending",
  },
];

const transfers = [
  {
    title: "Home utility bill",
    counterpart: "SP Services",
    amount: "- SGD 124.90",
    date: "24 May 2026, 09:40",
    status: "Completed",
  },
  {
    title: "Salary credit",
    counterpart: "Ficta Labs Pte Ltd",
    amount: "+ SGD 5,400.00",
    date: "23 May 2026, 08:05",
    status: "Completed",
  },
  {
    title: "Transfer to joint savings",
    counterpart: "Own Account",
    amount: "- SGD 650.00",
    date: "22 May 2026, 21:17",
    status: "Protected",
  },
];

const auditLogs = [
  {
    action: "High-value transfer pending PIN",
    actor: "customer: shashank",
    ip: "203.116.12.77",
    time: "2026-05-24 09:42 UTC",
    outcome: "Awaiting verification",
  },
  {
    action: "Failed MFA challenge",
    actor: "customer: shashank",
    ip: "203.116.12.77",
    time: "2026-05-24 09:12 UTC",
    outcome: "Blocked after 3 attempts",
  },
  {
    action: "Admin unlocked customer account",
    actor: "admin: ops.lead",
    ip: "18.143.55.212",
    time: "2026-05-24 07:58 UTC",
    outcome: "Logged with reason code",
  },
];

const billers = [
  { name: "SP Utilities", category: "Utilities", due: "26 May", status: "Due Soon" },
  { name: "StarHub Broadband", category: "Telecom", due: "29 May", status: "Scheduled" },
  { name: "SecureCard Platinum", category: "Credit Card", due: "01 Jun", status: "Requires review" },
];

export default function App() {
  const [activeView, setActiveView] = useState("dashboard");
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [showMfa, setShowMfa] = useState(false);

  if (!isAuthenticated) {
    return (
      <LoginScreen
        showMfa={showMfa}
        onPrimaryAction={() => {
          if (showMfa) {
            setIsAuthenticated(true);
            setActiveView("dashboard");
            return;
          }

          setShowMfa(true);
        }}
        onBack={() => setShowMfa(false)}
      />
    );
  }

  return (
    <div className="app-shell">
      <TopBar
        onLogout={() => {
          setIsAuthenticated(false);
          setShowMfa(false);
        }}
      />
      <div className="layout">
        <Sidebar activeView={activeView} setActiveView={setActiveView} />
        <main className="main-panel">
          <Hero setActiveView={setActiveView} />
          <ViewRouter activeView={activeView} />
        </main>
      </div>
    </div>
  );
}

function TopBar({ onLogout }) {
  return (
    <header className="topbar">
      <div className="brand">
        <div className="brand-mark">SB</div>
        <div className="brand-text">
          <strong>SecureBank</strong>
          <span>Personal Internet Banking</span>
        </div>
      </div>
      <div className="topbar-actions">
        <div className="status-pill">
          <span className="status-dot"></span>
          Protected session active
        </div>
        <span className="topbar-note">MFA verified</span>
        <button className="ghost-button" onClick={onLogout}>
          Log out
        </button>
      </div>
    </header>
  );
}

function Sidebar({ activeView, setActiveView }) {
  return (
    <aside className="sidebar">
      <div className="profile-card">
        <div className="avatar">GS</div>
        <strong>Gangaraju Shashank</strong>
        <p>Retail customer · Session expires in 11:42</p>
      </div>

      <div className="nav-group">
        <div className="nav-label">Workspace</div>
        {navItems.map((item) => (
          <button
            key={item.id}
            className={`nav-button ${activeView === item.id ? "active" : ""}`}
            onClick={() => setActiveView(item.id)}
          >
            <span>{item.label}</span>
            <span className="nav-badge">{item.badge}</span>
          </button>
        ))}
      </div>
    </aside>
  );
}

function Hero({ setActiveView }) {
  return (
    <section className="hero">
      <div className="hero-copy">
        <p className="eyebrow">Welcome back</p>
        <h1>Your accounts, payments, and transfers in one place.</h1>
        <p>
          Review balances, move funds securely, pay bills, and manage your account settings from a
          single dashboard.
        </p>
        <div className="hero-actions">
          <button className="primary-button" onClick={() => setActiveView("transfer")}>
            Make a transfer
          </button>
          <button className="secondary-button" onClick={() => setActiveView("settings")}>
            Security settings
          </button>
        </div>
      </div>

      <div className="glass-card vault-card">
        <div className="vault-row">
          <div>
            <p className="eyebrow" style={{ color: "rgba(255,255,255,0.7)" }}>
              Account summary
            </p>
            <h3 className="card-title">Online banking protected by layered security controls</h3>
          </div>
          <span className="tag">Protected</span>
        </div>
        <ul className="secure-checklist" style={{ marginTop: "18px" }}>
          <li>
            <span className="list-icon">1</span>
            <div>
              <strong>Multi-factor sign-in</strong>
              <div className="helper-text" style={{ color: "rgba(255,255,255,0.72)" }}>
                Additional verification is required before access is granted.
              </div>
            </div>
          </li>
          <li>
            <span className="list-icon">2</span>
            <div>
              <strong>Protected high-value transfers</strong>
              <div className="helper-text" style={{ color: "rgba(255,255,255,0.72)" }}>
                Selected transactions require an extra confirmation step.
              </div>
            </div>
          </li>
          <li>
            <span className="list-icon">3</span>
            <div>
              <strong>Security alerts and activity tracking</strong>
              <div className="helper-text" style={{ color: "rgba(255,255,255,0.72)" }}>
                Sensitive account activity is logged and monitored.
              </div>
            </div>
          </li>
        </ul>
      </div>
    </section>
  );
}

function ViewRouter({ activeView }) {
  switch (activeView) {
    case "accounts":
      return <AccountsView />;
    case "transfer":
      return <TransferView />;
    case "bills":
      return <BillsView />;
    case "settings":
      return <SettingsView />;
    case "admin":
      return <AdminView />;
    case "dashboard":
    default:
      return <DashboardView />;
  }
}

function DashboardView() {
  return (
    <>
      <section className="metrics-grid">
        <MetricCard
          label="Available balance"
          value="SGD 23,300.75"
          trend="+4.2% from last month"
          trendClass="trend-up"
        />
        <MetricCard
          label="Protected transfers"
          value="7"
          trend="2 awaiting PIN review"
          trendClass="trend-warn"
        />
        <MetricCard
          label="Security health"
          value="96 / 100"
          trend="No critical alerts this week"
          trendClass="trend-up"
        />
      </section>

      <section className="section">
        <div className="section-header">
          <div>
            <h2 className="section-title">Fast actions</h2>
            <div className="helper-text">
              Common services for day-to-day banking.
            </div>
          </div>
        </div>
        <div className="card-grid">
          <ActionCard
            title="Open a new savings account"
            body="Open an eligible deposit account and start managing it online."
            badge="Accounts"
          />
          <ActionCard
            title="Move funds securely"
            body="Transfer between your own accounts or registered third-party beneficiaries."
            badge="Transfers"
          />
          <ActionCard
            title="Pay a registered biller"
            body="Settle utility, telecommunications, and card payments from your selected account."
            badge="Payments"
          />
        </div>
      </section>

      <section className="section">
        <div className="content-card split-card">
          <div>
            <h3 className="card-title">Recent transactions</h3>
            <ul className="timeline">
              {transfers.map((entry) => (
                <li key={`${entry.title}-${entry.date}`}>
                  <span className="timeline-marker"></span>
                  <div style={{ flex: 1 }}>
                    <div className="timeline-title-row">
                      <strong>{entry.title}</strong>
                      <span className="amount" style={{ fontSize: "1rem" }}>
                        {entry.amount}
                      </span>
                    </div>
                    <div className="timeline-meta">
                      {entry.counterpart} · {entry.date}
                    </div>
                    <div className="timeline-description">Status: {entry.status}</div>
                  </div>
                </li>
              ))}
            </ul>
          </div>

          <div className="mini-card">
            <h3 className="card-title">Account notices</h3>
            <ul className="info-list">
              <li>Last successful login: 24 May 2026, 17:31 SGT</li>
              <li>No failed login attempts in the last 7 days</li>
              <li>Transfer alerts are enabled for this profile</li>
              <li>Daily transfer limit: SGD 10,000</li>
            </ul>
          </div>
        </div>
      </section>
    </>
  );
}

function AccountsView() {
  return (
    <section className="section">
      <div className="section-header">
        <div>
          <h2 className="section-title">Accounts</h2>
          <div className="helper-text">
            View balances, account details, and recent account activity.
          </div>
        </div>
        <button className="primary-button">Open account</button>
      </div>

      <div className="dual-grid">
        <div className="content-card">
          <h3 className="card-title">Portfolio overview</h3>
          <div className="recent-list">
            {accounts.map((account) => (
              <div className="account-card" key={account.number}>
                <div className="account-row">
                  <div>
                    <strong>{account.type}</strong>
                    <div className="helper-text">{account.number}</div>
                  </div>
                  <span className="chip">{account.status}</span>
                </div>
                <div className="amount" style={{ marginTop: "14px" }}>
                  {account.balance}
                </div>
                <div className="helper-text" style={{ margin: "8px 0 10px" }}>
                  Available balance
                </div>
                <div className="progress">
                  <span style={{ width: `${account.progress}%` }}></span>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="content-card">
          <h3 className="card-title">Transaction history snapshot</h3>
          <div className="table">
            <div className="table-head">
              <div>Description</div>
              <div>Date</div>
              <div>Counterpart</div>
              <div>Amount</div>
              <div>Status</div>
            </div>
            {transfers.map((entry) => (
              <div className="table-row" key={`${entry.title}-${entry.date}`}>
                <div className="table-strong">{entry.title}</div>
                <div>{entry.date}</div>
                <div>{entry.counterpart}</div>
                <div>{entry.amount}</div>
                <div>
                  <span className="chip-muted">{entry.status}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

function TransferView() {
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
              <label htmlFor="source-account">From account</label>
              <select id="source-account" defaultValue="Savings Account • ****4831">
                <option>Savings Account • ****4831</option>
                <option>Current Account • ****9264</option>
              </select>
            </div>
            <div className="field">
              <label htmlFor="destination-type">Transfer type</label>
              <select id="destination-type" defaultValue="Third-party">
                <option>Own account</option>
                <option>Third-party</option>
              </select>
            </div>
            <div className="field">
              <label htmlFor="beneficiary-name">Beneficiary name</label>
              <input id="beneficiary-name" type="text" defaultValue="A. Tan" />
            </div>
            <div className="field">
              <label htmlFor="beneficiary-account">Beneficiary account number</label>
              <input id="beneficiary-account" type="text" defaultValue="1029384756" />
            </div>
            <div className="field">
              <label htmlFor="amount">Amount</label>
              <input id="amount" type="number" defaultValue="1250" />
            </div>
            <div className="field">
              <label htmlFor="reference">Reference</label>
              <input id="reference" type="text" defaultValue="May allowance" />
            </div>
            <div className="field full">
              <div className="inline-note">
                Transfers above SGD 1,000 require additional confirmation before submission.
              </div>
            </div>
          </div>
          <div className="hero-actions">
            <button className="primary-button">Continue</button>
            <button className="secondary-button">Save beneficiary</button>
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
            <li className="row-between">
              <span className="table-muted">Projected fee</span>
              <strong>{projectedFee}</strong>
            </li>
            <li className="row-between">
              <span className="table-muted">Receipt channel</span>
              <strong>Email and transaction history</strong>
            </li>
          </ul>

          <div className="mini-card" style={{ marginTop: "20px" }}>
            <h4 className="card-title">Confirmation</h4>
            <div className="field">
              <label htmlFor="transaction-pin">Enter 6-digit transaction PIN</label>
              <input id="transaction-pin" type="password" placeholder="••••••" />
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function BillsView() {
  return (
    <section className="section">
      <div className="section-header">
        <div>
          <h2 className="section-title">Bill payment</h2>
          <div className="helper-text">Pay registered billers from your selected account.</div>
        </div>
      </div>

      <div className="dual-grid">
        <div className="content-card">
          <h3 className="card-title">Registered billers</h3>
          <div className="recent-list">
            {billers.map((biller) => (
              <div className="biller-card" key={biller.name}>
                <div className="biller-row">
                  <div>
                    <strong>{biller.name}</strong>
                    <div className="helper-text">{biller.category}</div>
                  </div>
                  <span className={`tag ${biller.status === "Requires review" ? "warning" : ""}`}>
                    {biller.status}
                  </span>
                </div>
                <div className="row-between" style={{ marginTop: "12px" }}>
                  <span className="table-muted">Due date</span>
                  <strong>{biller.due}</strong>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="content-card">
          <h3 className="card-title">Payment flow</h3>
          <div className="form-grid">
            <div className="field">
              <label htmlFor="biller">Biller</label>
              <select id="biller" defaultValue="SP Utilities">
                <option>SP Utilities</option>
                <option>StarHub Broadband</option>
                <option>SecureCard Platinum</option>
              </select>
            </div>
            <div className="field">
              <label htmlFor="pay-from">Pay from</label>
              <select id="pay-from" defaultValue="Savings Account • ****4831">
                <option>Savings Account • ****4831</option>
                <option>Current Account • ****9264</option>
              </select>
            </div>
            <div className="field">
              <label htmlFor="bill-amount">Amount</label>
              <input id="bill-amount" type="number" defaultValue="124.90" />
            </div>
            <div className="field">
              <label htmlFor="pay-date">Execution date</label>
              <input id="pay-date" type="date" defaultValue="2026-05-24" />
            </div>
            <div className="field full">
              <div className="inline-note">
                Please review the payment amount and execution date before submission.
              </div>
            </div>
          </div>
          <div className="hero-actions">
            <button className="primary-button">Continue</button>
            <button className="secondary-button">Payment history</button>
          </div>
        </div>
      </div>
    </section>
  );
}

function SettingsView() {
  return (
    <section className="section">
      <div className="section-header">
        <div>
          <h2 className="section-title">Security settings</h2>
          <div className="helper-text">Manage verification methods, alerts, and profile settings.</div>
        </div>
      </div>

      <div className="settings-grid">
        <div className="content-card">
          <h3 className="card-title">Authentication controls</h3>
          <div className="toggle-row">
            <div>
              <strong>TOTP multi-factor authentication</strong>
              <div className="helper-text">Authenticator app enrolled on 21 May 2026.</div>
            </div>
            <span className="switch on"></span>
          </div>
          <div className="toggle-row">
            <div>
              <strong>Transaction PIN protection</strong>
              <div className="helper-text">Required above SGD 1,000.</div>
            </div>
            <span className="switch on"></span>
          </div>
          <div className="toggle-row">
            <div>
              <strong>Email alerts for sensitive actions</strong>
              <div className="helper-text">Transfers, email changes, and lockouts.</div>
            </div>
            <span className="switch on"></span>
          </div>
        </div>

        <div className="content-card">
          <h3 className="card-title">Profile and contact controls</h3>
          <div className="form-grid">
            <div className="field">
              <label htmlFor="full-name">Full name</label>
              <input id="full-name" type="text" defaultValue="Gangaraju Shashank" />
            </div>
            <div className="field">
              <label htmlFor="masked-nric">NRIC</label>
              <input id="masked-nric" type="text" defaultValue="T****639X" disabled />
            </div>
            <div className="field">
              <label htmlFor="email">Email address</label>
              <input id="email" type="email" defaultValue="shashank@example.com" />
            </div>
            <div className="field">
              <label htmlFor="phone">Phone number</label>
              <input id="phone" type="tel" defaultValue="+65 9123 4567" />
            </div>
          </div>
          <p className="footer-note">
            Changes to your contact details may require additional verification.
          </p>
        </div>
      </div>
    </section>
  );
}

function AdminView() {
  return (
    <section className="section">
      <div className="section-header">
        <div>
          <h2 className="section-title">Admin operations view</h2>
          <div className="helper-text">Operational access for authorised staff only.</div>
        </div>
      </div>

      <div className="admin-grid">
        <div className="content-card">
          <h3 className="card-title">Operational overview</h3>
          <div
            className="card-grid"
            style={{ gridTemplateColumns: "repeat(2, minmax(0, 1fr))", marginTop: "12px" }}
          >
            <div className="admin-stat">
              <div className="table-muted">Flagged accounts</div>
              <div className="metric-value">14</div>
            </div>
            <div className="admin-stat">
              <div className="table-muted">Lockouts today</div>
              <div className="metric-value">5</div>
            </div>
            <div className="admin-stat">
              <div className="table-muted">Pending unlock requests</div>
              <div className="metric-value">2</div>
            </div>
            <div className="admin-stat">
              <div className="table-muted">Open fraud reviews</div>
              <div className="metric-value">1</div>
            </div>
          </div>
        </div>

        <div className="content-card">
          <h3 className="card-title">Recent audit log entries</h3>
          {auditLogs.map((log) => (
            <div className="log-row" key={`${log.action}-${log.time}`}>
              <div>
                <strong>{log.action}</strong>
                <div className="helper-text">
                  {log.actor} · {log.ip}
                </div>
              </div>
              <div style={{ textAlign: "right" }}>
                <div>{log.time}</div>
                <span className={`tag ${log.outcome.includes("Blocked") ? "danger" : ""}`}>
                  {log.outcome}
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function MetricCard({ label, value, trend, trendClass }) {
  return (
    <div className="metric-card">
      <div className="table-muted">{label}</div>
      <div className="metric-value">{value}</div>
      <div className={trendClass}>{trend}</div>
    </div>
  );
}

function ActionCard({ title, body, badge }) {
  return (
    <div className="action-card">
      <span className="chip">{badge}</span>
      <h3>{title}</h3>
      <p>{body}</p>
    </div>
  );
}

function LoginScreen({ showMfa, onPrimaryAction, onBack }) {
  return (
    <div className="login-screen">
      <div className="login-portal">
        <header className="login-topbar">
          <div className="brand">
            <div className="brand-mark">SB</div>
            <div className="brand-text">
              <strong>SecureBank</strong>
              <span>Personal Internet Banking</span>
            </div>
          </div>
          <div className="login-topbar-links">
            <a href="#security">Security Advice</a>
            <a href="#help">Help & Support</a>
            <a href="#contact">Contact Us</a>
          </div>
        </header>

        <div className="login-shell">
          <section className="login-hero">
            <div className="login-hero-body">
              <p className="eyebrow" style={{ color: "rgba(255,255,255,0.78)" }}>
                Personal banking
              </p>
              <h1 className="login-hero-title">Secure access to your everyday banking.</h1>
              <p className="login-hero-copy">
                Sign in to check account balances, transfer funds, pay bills, and review recent
                activity.
              </p>
            </div>

            <div className="login-notice-panel">
              <h3 className="login-side-title">Security reminders</h3>
              <ul className="login-notice-list">
                <li>Do not share your password, one-time code, or transaction PIN with anyone.</li>
                <li>Verify that you are visiting the correct SecureBank website before signing in.</li>
                <li>Contact the bank immediately if you notice suspicious account activity.</li>
              </ul>
            </div>
          </section>

          <section className="login-panel">
            <div className="login-panel-header">
              <div>
                <h2 className="section-title">
                  {showMfa ? "Verify your login" : "Welcome back"}
                </h2>
              </div>
              <span className="login-lock">Secure Session</span>
            </div>

            <div className="form-grid login-form" style={{ marginTop: "18px", gridTemplateColumns: "1fr" }}>
              {!showMfa ? (
                <>
                  <div className="field">
                    <label htmlFor="login-email">Email address</label>
                    <input id="login-email" type="email" placeholder="Enter your email address" />
                  </div>
                  <div className="field">
                    <div className="row-between">
                      <label htmlFor="login-password">Password</label>
                      <a className="inline-link" href="#reset">Forgot password?</a>
                    </div>
                    <input id="login-password" type="password" placeholder="Enter your password" />
                  </div>
                  <div className="inline-note">
                    For your security, never share your password or one-time verification code.
                  </div>
                </>
              ) : (
                <>
                  <div className="field">
                    <label htmlFor="mfa-code">Authenticator code</label>
                    <input id="mfa-code" type="text" placeholder="Enter 6-digit code" />
                  </div>
                  <div className="field">
                    <label htmlFor="backup-code">Recovery code</label>
                    <input id="backup-code" type="text" placeholder="Optional recovery code" />
                  </div>
                  <div className="inline-note">
                    If you cannot access your authenticator app, use a recovery option or contact support.
                  </div>
                </>
              )}
            </div>

            <div className="hero-actions login-actions">
              <button className="primary-button" onClick={onPrimaryAction}>
                {showMfa ? "Sign in" : "Continue"}
              </button>
              {showMfa ? (
                <button className="secondary-button" onClick={onBack}>
                  Back
                </button>
              ) : (
                <button className="ghost-button">Need help signing in?</button>
              )}
            </div>

            <div className="login-support-strip">
              <div>
                <strong>Need assistance?</strong>
                <span>Call +65 6123 4567</span>
              </div>
              <div>
                <strong>Fraud hotline</strong>
                <span>Call +65 6987 6543</span>
              </div>
            </div>
          </section>
        </div>

        <footer className="login-footer">
          <span>Security Advice</span>
          <span>Privacy Statement</span>
          <span>Terms & Conditions</span>
          <span>Accessibility</span>
        </footer>
      </div>
    </div>
  );
}
