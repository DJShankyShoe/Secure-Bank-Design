import React from 'react';
import { useNavigate } from 'react-router-dom';

const transfers = [
  { title: "Home utility bill", counterpart: "SP Services", amount: "- SGD 124.90", date: "24 May 2026, 09:40", status: "Completed" },
  { title: "Salary credit", counterpart: "Ficta Labs Pte Ltd", amount: "+ SGD 5,400.00", date: "23 May 2026, 08:05", status: "Completed" },
];

export default function Dashboard() {
  const navigate = useNavigate();

  return (
    <>
      <section className="hero">
        <div className="hero-copy">
          <p className="eyebrow">Welcome back</p>
          <h1>Your accounts, payments, and transfers in one place.</h1>
          <div className="hero-actions">
            <button className="primary-button" onClick={() => navigate('/transfer')}>Make a transfer</button>
            <button className="primary-button" onClick={() => navigate('/bills')}>Pay bills</button>
            <button className="secondary-button" onClick={() => navigate('/settings')}>Security settings (TBD)</button>
          </div>
        </div>
      </section>

      <section className="metrics-grid">
        <div className="metric-card">
          <div className="table-muted">Available balance</div>
          <div className="metric-value">SGD 23,300.75</div>
          <div className="trend-up">+4.2% from last month</div>
        </div>
        <div className="metric-card">
          <div className="table-muted">Protected transfers</div>
          <div className="metric-value">7</div>
          <div className="trend-warn">2 awaiting PIN review</div>
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
                      <span className="amount">{entry.amount}</span>
                    </div>
                    <div className="timeline-meta">{entry.counterpart} · {entry.date}</div>
                    <div className="timeline-description">Status: {entry.status}</div>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>
    </>
  );
}