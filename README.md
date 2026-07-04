# SecureBank Backend — API Reference

REST/JSON API for the SecureBank app. This document is for the frontend team.

## Conventions
- **Base URL:** same origin as the SPA (e.g. `https://securebank.space`). nginx proxies
  `/auth`, `/accounts`, `/transactions`, `/admin` to the backend.
- **Content type:** JSON in, JSON out. Send `Content-Type: application/json`.
- **Money:** always integer minor units (`amount_cents`, `balance_cents`). `1000` = SGD 10.00.
- **Timestamps:** ISO-8601 UTC. **IDs** are UUID strings; account numbers are 10-digit strings.

## Authentication & sessions
1. **Session cookie** `sb_session` — `Secure`, `HttpOnly`, `SameSite=Strict`. Set on a successful
   MFA login and sent automatically by the browser on same-origin requests (use
   `credentials: "include"` for fetch). It is HttpOnly — JS cannot read it.
2. **CSRF** — every **POST** is CSRF-protected; send the token in the **`X-CSRFToken`** header.
   > Fetch a token from **`GET /auth/csrf`** (returns `{ "csrf_token": "..." }` and sets the session
   > cookie), then send it as `X-CSRFToken` on every POST. Re-fetch if you get a `403`.
3. **Two-stage login:** password → MFA. Stage 1 returns a short-lived `mfa_token` (not a session);
   stage 2 verifies a TOTP/backup code and sets the session cookie.

## Error shape
```json
{ "error": "Plain-language message." }
```
| Status | Meaning |
|---|---|
| 400 | Validation error |
| 401 | Not authenticated / invalid credentials |
| 403 | CSRF failure or role denied (customer → admin) |
| 404 | Not found / not yours (IDOR-safe) |
| 409 | Idempotency-Key reused with a different body |
| 413 | Request body too large (> 1 MB) |
| 429 | Too many attempts (per-account TOTP / PIN / email-action limit) |
| 500 | Generic server error |

All responses carry `Cache-Control: no-store`.

Auth failures are intentionally generic (`"Invalid credentials."`).

---

## Endpoint index

**Auth column:** `Public` = no session · `Auth` = logged-in session cookie · `Admin` = admin role ·
`Token` = gated by an emailed one-time token (no session needed).

| Method · Path | Auth | Purpose |
|---|---|---|
| `GET /healthz` | Public | Liveness probe |
| `GET /auth/csrf` | Public | Get a CSRF token (call before any POST) |
| `POST /auth/register` | Public | Create a customer (→ `pending`); emails a verify link |
| `POST /auth/register/verify-totp` | Public | Confirm TOTP (→ `active` **iff email also verified**) |
| `POST /auth/register/verify-email` | Token | Confirm the signup email (→ `active` iff TOTP also confirmed) |
| `POST /auth/register/resend-email` | Public | Re-send the signup verification link |
| `POST /auth/register/totp-setup` | Public | Re-issue the TOTP QR (never finished setup) |
| `POST /auth/login` | Public | Stage 1: password → `mfa_token` |
| `POST /auth/login/mfa` | Public | Stage 2: TOTP/backup code → session cookie |
| `POST /auth/logout` | Auth | Revoke the session |
| `POST /auth/password/change` | Auth | Change password (current + new) |
| `POST /auth/email` | Auth | Request an email change (link to new address) |
| `POST /auth/email/verify` | Token | Confirm the new email |
| `POST /auth/unlock/request` | Public | Email an unlock link (locked account) |
| `POST /auth/unlock/verify` | Token | Consume an unlock link |
| `POST /auth/password/reset/request` | Public | Email a reset link (needs email **+ NRIC**) |
| `GET /auth/password/reset/check` | Public | Is a reset token still valid? (call on page load) |
| `POST /auth/password/reset/verify` | Token | Set a new password (token + TOTP) |
| `POST /accounts` | Auth | Request a new account (→ `open_requested`, needs admin approval) |
| `GET /accounts` | Auth | List own accounts |
| `GET /accounts/{id}` | Auth | View one account |
| `GET /accounts/{id}/transactions` | Auth | Paginated, filterable history |
| `GET /accounts/preferences` | Auth | View notification preferences |
| `PUT /accounts/preferences` | Auth | Update notification preferences |
| `POST /accounts/{id}/close` | Auth | Request closure (→ admin approval) |
| `POST /transactions/pin` | Auth | Set/replace the transaction PIN |
| `GET /transactions/pin` | Auth | Whether a PIN is set (`pin_set`) |
| `GET /transactions/billers` | Auth | List allowlisted billers |
| `POST /transactions/transfer` | Auth | Transfer funds (`Idempotency-Key`) |
| `POST /transactions/bill-payment` | Auth | Pay a biller (`Idempotency-Key`) |
| `GET /admin/users` | Admin | List/search users (`?q=`) |
| `GET /admin/users/{id}/accounts` | Admin | One user's accounts (drill-down) |
| `GET /admin/accounts` | Admin | List all accounts |
| `GET /admin/audit` | Admin | Read audit log (`?type=`, `?user=`) |
| `GET /admin/users/{id}/nric` | Admin | Reveal full NRIC (audited) |
| `POST /admin/users/{id}/suspend` | Admin | Suspend a user |
| `POST /admin/users/{id}/unlock` | Admin | Unlock/reactivate a user |
| `POST /admin/accounts/{id}/opening/approve` | Admin | Approve a new account opening |
| `POST /admin/accounts/{id}/opening/reject` | Admin | Reject a new account opening |
| `POST /admin/accounts/{id}/close` | Admin | Direct-close an account |
| `POST /admin/accounts/{id}/closure/approve` | Admin | Approve a customer close request |
| `POST /admin/accounts/{id}/closure/reject` | Admin | Reject a close request |
| `POST /admin/accounts/{id}/suspend` | Admin | Freeze one account |
| `POST /admin/accounts/{id}/unsuspend` | Admin | Lift an account freeze |

## Field validation (server-side allowlist — every field is checked before any logic)

| Field | Rule |
|---|---|
| `email` | RFC 5322, ≤ 254 chars, lowercased on write |
| `password` | 12–128 chars; must include upper + lower + digit + symbol |
| `nric` | Singapore NRIC (e.g. `S1234567D`); stored **encrypted**, shown **masked** |
| `full_name` | ≤ 120 chars |
| `account_type` | `savings` \| `current` |
| `amount_cents` | positive integer, ≤ 1 000 000 000 (SGD 10M); **≥ 100000 (SGD 1,000) needs the PIN** |
| `pin` | exactly 6 digits |
| `totp_code` / `code` | 6-digit TOTP (or a one-time backup code where noted) |
| `account_number` | 10 digits |
| `Idempotency-Key` header | UUIDv4 (transfer & bill-payment) |
| any body | > 1 MB → `413` |

---

## Auth — `/auth`

### `GET /auth/csrf`
Bootstrap a CSRF token for the SPA (call once before doing POSTs).
```jsonc
// 200
{ "csrf_token": "..." }   // send as the X-CSRFToken header on every POST
```

### `POST /auth/register`
Create a customer (status `pending`). Also **emails a verification link** to the address.
```jsonc
// body
{ "full_name": "Tan Ah Kow", "nric": "S1234567D", "email": "a@b.com", "password": "Str0ng!Passw0rd" }
// 201
{ "user_id": "uuid", "provisioning_uri": "otpauth://totp/...", "backup_codes": ["AB12CD34EF", "..."] }
```
Password policy: ≥12 chars, upper + lower + digit + symbol. Render the QR from `provisioning_uri`;
show `backup_codes` once. **The account is usable only after BOTH steps below** — confirm TOTP *and*
verify the emailed link (in either order).

### `POST /auth/register/verify-totp`  — confirm the authenticator
```jsonc
{ "email": "a@b.com", "code": "123456" }
// → 200 { "status": "active" }   // or "pending" if the email isn't verified yet
```

### `POST /auth/register/totp-setup`  — re-issue the authenticator QR
For a user who registered but closed the QR screen before scanning. Not logged in yet, so it takes
credentials:
```jsonc
{ "email": "a@b.com", "password": "..." }
// → 200 { "provisioning_uri": "otpauth://totp/..." }   // same seed as registration
```
Returns the URI **only** while the account is `pending` with TOTP not yet confirmed; otherwise a
generic `401` (the seed is never re-exposed once set up). Wrong passwords count toward lockout.

### `POST /auth/register/verify-email`  — confirm the signup email (from the emailed link)
```jsonc
{ "token": "..." }
// → 200 { "status": "active" }   // or "pending" if TOTP isn't confirmed yet
```
The link is `<FRONTEND_BASE_URL>/verify-signup?token=…` (24-h expiry). The SPA reads `token` from the
query string and POSTs it here.

### `POST /auth/login`  (stage 1)
```jsonc
{ "email": "a@b.com", "password": "..." }  // → 200 { "mfa_token": "..." }
```
`401 { "error": "Invalid credentials." }` for a bad email/password (generic, no enumeration).
**If the password is correct but the account isn't verified yet** (still `pending`), you get instead:
```jsonc
// 403
{ "status": "verification_required", "email_verified": false, "totp_confirmed": true }
```
Use the flags to prompt the missing step(s) — verify email (offer **`POST /auth/register/resend-email`**)
and/or confirm TOTP — then retry login.

### `POST /auth/register/resend-email`  — re-send the signup verification link
```jsonc
{ "email": "a@b.com" }                      // → 200 { "status": "verification_email_sent" }
```
Generic (no enumeration), rate-limited. Sends only if the account is pending with an unverified email.

### `POST /auth/login/mfa`  (stage 2 — TOTP or a backup code; sets the session cookie)
```jsonc
{ "mfa_token": "...", "code": "123456" }   // → 200 { "status": "ok" } + Set-Cookie
```

### `POST /auth/logout`
→ `200 { "status": "logged_out" }` (revokes session, clears cookie).

### `POST /auth/password/change`  *(auth required)* — change password while logged in
```jsonc
{ "current_password": "...", "new_password": "N3w!Str0ngPassw0rd" }
// → 200 { "status": "password_changed" }
```
Re-verifies the current password (`401` if wrong); new password must meet the FR-01 policy and differ
from the old (`400`). On success **all your *other* sessions are revoked** (this one stays signed in).

### `POST /auth/email`  *(auth required)* — request email change (30-min link to the new address)
```jsonc
{ "new_email": "new@b.com" }               // → 200 { "status": "verification_sent" }
```
Rate-limited to 10/hour per account → `429` when exceeded. Sends a **verification link to the new
address** (only that confirms the change) **and a security alert to the current/old address** (no
token) so the real owner is notified if a hijacked session tries to change the email.

### `POST /auth/email/verify`
```jsonc
{ "token": "..." }                          // → 200 { "status": "email_updated", "email": "new@b.com" }
```

### `POST /auth/unlock/request`  — for a locked-out account (emails a 30-min unlock link)
```jsonc
{ "email": "a@b.com" }                      // → 200 { "status": "unlock_requested" }
```

### `POST /auth/unlock/verify`
```jsonc
{ "token": "..." }                          // → 200 { "status": "unlocked" }
```

### `POST /auth/password/reset/request`  — forgot password (emails a 30-min single-use link)
Requires **both** email **and** NRIC — a link is sent only if they match an existing account.
```jsonc
{ "email": "a@b.com", "nric": "S1234567D" }  // → 200 { "status": "reset_requested" }
```
Always generic `200` (never reveals whether the email/NRIC matched). Rate-limited 10/hour per account.

### `GET /auth/password/reset/check?token=…`  — is the reset link still valid?
Call this when the `/reset-password` page loads, to show the form or an "expired link" message
before the user fills anything in. **Read-only** — it does not consume the token.
```jsonc
// → 200 { "valid": true }   // or false (bad/expired/already-used token)
```
Returns only a boolean (no account info); no CSRF/session needed.

### `POST /auth/password/reset/verify`  — set a new password from the emailed link
Identity (email + NRIC) was already proven at the **request** step, so here you supply the link's
`token`, the new password, and a **TOTP code (or a one-time backup code)** as a second factor.
```jsonc
{ "token": "...", "new_password": "N3w!Str0ngPassw0rd", "totp_code": "123456" }
// → 200 { "status": "password_reset" }
```
`new_password` must meet the FR-01 policy (≥12 chars, mixed case, digit, symbol) → else `400`;
`400` on a bad/expired/already-used token; `401` if `totp_code` is wrong; `429` on too many attempts.
On success **all existing sessions are revoked** and any lockout is cleared. The link is single-use.
(`totp_code` accepts a current TOTP or any unused backup code.)

> The reset email contains a **clickable link** (`<FRONTEND_BASE_URL>/reset-password?token=…`), not a
> raw token; the SPA reads `token` from the query string. The verify/unlock emails work the same way.

---

## Accounts — `/accounts`  *(all require auth)*

### `POST /accounts`  — **request** a new account (needs admin approval)
The account is created **frozen** (`open_requested`) and can't transact until an admin approves it.
```jsonc
{ "account_type": "savings" }               // or "current"
// 201
{ "account_id": "uuid", "account_number": "0123456789", "account_type": "savings",
  "balance_cents": 0, "status": "open_requested", "created_at": "..." }
```
An admin then approves (→ `active`) or rejects (→ `closed`) — see the admin endpoints.

### `GET /accounts`
→ `200 { "accounts": [ { account… }, … ] }`

### `GET /accounts/{account_id}`
→ `200 { account… }` · `404` if not yours.

### `GET /accounts/{account_id}/transactions`
Paginated history, 25/page. Query params (all optional): `page` (int ≥1), `type`
(`transfer`|`bill_payment`), `date_from` / `date_to` (`YYYY-MM-DD`, UTC, inclusive),
`amount_min` / `amount_max` (cents).
```jsonc
// 200
{ "items": [
    { "transaction_id": "uuid", "reference_number": "TXN…", "transaction_type": "transfer",
      "status": "complete", "amount_cents": 50000, "direction": "debit",
      "counterparty": "9876543210", "timestamp": "..." } ],
  "page": 1, "page_size": 25, "total": 42, "total_pages": 2 }
```
`direction` = `debit` (out) / `credit` (in); `counterparty` = other account number, external ref,
or biller name.

### `GET /accounts/preferences` · `PUT /accounts/preferences`  — notification settings
```jsonc
// GET → 200
{ "notify_on_transfer": true, "notify_on_login": true }
// PUT body (both optional; partial update) → 200 with the updated prefs
{ "notify_on_transfer": false }             // non-boolean value → 400
```
`notify_on_transfer` gates transfer + bill-payment receipt emails; `notify_on_login` gates the
"new sign-in" email. Both default to `true`.

### `POST /accounts/{account_id}/close`  — **request** closure (zero balance + fresh TOTP)
This does **not** close the account immediately — it submits a request an admin must approve.
```jsonc
{ "totp_code": "123456" }
// → 200 { account… "status": "close_requested" } · 400 if balance≠0 · 401 bad code
```
While `close_requested` the account is **frozen** (no transfers in/out) until an admin approves
(→ `closed`) or rejects (→ `active`).

---

## Transactions — `/transactions`  *(all require auth)*

### `POST /transactions/pin`  — set/replace the 6-digit transaction PIN (re-verifies password)
```jsonc
{ "password": "...", "pin": "135790" }      // → 200 { "status": "pin_set" }
```

### `GET /transactions/pin`  — has the user set a transaction PIN yet?
```jsonc
// → 200 { "pin_set": true }   // or false
```
Boolean only (never the PIN/hash). Use it to prompt for PIN setup, or to decide whether to show the
PIN field on a high-value (≥ SGD 1,000) transfer.

### `GET /transactions/billers`
→ `200 { "billers": [ { "biller_id": "uuid", "biller_name": "Singtel", "biller_category": "telco" } ] }`

### `POST /transactions/transfer`
**Header:** `Idempotency-Key: <UUIDv4>` (required; reuse the same key to safely retry).
Destination = `destination_account_number` (internal) **or** `destination_external_ref` (external).
**PIN required when `amount_cents` ≥ 100000 (SGD 1,000).**
```jsonc
{ "source_account_number": "0123456789", "destination_account_number": "9876543210",
  "amount_cents": 50000, "pin": "135790" }   // pin only for ≥ SGD 1,000
// 201
{ "transaction_id": "uuid", "reference_number": "TXN…", "status": "complete",
  "transaction_type": "transfer", "amount_cents": 50000,
  "source_account_number": "0123456789", "destination_account_number": "9876543210",
  "destination_external_ref": null, "pin_verified": false, "completed_at": "..." }
```
`403` PIN required but missing · `401` wrong PIN · `400` insufficient funds · `409` key reused with
a different body.

### `POST /transactions/bill-payment`
**Header:** `Idempotency-Key: <UUIDv4>`.
```jsonc
{ "source_account_number": "0123456789", "biller_id": "uuid", "amount_cents": 30000 }
// 201
{ "transaction_id": "uuid", "reference_number": "TXN…", "status": "complete",
  "transaction_type": "bill_payment", "amount_cents": 30000,
  "source_account_number": "0123456789", "biller_id": "uuid", "biller_name": "Singtel",
  "completed_at": "..." }
```

---

## Admin — `/admin`  *(require admin role; customer → 403)*

| Method · Path | Body | Returns |
|---|---|---|
| `GET /admin/users?q=` | — | `{ "users": [ {user_id,email,full_name,nric_masked,role,account_status,created_at} ] }` — optional `q` = case-insensitive search on email or name |
| `GET /admin/accounts` | — | `{ "accounts": [ {account_id,user_id,account_number,account_type,balance_cents,status} ] }` |
| `GET /admin/users/{id}/accounts` | — | `{ "accounts": [ {account_id,account_number,account_type,balance_cents,status} ] }` — one user's accounts (directory drill-down) |
| `GET /admin/audit?page=&type=&user=` | — | `{ "items": [ {event_id,event_timestamp,event_type,actor_user_id,actor_role,target_user_id,source_ip,outcome,action_detail} ], "page":1, "page_size":50 }` — `type`=event type; `user`=UUID (events where the user is actor **or** target; `400` if not a UUID); filters compose |
| `POST /admin/users/{id}/suspend` | `{ "reason": "..." }` | `{ "status": "suspended" }` (reason required) |
| `POST /admin/users/{id}/unlock` | — | `{ "status": "active" }` |
| `GET /admin/users/{id}/nric` | — | `{ "user_id": "…", "nric": "S1234567D", "nric_masked": "S****567D" }` (audited) |
| `POST /admin/accounts/{id}/opening/approve` | — | `{ "account_id": "…", "status": "active" }` (approve a new `open_requested` account; 404 if not pending) |
| `POST /admin/accounts/{id}/opening/reject` | `{ "reason": "..." }` | `{ "account_id": "…", "status": "closed" }` (reject the opening; reason required) |
| `POST /admin/accounts/{id}/close` | `{ "reason": "..." }` | `{ "account_id": "…", "status": "closed" }` (direct admin close; balance must be 0) |
| `POST /admin/accounts/{id}/closure/approve` | — | `{ "account_id": "…", "status": "closed" }` (approve a customer `close_requested`; 404 if none pending; 400 if balance≠0) |
| `POST /admin/accounts/{id}/closure/reject` | `{ "reason": "..." }` | `{ "account_id": "…", "status": "active" }` (reject → reactivate; reason required) |
| `POST /admin/accounts/{id}/suspend` | `{ "reason": "..." }` | `{ "account_id": "…", "status": "suspended" }` (reversible freeze of one account; reason required; only from `active`) |
| `POST /admin/accounts/{id}/unsuspend` | — | `{ "account_id": "…", "status": "active" }` (lift the freeze; only from `suspended`) |

---

## Infra
- `GET /healthz` → `200 { "status": "ok" }` (no auth; liveness probe).

## Typical happy path
`register` → `register/verify-totp` → `login` → `login/mfa` (cookie set) → `POST /accounts` →
`GET /accounts` → (set PIN) → `POST /transactions/transfer` → `GET /accounts/{id}/transactions`.


#
# SecureBank Frontend - UI

A premium, secure retail internet banking portal. This repository contains the frontend built to interface with the SecureBank Flask backend. 

The UI is designed with a focus on layered controls, high-contrast accessible design (WCAG 2.1 AA compliant), and a seamless customer experience.

## Tech Stack
* **Framework:** React.js (v18+)
* **Build Tool:** Vite (for rapid HMR and optimized production builds)
* **Routing:** React Router DOM (v6)
* **Styling:** CSS

## Key Features
* **Multi-Factor Authentication:** Two-step login flow supporting NRIC/User ID, password, and 6-digit TOTP validation.
* **Account Recovery:** Secure password reset flows requiring TOTP confirmation.
* **Role-Based Access Control (RBAC):** Protected routing distinguishing between `customer` and `admin` views.
* **Secure Transactions:** Fund transfers and bill payments with dynamic step-up authentication (6-digit PIN required for transfers $\ge$ SGD 1,000).
* **Account Management:** Open new accounts, update contact preferences, and securely close accounts.
* **Audit & History:** Filterable, paginated transaction history and an administrative operations dashboard.

---

## 🚀 Local Development Setup

Follow these steps to run the frontend application locally on your machine.

### Prerequisites
* [Node.js](https://nodejs.org/) (Version 18 or higher recommended)
* npm (comes pre-installed with Node.js)

### 1. Install Dependencies
Navigate to the root of the frontend directory and install the required packages.
```bash
npm install
```
(Note: If you encounter Vite peer-dependency version conflicts, you can safely run npm install --legacy-peer-deps)

### 2. Development Server
Launch the Vite development server
```bash
npm run dev
```
The application will be available at http://localhost:5173. Any changes saved to the .jsx or .css files will automatically update in the browser.

---
## Project Structure
The codebase is modularized to strictly separate routing, layout, and domain-specific pages.
```
/ (Project Root)
├── src/
│   ├── components/
│   │   ├── Layout.jsx              # Customer Portal navigation shell (sidebar/header)
│   │   └── AdminLayout.jsx         # Admin Staff navigation shell
│   │
│   ├── pages/
│   │   ├── Auth/
│   │   │   ├── Login.jsx                 
│   │   │   ├── Register.jsx              
│   │   │   ├── RegisterTotpSetup.jsx     # Authenticator setup page
│   │   │   ├── ForgotPassword.jsx        
│   │   │   ├── ResetPassword.jsx         
│   │   │   ├── SetupPin.jsx              
│   │   │   └── VerifyEmail.jsx           
│   │   │
│   │   ├── Dashboard/
│   │   │   ├── Overview.jsx              # Customer main dashboard (balances, cards)
│   │   │   └── History.jsx               # Filterable transaction history
│   │   │
│   │   ├── Transactions/
│   │   │   ├── Transfer.jsx              # Evaluates amounts >= $1,000 to trigger PIN confirmation
│   │   │   └── PayBill.jsx               # Instant bill payment to registered billers
│   │   │
│   │   ├── Accounts/
│   │   │   └── Manage.jsx                # Open new accounts OR close existing ones
│   │   │
│   │   ├── Settings/
│   │   │   └── Settings.jsx              # Consolidated: Update Email, Password, and UI notification toggles
│   │   │
│   │   └── Admin/
│   │       ├── Users.jsx                 # User directory, NRIC reveal, account lock/suspend toggles
│   │       ├── Openings.jsx              # Approve/Reject new account requests
│   │       ├── Closures.jsx              # Approve/Reject account deletion requests
│   │       └── Audit.jsx                 # System logs and security events
│   │
│   ├── App.jsx                     # Global Auth State & "Traffic Cop" Protected Routing
│   ├── index.css                   # Global CSS (Theme colors, grid layouts, component classes)
│   └── main.jsx                    # React DOM entry point
│
├── index.html                      # Primary HTML template
├── package.json                    # Project dependencies and run scripts (npm run dev / build)
├── package-lock.json               # Dependency version lockfile
└── vite.config.js                  # Vite bundler configuration
```
---

## Security Implementation Notes
* **Input Validation:** Financial input fields use strict Regex (e.g., /^\d*\.?\d{0,2}$/) and inputMode="decimal" to prevent invalid data types or malformed floating-point numbers from entering the component state.
* **XSS Prevention:** React JSX inherently auto-escapes all string inputs. dangerouslySetInnerHTML is strictly prohibited across the codebase.
* **Masking:** Authenticator code inputs strip all non-numeric characters instantly to prevent injection or formatting errors.

---


## Before integrating
1. **CSRF flow:** call `GET /auth/csrf` once, then send the returned token as `X-CSRFToken` on every POST.
2. Deploy **same-origin** (one domain via nginx) so the `SameSite=Strict` cookie + CSRF work — don't
   split the API onto a different subdomain.
