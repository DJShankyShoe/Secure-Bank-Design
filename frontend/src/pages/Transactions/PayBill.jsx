// PayBill.jsx
import { toast } from '../../ui/notify.jsx';
import React, { useEffect, useState } from 'react';
import { api } from '../../api/api';

export default function PayBill() {
  const [accounts, setAccounts] = useState([]);
  const [billers, setBillers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  const [paymentData, setPaymentData] = useState({
    billerId: '',
    sourceAccount: '',
    amount: '',
    date: ''
  });

  useEffect(() => {
    const loadData = async () => {
      try {
        const [accountsRes, billersRes] = await Promise.all([
          api.getAccounts(),
          api.getBillers(),
        ]);

        const loadedAccounts = accountsRes.accounts || [];
        const loadedBillers = billersRes.billers || [];

        setAccounts(loadedAccounts);
        setBillers(loadedBillers);

        // Default the source to the first ACTIVE account (not a pending
        // 'open_requested' one, which is excluded from the dropdown and can't pay).
        const firstActive = loadedAccounts.find(
          (a) => String(a.status || "").toLowerCase() === "active"
        );
        setPaymentData((prev) => ({
          ...prev,
          billerId: loadedBillers[0]?.biller_id || '',
          sourceAccount: firstActive?.account_number || '',
        }));

      } catch (err) {
        toast.error(err.message);
      } finally {
        setLoading(false);
      }
    };

    loadData();
  }, []);

  const formatAccountLabel = (account) =>
    `${account.account_type} • ${account.account_number}`;

  const selectedBiller = billers.find((b) => b.biller_id === paymentData.billerId);
  const selectedAccount = accounts.find((a) => a.account_number === paymentData.sourceAccount);

  // Strict Currency Validator
  const handleAmountChange = (e) => {
    const value = e.target.value;
    if (value === '' || /^\d*\.?\d{0,2}$/.test(value)) {
      setPaymentData({ ...paymentData, amount: value });
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();

    const amount_cents = Math.round(parseFloat(paymentData.amount) * 100);

    setSubmitting(true);
    try {
      await api.billPayment(
        paymentData.sourceAccount,
        paymentData.billerId,
        amount_cents
      );
      toast.success("Bill payment initiated successfully.");
      setPaymentData({ ...paymentData, amount: '', date: '' });
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  // Only 'active' accounts can pay bills — the backend rejects any other status
  // (open_requested / suspended / close_requested / closed all freeze the account).
  // Allowlist rather than denylist so a new status can never silently slip through.
  const activeAccounts = accounts.filter(
    (account) => String(account.status || "").toLowerCase() === "active"
  );


  return (
    <section className="section">
      <div className="section-header">
        <div>
          <h2 className="section-title">Bill Payment</h2>
          <div className="helper-text">Pay registered billers from your selected account.</div>
        </div>
      </div>

      <div className="dual-grid">
        
        {/* Left Side: Payment Form */}
        <div className="content-card">
          <h3 className="card-title">Payment Flow</h3>
          <form onSubmit={handleSubmit} className="form-grid">
            <div className="field">
              <label>Registered Biller</label>
              <select 
                value={paymentData.billerId} 
                onChange={(e) => setPaymentData({...paymentData, billerId: e.target.value})}
                disabled={loading}
              >
                {billers.map((biller) => (
                  <option key={biller.biller_id} value={biller.biller_id}>
                    {biller.biller_name}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label>Pay From</label>
              <select 
                value={paymentData.sourceAccount} 
                onChange={(e) => setPaymentData({...paymentData, sourceAccount: e.target.value})}
                disabled={loading}
              >
                {activeAccounts.map((account) => (
                  <option key={account.account_id} value={account.account_number}>
                    {formatAccountLabel(account)}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label>Amount (SGD)</label>
              <input 
                type="text" 
                inputMode="decimal"
                placeholder="0.00" 
                required 
                value={paymentData.amount} 
                onChange={handleAmountChange} 
              />
            </div>
            
            <div className="field full">
              <div className="inline-note">
                Please review the payment amount before submission.
              </div>
            </div>

            <div className="hero-actions" style={{ marginTop: '16px' }}>
              <button type="submit" className="primary-button" disabled={submitting || loading}>
                {submitting ? "Processing..." : "Confirm Payment"}
              </button>
              <button type="button" className="secondary-button">Payment history</button>
            </div>
          </form>
        </div>

        {/* Right Side: Payment Summary */}
        <div className="content-card">
          <h3 className="card-title">Payment Summary</h3>
          <ul className="stack-list">
            <li className="row-between">
              <span className="table-muted">Biller</span>
              <strong>{selectedBiller?.biller_name || '—'}</strong>
            </li>
            <li className="row-between">
              <span className="table-muted">Account</span>
              <strong style={{ fontSize: '0.9rem' }}>
                {selectedAccount ? formatAccountLabel(selectedAccount) : '—'}
              </strong>
            </li>
            <li className="row-between">
              <span className="table-muted">Payment Amount</span>
              <strong>SGD {paymentData.amount ? parseFloat(paymentData.amount).toFixed(2) : '0.00'}</strong>
            </li>
            <li className="row-between">
              <span className="table-muted">Receipt channel</span>
              <strong>Transaction history (& Email if enabled)</strong>
            </li>
          </ul>
        </div>

      </div>
    </section>
  );
}