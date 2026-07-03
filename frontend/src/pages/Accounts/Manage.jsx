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
          <h2 className="section-title">Manage Accounts</h2>
          <div className="helper-text">Update your contact details or request account closure.</div>
        </div>
      </div>

      <div className="dual-grid">
        <div className="content-card">
          <h3 className="card-title">Update Email Address</h3>
          <form onSubmit={handleUpdateEmail} className="form-grid">
            <div className="field">
              <label>New Email Address</label>
              <input type="email" required value={newEmail} onChange={(e) => setNewEmail(e.target.value)} />
            </div>
            <div className="hero-actions" style={{ marginTop: '10px' }}>
              <button type="submit" className="primary-button">Send Verification Link</button>
            </div>
          </form>
        </div>

        <div className="content-card">
          <h3 className="card-title" style={{ color: '#d93025' }}>Close Account</h3>
          <p className="helper-text" style={{ marginBottom: '16px' }}>
            Account balance must be SGD 0.00 to proceed. Requires TOTP verification.
          </p>
          <form onSubmit={handleCloseAccount} className="form-grid">
            <div className="field">
              <label>Select Account to Close</label>
              <select required value={accountToClose} onChange={(e) => setAccountToClose(e.target.value)}>
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
              <input type="text" maxLength="6" required placeholder="123456" value={totpCode} onChange={(e) => setTotpCode(e.target.value)} />
            </div>
            <div className="hero-actions" style={{ marginTop: '10px' }}>
              <button type="submit" className="secondary-button" style={{ borderColor: '#d93025', color: '#d93025' }}>Close Account</button>
            </div>
          </form>
        </div>
      </div>
    </section>
  );
}