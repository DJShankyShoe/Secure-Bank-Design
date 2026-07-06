// Transfer.jsx
import { toast } from '../../ui/notify.jsx';
import React, { useEffect, useMemo, useState } from 'react';
import { api } from '../../api/api';

export default function Transfer() {
  const projectedFee = useMemo(() => "SGD 0.00", []);

  const [accounts, setAccounts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  const [formData, setFormData] = useState({
    sourceAccount: '',
    destinationType: 'Third-party',
    beneficiaryName: '',
    destinationAccount: '',
    amount: '',
    reference: ''
  });

  const [transactionPin, setTransactionPin] = useState('');

  useEffect(() => {
    const loadAccounts = async () => {
      try {
        const response = await api.getAccounts();
        const loadedAccounts = response.accounts || [];
        setAccounts(loadedAccounts);

        // Default the source to the first ACTIVE account (not a pending
        // 'open_requested' one, which is excluded from the dropdown and can't transact).
        const firstActive = loadedAccounts.find(
          (a) => String(a.status || "").toLowerCase() === "active"
        );
        setFormData((prev) => ({
          ...prev,
          sourceAccount: firstActive?.account_number || '',
        }));

      } catch (err) {
        toast.error(err.message);
      } finally {
        setLoading(false);
      }
    };

    loadAccounts();
  }, []);

  const formatAccountLabel = (account) =>
    `${account.account_type} • ${account.account_number}`;

  // Strict Currency Validator
  const handleAmountChange = (e) => {
    const value = e.target.value;
    if (value === '' || /^\d*\.?\d{0,2}$/.test(value)) {
      setFormData({ ...formData, amount: value });
    }
  };

  // Determine if PIN is required dynamically (>= 1000 SGD)
  const requiresPin = parseFloat(formData.amount || 0) >= 1000;

  const handleSubmit = async (e) => {
    e.preventDefault();

    const amount_cents = Math.round(parseFloat(formData.amount) * 100);

    if (!Number.isFinite(amount_cents) || amount_cents <= 0) {
      toast.error("Enter an amount greater than SGD 0.00.");
      return;
    }

    setSubmitting(true);
    try {
      await api.transfer(
        formData.sourceAccount,
        formData.destinationAccount,
        amount_cents,
        requiresPin ? transactionPin : null
      );
      toast.success("Transfer initiated successfully.");
      setFormData({ ...formData, amount: '', reference: '', beneficiaryName: '', destinationAccount: '' });
      setTransactionPin('');
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  // Only 'active' accounts can transact — the backend rejects any other status
  // (open_requested / suspended / close_requested / closed all freeze transfers).
  // Allowlist rather than denylist so a new status can never silently slip through.
  const activeAccounts = accounts.filter(
    (account) => String(account.status || "").toLowerCase() === "active"
  );

  return (
    <section className="section">
      <div className="section-header">
        <div>
          <h2 className="section-title">Transfer funds</h2>
          <div className="helper-text">Transfer funds between your accounts or to third-party beneficiaries.</div>
        </div>
      </div>

      <form onSubmit={handleSubmit}>
        <div className="dual-grid">
          
          {/* Left Side: Transfer Form */}
          <div className="content-card">
            <h3 className="card-title">Transfer form</h3>
            <div className="form-grid">
              <div className="field">
                <label>From account</label>
                <select 
                  value={formData.sourceAccount}
                  onChange={(e) => setFormData({...formData, sourceAccount: e.target.value})}
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
                <label>Transfer type</label>
                <select 
                  value={formData.destinationType}
                  onChange={(e) => setFormData({...formData, destinationType: e.target.value})}
                >
                  <option>Own account</option>
                  <option>Third-party</option>
                </select>
              </div>
              <div className="field">
                <label>Beneficiary name</label>
                <input 
                  type="text" 
                  placeholder="e.g. A. Tan"
                  value={formData.beneficiaryName}
                  onChange={(e) => setFormData({...formData, beneficiaryName: e.target.value})}
                  required 
                />
              </div>
              <div className="field">
                <label>Beneficiary account number</label>
                <input 
                  type="text" 
                  placeholder="e.g. 1029384756"
                  value={formData.destinationAccount}
                  onChange={(e) => setFormData({...formData, destinationAccount: e.target.value})}
                  required 
                />
              </div>
              <div className="field">
                <label>Amount (SGD)</label>
                <input 
                  type="text" 
                  inputMode="decimal"
                  placeholder="0.00"
                  value={formData.amount}
                  onChange={handleAmountChange}
                  required 
                />
              </div>
              <div className="field">
                <label>Reference</label>
                <input 
                  type="text" 
                  placeholder="e.g. May allowance"
                  value={formData.reference}
                  onChange={(e) => setFormData({...formData, reference: e.target.value})}
                />
              </div>
              <div className="field full">
                <div className="inline-note">
                  Transfers above SGD 1,000 require additional confirmation before submission.
                </div>
              </div>
            </div>
            
            <div className="hero-actions" style={{ marginTop: '20px' }}>
              <button type="submit" className="primary-button" disabled={submitting || loading}>
                {submitting ? "Processing..." : "Continue"}
              </button>
            </div>
          </div>

          {/* Right Side: Dynamic Summary */}
          <div className="content-card">
            <h3 className="card-title">Transfer summary</h3>
            <ul className="stack-list">
              <li className="row-between">
                <span className="table-muted">Transfer amount</span>
                <strong>SGD {formData.amount ? parseFloat(formData.amount).toFixed(2) : '0.00'}</strong>
              </li>
              <li className="row-between">
                <span className="table-muted">Security threshold</span>
                {requiresPin ? (
                  <span className="tag warning">Additional confirmation required</span>
                ) : (
                  <span className="tag chip-muted">Standard transfer</span>
                )}
              </li>
              <li className="row-between">
                <span className="table-muted">Receipt channel</span>
                <strong>Transaction history (& Email if enabled)</strong>
              </li>
            </ul>

            {/* Conditionally render the PIN input based on amount */}
            {requiresPin && (
              <div className="mini-card" style={{ marginTop: "20px", border: '1px solid #ffc107', backgroundColor: '#fffdf5' }}>
                <h4 className="card-title" style={{ color: '#856404' }}>Confirmation Required</h4>
                <div className="field">
                  <label>Enter 6-digit transaction PIN</label>
                  <input 
                    type="password" 
                    placeholder="••••••" 
                    maxLength="6"
                    required={requiresPin}
                    value={transactionPin}
                    onChange={(e) => setTransactionPin(e.target.value.replace(/\D/g, ''))}
                  />
                </div>
              </div>
            )}
          </div>
          
        </div>
      </form>
    </section>
  );
}