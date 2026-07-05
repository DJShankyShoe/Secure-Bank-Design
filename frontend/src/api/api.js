const BASE_URL = "";

let csrfToken = null;

export function resetCsrf() {
  csrfToken = null;
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

    const error = new Error(errorMessage);
    error.status = response.status;
    error.data = data;
    throw error;
  }

  if (data.csrf_token) {
    csrfToken = data.csrf_token;
  }

  return data;
}

export const api = {

  // =========================
  // AUTH
  // =========================
  requestPasswordReset: (email) =>
    request("/auth/password/reset/request", {
      method: "POST",
      body: JSON.stringify({
        email,
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

  // Current authenticated user's profile (masked NRIC only, no secrets).
  me: () =>
    request("/auth/me", {
      method: "GET",
    }),

  requestEmailChange: (new_email, password) =>
    request("/auth/email", {
      method: "POST",
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

  requestUnlock: (email) =>
    request("/auth/unlock/request", {
      method: "POST",
      body: JSON.stringify({
        email,
      }),
    }),

  verifyUnlock: (token) =>
    request("/auth/unlock/verify", {
      method: "POST",
      body: JSON.stringify({
        token,
      }),
    }),

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

  getTransactions: (accountId, page = 1) =>
    request(`/accounts/${accountId}/transactions?page=${page}`, {
      method: "GET",
    }),

  closeAccount: (accountId, totp_code) =>
    request(`/accounts/${accountId}/close`, {
      method: "POST",
      body: JSON.stringify({
        totp_code,
      }),
    }),

    changePassword: (current_password, new_password) =>
    request("/auth/password/change", {
      method: "POST",
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

  setTransactionPin: (password, pin) =>
    request("/transactions/pin", {
      method: "POST",
      body: JSON.stringify({
        password,
        pin,
      }),
    }),

  getBillers: () =>
    request("/transactions/billers", {
      method: "GET",
    }),

  transfer: (
    source_account_number,
    destination_account_number,
    amount_cents,
    pin = null
  ) =>
    request("/transactions/transfer", {
      method: "POST",
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
};