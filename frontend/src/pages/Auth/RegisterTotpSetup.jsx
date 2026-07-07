import React, { useState } from "react";
import { toast } from '../../ui/notify.jsx';
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

  // Arriving via the login redirect never carries a provisioningUri (Login.jsx
  // only passes {email}), even for a user who never actually scanned the QR
  // the first time. Rather than assume they already have it, offer a way to
  // re-fetch it (password re-verify, since there's no session yet) — the
  // fetched URI is the SAME unrotated seed, see reissue_totp_provisioning.
  const [reissuedUri, setReissuedUri] = useState(null);
  const [reissuedBackupCodes, setReissuedBackupCodes] = useState(null);
  const [showReissueForm, setShowReissueForm] = useState(false);
  const [reissuePassword, setReissuePassword] = useState("");
  const [isReissuing, setIsReissuing] = useState(false);

  const effectiveProvisioningUri = provisioningUri || reissuedUri;
  const effectiveBackupCodes = backupCodes || reissuedBackupCodes;

  const getSecretFromUri = (uri) => {
    try {
      const queryString = uri.split("?")[1] || "";
      return new URLSearchParams(queryString).get("secret") || "";
    } catch {
      return "";
    }
  };

  const secret = effectiveProvisioningUri ? getSecretFromUri(effectiveProvisioningUri) : "";

  const handleReissue = async (e) => {
    e.preventDefault();
    try {
      setIsReissuing(true);
      const result = await api.reissueTotpSetup(resolvedEmail, reissuePassword);
      setReissuedUri(result.provisioning_uri);
      setReissuedBackupCodes(null);
      setShowReissueForm(false);
      setReissuePassword("");
      toast.success("QR code ready — scan it below.");
    } catch (err) {
      toast.error(err.message);
    } finally {
      setIsReissuing(false);
    }
  };

  const handleVerify = async (e) => {
    e.preventDefault();

    const cleanedCode = code.trim().replace(/\s/g, "");

    if (!/^\d{6}$/.test(cleanedCode)) {
      toast.error("Please enter a valid 6-digit authenticator code.");
      return;
    }

    try {
      setIsVerifying(true);

      const result = await api.verifyRegistrationTotp(resolvedEmail, cleanedCode);

      // Account only becomes usable once BOTH TOTP and the signup email are
      // verified (either order). If it's still pending, the email step remains —
      // send the user to the verification page instead of a dead-end "log in".
      if (result?.status === "active") {
        sessionStorage.removeItem("securebank_pending_email");
        toast.success("Setup complete. You can now log in.");
        navigate("/login");
      } else {
        sessionStorage.setItem("securebank_pending_email", resolvedEmail);
        navigate("/verify-email", { state: { email: resolvedEmail } });
      }
    } catch (err) {
      toast.error(err.message);
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

  const hasQrData = Boolean(effectiveProvisioningUri);

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
                    <QRCodeSVG value={effectiveProvisioningUri} size={200} />
                  </div>
                </div>

                {secret && (
                  <div className="field">
                    <label>Manual Setup Key</label>
                    <input type="text" value={secret} readOnly />
                  </div>
                )}

                {effectiveBackupCodes?.length > 0 && (
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
                      {effectiveBackupCodes.map((backupCode) => (
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
                {!showReissueForm ? (
                  <>
                    <div>
                      If you already scanned a QR code for <strong>{resolvedEmail}</strong>,
                      just enter the current code from your authenticator app below.
                    </div>
                    <button
                      type="button"
                      className="ghost-button"
                      style={{ marginTop: "10px" }}
                      onClick={() => setShowReissueForm(true)}
                    >
                      Never scanned it? Get the QR code
                    </button>
                  </>
                ) : (
                  <form onSubmit={handleReissue}>
                    <div>
                      Re-enter your password to show the QR code for{" "}
                      <strong>{resolvedEmail}</strong>.
                    </div>
                    <div className="field" style={{ marginTop: "10px" }}>
                      <label>Password</label>
                      <input
                        type="password"
                        required
                        value={reissuePassword}
                        onChange={(e) => setReissuePassword(e.target.value)}
                      />
                    </div>
                    <div style={{ display: "flex", gap: "8px" }}>
                      <button type="submit" className="primary-button" disabled={isReissuing}>
                        {isReissuing ? "Loading..." : "Show QR Code"}
                      </button>
                      <button
                        type="button"
                        className="ghost-button"
                        onClick={() => {
                          setShowReissueForm(false);
                          setReissuePassword("");
                        }}
                      >
                        Cancel
                      </button>
                    </div>
                  </form>
                )}
              </div>
            )}

            <form
              onSubmit={handleVerify}
              className="form-grid login-form"
              style={{ marginTop: "18px", gridTemplateColumns: "1fr" }}
            >
              <div className="field">
                <label>Enter the 6-digit code generated by the authenticator app</label>
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