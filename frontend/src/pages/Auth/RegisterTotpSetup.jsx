import React, { useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { QRCodeSVG } from "qrcode.react";
import { api } from "../../api/api";

export default function RegisterTotpSetup() {
  const navigate = useNavigate();
  const location = useLocation();

  const { email, provisioningUri, backupCodes } = location.state || {};

  // Fallback: if arriving from a login redirect (no provisioningUri yet),
  // still allow code entry using the email + sessionStorage fallback.
  const resolvedEmail =
    email || sessionStorage.getItem("securebank_pending_email") || "";

  const [code, setCode] = useState("");
  const [isVerifying, setIsVerifying] = useState(false);

  const getSecretFromUri = (uri) => {
    try {
      const queryString = uri.split("?")[1] || "";
      return new URLSearchParams(queryString).get("secret") || "";
    } catch {
      return "";
    }
  };

  const secret = provisioningUri ? getSecretFromUri(provisioningUri) : "";

  const handleVerify = async (e) => {
    e.preventDefault();

    const cleanedCode = code.trim().replace(/\s/g, "");

    if (!/^\d{6}$/.test(cleanedCode)) {
      alert("Please enter a valid 6-digit authenticator code.");
      return;
    }

    try {
      setIsVerifying(true);

      await api.verifyRegistrationTotp(resolvedEmail, cleanedCode);

      sessionStorage.removeItem("securebank_pending_email");
      alert("Authenticator setup successful. You can now log in.");
      navigate("/login");
    } catch (err) {
      alert(err.message);
    } finally {
      setIsVerifying(false);
    }
  };

  // Only bail out completely if we don't even have an email to work with.
  if (!resolvedEmail) {
    return (
      <div className="login-screen">
        <div className="login-portal">
          <div className="login-shell" style={{ maxWidth: "500px", margin: "0 auto" }}>
            <section className="login-panel">
              <h2 className="section-title">Missing Setup Details</h2>
              <p className="helper-text">
                Please register again to set up your authenticator.
              </p>
              <button className="primary-button" onClick={() => navigate("/register")}>
                Back to Register
              </button>
              <button
                type="button"
                className="ghost-button"
                style={{ marginTop: "12px" }}
                onClick={() => navigate("/login")}
              >
                Back to Login
              </button>
            </section>
          </div>
        </div>
      </div>
    );
  }

  const hasQrData = Boolean(provisioningUri);

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
        </header>

        <div className="login-shell" style={{ maxWidth: "560px", margin: "0 auto" }}>
          <section className="login-panel">
            <div className="login-panel-header">
              <h2 className="section-title">
                {hasQrData ? "Set Up Authenticator" : "Complete Authenticator Setup"}
              </h2>
              <p className="helper-text">
                {hasQrData
                  ? "Scan this QR code using Google Authenticator, Microsoft Authenticator, or another TOTP app."
                  : "Your account still needs authenticator verification. Enter the 6-digit code from your authenticator app to continue."}
              </p>
            </div>

            {hasQrData && (
              <>
                <div style={{ display: "flex", justifyContent: "center", margin: "24px 0" }}>
                  <div style={{ background: "white", padding: "16px", borderRadius: "12px" }}>
                    <QRCodeSVG value={provisioningUri} size={200} />
                  </div>
                </div>

                {secret && (
                  <div className="field">
                    <label>Manual Setup Key</label>
                    <input type="text" value={secret} readOnly />
                  </div>
                )}

                {backupCodes?.length > 0 && (
                  <div className="field">
                    <label>Backup Codes</label>
                    <div className="inline-note">
                      Save these codes somewhere safe. They may only be shown once.
                    </div>

                    <div
                      style={{
                        display: "grid",
                        gridTemplateColumns: "1fr 1fr",
                        gap: "8px",
                        marginTop: "10px",
                      }}
                    >
                      {backupCodes.map((backupCode) => (
                        <code key={backupCode}>{backupCode}</code>
                      ))}
                    </div>
                  </div>
                )}
              </>
            )}

            {!hasQrData && (
              <div
                style={{
                  padding: "12px 16px",
                  backgroundColor: "#FFFBEB",
                  border: "1px solid #FCD34D",
                  color: "#92400E",
                  borderRadius: "8px",
                  margin: "20px 0",
                  fontSize: "0.9rem",
                }}
              >
                No new QR code needed — just enter the current code from the
                authenticator app you already set up for <strong>{resolvedEmail}</strong>.
              </div>
            )}

            <form
              onSubmit={handleVerify}
              className="form-grid login-form"
              style={{ marginTop: "18px", gridTemplateColumns: "1fr" }}
            >
              <div className="field">
                <label>Enter 6-digit code</label>
                <input
                  type="text"
                  inputMode="numeric"
                  maxLength="6"
                  required
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  placeholder="123456"
                />
              </div>

              <div className="hero-actions login-actions" style={{ marginTop: "20px" }}>
                <button type="submit" className="primary-button" disabled={isVerifying}>
                  {isVerifying ? "Verifying..." : "Verify Authenticator"}
                </button>

                <button
                  type="button"
                  className="ghost-button"
                  onClick={() => navigate("/login")}
                >
                  Back to Login
                </button>
              </div>
            </form>
          </section>
        </div>
      </div>
    </div>
  );
}