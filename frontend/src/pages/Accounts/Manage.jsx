import { useEffect, useState } from "react";
import { api } from "../../api/api";

export default function ManageAccount() {
  const [newEmail, setNewEmail] = useState('');
  const [totpCode, setTotpCode] = useState('');
  const [accountToClose, setAccountToClose] = useState('');
  const [accounts, setAccounts] = useState([]);

  //remove hardcoded acc list.
  useEffect(() => {
  const loadAccounts = async () => {
    try {
      const response = await api.getAccounts();
      setAccounts(response.accounts);
    } catch (err) {
      alert(err.message);
    }
    };

    loadAccounts();
  }, []);

  const handleUpdateEmail = async (e) => {
  e.preventDefault();

    try {
      const response = await api.requestEmailChange(newEmail);

      alert(response.status);

    } catch (err) {
      alert(err.message);
    }
  };

  const handleCloseAccount = async (e) => {
  e.preventDefault();

    try {
      await api.closeAccount(
        accountToClose,
        totpCode
      );

      setAccounts((prevAccounts) =>
        prevAccounts.filter((account) => account.account_id !== accountToClose)
      );

      setAccountToClose('');
      setTotpCode('');

      alert("Account closed.");

    } catch (err) {
      alert(err.message);
    }
  }

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
          <h2 className="section-title">Account Management</h2>
          <div className="helper-text">Request a new account or close an existing one.</div>
        </div>
      </div>

      <div className="dual-grid">
        
        {/* LEFT: Request New Account */}
        <div className="content-card">
          <h3 className="card-title">Open New Account</h3>
          <p className="helper-text" style={{ marginBottom: '16px' }}>
            Submit a request to open an additional account. All requests are subject to approval.
          </p>
          <form onSubmit={handleOpenAccount} className="form-grid">
            <div className="field">
              <label>Account Type</label>
              <select required value={openData.type} onChange={(e) => setOpenData({...openData, type: e.target.value})}>
                <option value="savings">Savings Account</option>
                <option value="current">Current Account</option>
                <option value="fixed_deposit">Fixed Deposit Account</option>
              </select>
            </div>
            <div className="hero-actions" style={{ marginTop: '10px' }}>
              <button type="submit" className="primary-button">Submit Request</button>
            </div>
          </form>
        </div>

        {/* RIGHT: Close Existing Account */}
        <div className="content-card">
          <h3 className="card-title" style={{ color: '#DC2626' }}>Close Account</h3>
          <p className="helper-text" style={{ marginBottom: '16px' }}>
            Account balance must be exactly SGD 0.00 to proceed. Requires TOTP verification.
          </p>
          <form onSubmit={handleCloseAccount} className="form-grid">
            <div className="field">
              <label>Select Account to Close</label>
              <select required value={closeData.accountId} onChange={(e) => setCloseData({...closeData, accountId: e.target.value})}>
                <option value="">-- Select Account --</option>
                {activeAccounts.map((account) => (
                  <option
                    key={account.account_id}
                    value={account.account_id}
                  >
                    {account.account_type} ({account.account_number})
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label>Authenticator Code (TOTP)</label>
              <input 
                type="text" 
                inputMode="numeric"
                maxLength="6" 
                required 
                placeholder="123456" 
                value={closeData.totpCode} 
                onChange={(e) => setCloseData({...closeData, totpCode: e.target.value.replace(/\D/g, '')})} 
              />
            </div>
            <div className="hero-actions" style={{ marginTop: '10px' }}>
              <button type="submit" className="secondary-button" style={{ borderColor: '#DC2626', color: '#DC2626' }}>Request Closure</button>
            </div>
          </form>
        </div>

      </div>
    </section>
  );
}