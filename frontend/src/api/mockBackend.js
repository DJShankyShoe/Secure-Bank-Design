// Utility to get CSRF token injected by Flask-WTF
const getCsrfToken = () => document.querySelector('meta[name="csrf-token"]')?.content;

// Utility to generate UUIDv4 for Idempotency
const generateUUID = () => crypto.randomUUID();

export const api = {
  // FR-01: Login & TOTP Verification
  login: async (username, password) => {
    console.log("Mock API: Sending credentials...");
    return new Promise((resolve) => setTimeout(() => resolve({ success: true, requireMfa: true }), 500));
  },
  verifyTotp: async (totpCode) => {
    console.log("Mock API: Verifying TOTP...");
    return new Promise((resolve) => setTimeout(() => resolve({ success: true, role: 'customer' }), 500));
  },

  // FR-03: View Account History (Paginated & Filterable)
  getHistory: async (filters, page = 1) => {
    console.log("Mock API: Fetching history with filters", filters);
    return new Promise((resolve) => setTimeout(() => resolve({ 
        records: [], // Map transaction data here
        totalPages: 5 
    }), 500));
  },

  // FR-06: Fund Transfer
  transferFunds: async (source, dest, amount, pin = null) => {
    const headers = {
      'X-CSRFToken': getCsrfToken(),
      'Idempotency-Key': generateUUID(), // Required for safe retries 
      'Content-Type': 'application/json'
    };
    console.log("Mock API: Transferring funds. Headers:", headers);
    return new Promise((resolve) => setTimeout(() => resolve({ success: true, receipt: "TXN-123" }), 500));
  },

  // FR-05: Close Account (Requires fresh TOTP) [cite: 148]
  closeAccount: async (accountId, totpCode) => {
    console.log(`Mock API: Closing account ${accountId} with step-up TOTP...`);
    return new Promise((resolve) => setTimeout(() => resolve({ success: true }), 500));
  }
};