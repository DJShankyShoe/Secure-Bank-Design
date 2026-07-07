const BASE_URL = "";

let csrfToken = null;

export function resetCsrf() {
  csrfToken = null;
}

// Called whenever the server rejects a request as unauthenticated (401) — e.g. an
// expired/revoked/missing session. App registers a handler that clears auth state
// so the route guards send the user back to /login.
let onUnauthorized = null;
export function setUnauthorizedHandler(fn) {
  onUnauthorized = fn;
}

// Called after each successful request — the server extends the session's idle
// window on every request, so the UI can reset its "session expires in" countdown
// off the same signal.
let onActivity = null;
export function setActivityHandler(fn) {
  onActivity = fn;
}

/**
 * Get CSRF token
 */
export async function initCsrf(force = false) {
  if (csrfToken && !force) return csrfToken;

  const res = await fetch(`${BASE_URL}/auth/csrf`, {
    credentials: "include",
  });

  if (!res.ok) {
    throw new Error("Failed to obtain CSRF token");
  }

  const data = await res.json();
  csrfToken = data.csrf_token;

  return csrfToken;
}

async function request(endpoint, options = {}, retryOnCsrf = true) {
  const method = options.method || "GET";

  if (method !== "GET") {
    await initCsrf(true);
  }

  const headers = {
    "Content-Type": "application/json",
    ...(csrfToken ? { "X-CSRFToken": csrfToken } : {}),
    ...(options.headers || {}),
  };

  const response = await fetch(`${BASE_URL}${endpoint}`, {
    credentials: "include",
    ...options,
    headers,
  });

  let data = {};

  try {
    data = await response.json();
  } catch {
    data = {};
  }

  if (!response.ok) {
    const errorMessage = data.error || data.message || "Request failed";

    const isCsrfError =
      response.status === 403 &&
      errorMessage.toLowerCase().includes("csrf");

    if (isCsrfError && retryOnCsrf) {
      await initCsrf(true);
      return request(endpoint, options, false);
    }

    // Session invalid/expired/missing → let the app clear auth + redirect to login.
    // Some endpoints return 401 for a wrong re-entered credential (current password,
    // step-up TOTP) on an otherwise-valid session — those opt out via skipAuthRedirect
    // so a typo doesn't bounce the user to the login page.
    if (response.status === 401 && onUnauthorized && !options.skipAuthRedirect) {
      onUnauthorized();
    }

    const error = new Error(errorMessage);
    error.status = response.status;
    error.data = data;
    throw error;
  }

  if (data.csrf_token) {
    csrfToken = data.csrf_token;
  }

  // Successful request → the server just refreshed the session's idle window
  // (skip for passive/background calls that intentionally don't extend it,
  // e.g. the notification-bell poll — see skipActivityPing — so the visible
  // countdown doesn't lie about a reset the server didn't actually grant).
  if (onActivity && !options.skipActivityPing) onActivity();

  return data;
}

export const api = {

  // =========================
  // AUTH
  // =========================
  requestPasswordReset: (email, nric) =>
    request("/auth/password/reset/request", {
      method: "POST",
      body: JSON.stringify({
        email,
        nric,
      }),
    }),

  resetPassword: (token, new_password, totp_code) =>
    request("/auth/password/reset/verify", {
      method: "POST",
      body: JSON.stringify({
        token,
        new_password,
        totp_code,
      }),
    }),

  register: (full_name, nric, email, password) =>
    request("/auth/register", {
      method: "POST",
      body: JSON.stringify({
        full_name,
        nric,
        email,
        password,
      }),
    }),

  verifyRegistrationTotp: (email, code) =>
    request("/auth/register/verify-totp", {
      method: "POST",
      body: JSON.stringify({
        email,
        code,
      }),
    }),

  // Re-issues the SAME (unrotated) TOTP provisioning URI for a 'pending'
  // account that hasn't confirmed TOTP yet — used when a user never scanned
  // the QR code the first time and comes back later to finish setup. Not
  // logged in yet at this stage, so the password re-verifies identity.
  reissueTotpSetup: (email, password) =>
    request("/auth/register/totp-setup", {
      method: "POST",
      body: JSON.stringify({
        email,
        password,
      }),
    }),


  verifySignupEmail: (token) =>
  request("/auth/register/verify-email", {
    method: "POST",
    body: JSON.stringify({
      token,
    }),
  }),

  login: async (email, password) => {
    csrfToken = null;

    return request("/auth/login", {
      method: "POST",
      body: JSON.stringify({
        email,
        password,
      }),
    });
  },

  verifyMfa: async (mfa_token, code) => {
    const response = await request("/auth/login/mfa", {
      method: "POST",
      body: JSON.stringify({
        mfa_token,
        code,
      }),
    });

    return response;
  },

  logout: async () => {
    try {
      return await request("/auth/logout", {
        method: "POST",
      });
    } finally {
      csrfToken = null;
      sessionStorage.removeItem("securebank_user");
    }
  },

  // Current authenticated user's profile (name, role, status).
  // NOTE: does NOT include PIN status — use getPinStatus() for that.
  me: () =>
    request("/auth/me", {
      method: "GET",
    }),

  // 401 here means "wrong current password", not an invalid session — skip the
  // global auth-redirect so a typo doesn't bounce the user to /login.
  requestEmailChange: (new_email, password) =>
    request("/auth/email", {
      method: "POST",
      skipAuthRedirect: true,
      body: JSON.stringify({
        new_email,
        password,
      }),
    }),

  verifyEmailChange: (token) =>
    request("/auth/email/verify", {
      method: "POST",
      body: JSON.stringify({
        token,
      }),
    }),

  // Notifications (customer bell). A locked account has no self-service unlock
  // endpoint — it auto-unlocks after 30 min or an admin unlocks it; the user is
  // told via these notifications + email.
  // Backend doesn't extend the idle session for this poll either (SR-13) — kept
  // in sync so the visible session timer never shows a reset that didn't happen.
  getNotifications: (page = 1) =>
    request(`/notifications?page=${page}`, { method: "GET", skipActivityPing: true }),

  markNotificationRead: (notificationId) =>
    request(`/notifications/${notificationId}/read`, { method: "POST" }),

  markAllNotificationsRead: () =>
    request("/notifications/read-all", { method: "POST" }),

    resendVerificationEmail: (email) =>
    request("/auth/register/resend-email", {
      method: "POST",
      body: JSON.stringify({ email }),
    }),

  // =========================
  // ACCOUNTS
  // =========================

  createAccount: (account_type) =>
    request("/accounts", {
      method: "POST",
      body: JSON.stringify({
        account_type,
      }),
    }),

  getAccounts: () =>
    request("/accounts", {
      method: "GET",
    }),

  getAccount: (accountId) =>
    request(`/accounts/${accountId}`, {
      method: "GET",
    }),

  // Backend filter params (SR-06 validated): page, type ('transfer'/'bill_payment'),
  // date_from (YYYY-MM-DD), amount_min (integer cents).
  getTransactions: (accountId, { page = 1, type, dateFrom, amountMin } = {}) => {
    const params = new URLSearchParams({ page: String(page) });
    if (type) params.set("type", type);
    if (dateFrom) params.set("date_from", dateFrom);
    if (amountMin != null) params.set("amount_min", String(amountMin));
    return request(`/accounts/${accountId}/transactions?${params.toString()}`, {
      method: "GET",
    });
  },

  // 401 here means "wrong step-up TOTP code", not an invalid session — skip the
  // global auth-redirect so a typo doesn't bounce the user to /login.
  closeAccount: (accountId, totp_code) =>
    request(`/accounts/${accountId}/close`, {
      method: "POST",
      skipAuthRedirect: true,
      body: JSON.stringify({
        totp_code,
      }),
    }),

    // 401 here means "wrong current password", not an invalid session — skip the
    // global auth-redirect so a typo doesn't bounce the user to /login.
    changePassword: (current_password, new_password) =>
    request("/auth/password/change", {
      method: "POST",
      skipAuthRedirect: true,
      body: JSON.stringify({
        current_password,
        new_password,
      }),
    }),

    getAccountPreferences: () =>
    request("/accounts/preferences", { method: "GET" }),
    updateAccountPreferences: (prefs) =>
      request("/accounts/preferences", {
        method: "PUT",
        body: JSON.stringify(prefs),
      }),

    checkResetToken: (token) =>
    request(`/auth/password/reset/check?token=${token}`, {
      method: "GET",
    }),
  // =========================
  // TRANSACTIONS
  // =========================

  // check whether the user already has a transaction PIN set.
  // Per backend spec: GET /transactions/pin → { pin_set: true/false }
  getPinStatus: () =>
    request("/transactions/pin", {
      method: "GET",
    }),

  // Set (first time) or replace (subsequent) the transaction PIN.
  // Per backend spec: password is only required when REPLACING an existing PIN.
  // First-time setup (SetupPin.jsx) omits password; a future "change PIN" flow
  // in Settings should pass the current password as the second argument.
  // 401 on the replace path means "wrong current password", not an invalid
  // session — skip the global auth-redirect so a typo doesn't bounce to /login.
  setTransactionPin: (pin, password = null) =>
    request("/transactions/pin", {
      method: "POST",
      skipAuthRedirect: true,
      body: JSON.stringify(
        password ? { pin, password } : { pin }
      ),
    }),

  getBillers: () =>
    request("/transactions/billers", {
      method: "GET",
    }),

  // 401 here means "wrong transaction PIN" (transfers >= SGD 1,000), not an
  // invalid session — skip the global auth-redirect so a PIN typo doesn't
  // bounce the user to /login.
  transfer: (
    source_account_number,
    destination_account_number,
    amount_cents,
    pin = null
  ) =>
    request("/transactions/transfer", {
      method: "POST",
      skipAuthRedirect: true,
      headers: {
        "Idempotency-Key": crypto.randomUUID(),
      },
      body: JSON.stringify({
        source_account_number,
        destination_account_number,
        amount_cents,
        pin,
      }),
    }),

  billPayment: (
    source_account_number,
    biller_id,
    amount_cents
  ) =>
    request("/transactions/bill-payment", {
      method: "POST",
      headers: {
        "Idempotency-Key": crypto.randomUUID(),
      },
      body: JSON.stringify({
        source_account_number,
        biller_id,
        amount_cents,
      }),
    }),

  // =========================
  // ADMIN
  // =========================

  getUsers: () =>
    request("/admin/users", {
      method: "GET",
    }),

  getAdminAccounts: () =>
    request("/admin/accounts", {
      method: "GET",
    }),

  getAuditLogs: (page = 1, type = "", user = "") => {
    const params = new URLSearchParams({ page: String(page) });
    if (type) params.set("type", type);
    if (user) params.set("user", user);
    return request(`/admin/audit?${params.toString()}`, { method: "GET" });
  },

  getUserAccounts: (userId) =>
    request(`/admin/users/${userId}/accounts`, {
      method: "GET",
    }),

  approveOpening: (accountId) =>
    request(`/admin/accounts/${accountId}/opening/approve`, {
      method: "POST",
    }),

  rejectOpening: (accountId, reason) =>
    request(`/admin/accounts/${accountId}/opening/reject`, {
      method: "POST",
      body: JSON.stringify({ reason }),
    }),

  approveClosure: (accountId) =>
    request(`/admin/accounts/${accountId}/closure/approve`, {
      method: "POST",
    }),

  rejectClosure: (accountId, reason) =>
    request(`/admin/accounts/${accountId}/closure/reject`, {
      method: "POST",
      body: JSON.stringify({ reason }),
    }),

  suspendAccount: (accountId, reason) =>
    request(`/admin/accounts/${accountId}/suspend`, {
      method: "POST",
      body: JSON.stringify({ reason }),
    }),

  unsuspendAccount: (accountId) =>
    request(`/admin/accounts/${accountId}/unsuspend`, {
      method: "POST",
    }),

  suspendUser: (userId, reason) =>
    request(`/admin/users/${userId}/suspend`, {
      method: "POST",
      body: JSON.stringify({
        reason,
      }),
    }),

  unlockUser: (userId) =>
    request(`/admin/users/${userId}/unlock`, {
      method: "POST",
    }),

  getUserNric: (userId) =>
    request(`/admin/users/${userId}/nric`, {
      method: "GET",
    }),

  adminCloseAccount: (accountId, reason) =>
    request(`/admin/accounts/${accountId}/close`, {
      method: "POST",
      body: JSON.stringify({
        reason,
      }),
    }),

  // =========================
  // SUPERADMIN (role + admin management; superadmin role only)
  // =========================

  // Directory of all users with their role/status (for role management).
  // Optional ?q= search (email/name) and ?role= filter.
  getRoleDirectory: (q = "", role = "") => {
    const params = new URLSearchParams();
    if (q) params.set("q", q);
    if (role) params.set("role", role);
    const qs = params.toString();
    return request(`/superadmin/users${qs ? `?${qs}` : ""}`, { method: "GET" });
  },

  // Assign a role (customer | admin | superadmin) to a user.
  setUserRole: (userId, role) =>
    request(`/superadmin/users/${userId}/role`, {
      method: "POST",
      body: JSON.stringify({ role }),
    }),

  // Suspend an admin/superadmin account (reason required).
  suspendAdmin: (userId, reason) =>
    request(`/superadmin/users/${userId}/suspend`, {
      method: "POST",
      body: JSON.stringify({ reason }),
    }),

  // Reactivate a suspended/locked admin/superadmin account.
  reactivateAdmin: (userId) =>
    request(`/superadmin/users/${userId}/reactivate`, {
      method: "POST",
    }),

  // Reveal a user's FULL NRIC (superadmin scope: any user; audited server-side).
  getSuperadminUserNric: (userId) =>
    request(`/superadmin/users/${userId}/nric`, {
      method: "GET",
    }),

  // Full audit log (superadmin scope): every event, including staff-to-staff
  // activity that the admin (customer-oversight) view withholds.
  getSuperadminAuditLogs: (page = 1, type = "", user = "") => {
    const params = new URLSearchParams({ page: String(page) });
    if (type) params.set("type", type);
    if (user) params.set("user", user);
    return request(`/superadmin/audit?${params.toString()}`, { method: "GET" });
  },
};