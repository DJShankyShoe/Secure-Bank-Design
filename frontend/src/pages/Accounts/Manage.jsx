import { useEffect, useState } from "react";
import { api } from "../../api/api";

export default function ManageAccount() {
  const [accountType, setAccountType] = useState("savings");
  const [accountToClose, setAccountToClose] = useState("");
  const [totpCode, setTotpCode] = useState("");
  const [accounts, setAccounts] = useState([]);

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

  const handleOpenAccount = async (e) => {
    e.preventDefault();

    try {
      const response = await api.createAccount(accountType);
      const newAccount = response.account || response;

      setAccounts((prevAccounts) => [...prevAccounts, newAccount]);

      alert(
        "Account opening requested. It will become available once an admin approves it."
      );
    } catch (err) {
      alert(err.message);
    }
  };

  const handleCloseAccount = async (e) => {
    e.preventDefault();

    try {
      await api.closeAccount(accountToClose, totpCode);

      setAccounts((prevAccounts) =>
        prevAccounts.map((account) =>
          account.account_id === accountToClose
            ? { ...account, status: "close_requested" }
            : account
        )
      );

      setAccountToClose("");
      setTotpCode("");

      alert("Account closure requested.");
    } catch (err) {
      alert(err.message);
    }
  };

  // Only one opening request may be pending admin approval at a time (FR-02).
  const pendingOpen = accounts.find(
    (account) => String(account.status || "").toLowerCase() === "open_requested"
  );

  const activeAccounts = accounts.filter((account) => {
    const status = String(account.status || "").toLowerCase();

    return (
      status !== "closed" &&
      status !== "inactive" &&
      status !== "close_requested" &&
      status !== "open_requested" &&
      !account.closed_at &&
      account.is_closed !== true
    );
  });

  return (
    <section className="section">
      <div className="section-header">
        <div>
          <h2 className="section-title">Account Management</h2>
          <div className="helper-text">
            Open a new account or request closure of an existing one.
          </div>
        </div>
      </div>

      <div className="dual-grid">
        <div className="content-card">
          <h3 className="card-title">Open New Account</h3>
          <p className="helper-text" style={{ marginBottom: "16px" }}>
            Request a new account. Opening requires admin approval; the opening balance
            will be SGD 0.00.
          </p>

          {pendingOpen ? (
            <div className="inline-note" style={{ marginTop: "4px" }}>
              You have an account opening request ({pendingOpen.account_type} ·{" "}
              {pendingOpen.account_number}) awaiting admin approval. You can request
              another account once it is approved.
            </div>
          ) : (
            <form onSubmit={handleOpenAccount} className="form-grid">
              <div className="field">
                <label>Account Type</label>
                <select
                  required
                  value={accountType}
                  onChange={(e) => setAccountType(e.target.value)}
                >
                  <option value="savings">Savings Account</option>
                  <option value="current">Current Account</option>
                </select>
              </div>

              <div className="hero-actions" style={{ marginTop: "10px" }}>
                <button type="submit" className="primary-button">
                  Request Account Opening
                </button>
              </div>
            </form>
          )}
        </div>

        <div className="content-card">
          <h3 className="card-title" style={{ color: "#DC2626" }}>
            Close Account
          </h3>
          <p className="helper-text" style={{ marginBottom: "16px" }}>
            Account balance must be exactly SGD 0.00 to proceed. Requires TOTP verification.
          </p>

          <form onSubmit={handleCloseAccount} className="form-grid">
            <div className="field">
              <label>Select Account to Close</label>
              <select
                required
                value={accountToClose}
                onChange={(e) => setAccountToClose(e.target.value)}
              >
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
                value={totpCode}
                onChange={(e) => setTotpCode(e.target.value.replace(/\D/g, ""))}
              />
            </div>

            <div className="hero-actions" style={{ marginTop: "10px" }}>
              <button
                type="submit"
                className="secondary-button"
                style={{ borderColor: "#DC2626", color: "#DC2626" }}
              >
                Request Closure
              </button>
            </div>
          </form>
        </div>
      </div>
    </section>
  );
}