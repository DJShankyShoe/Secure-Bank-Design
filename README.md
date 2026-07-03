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

## Auth — `/auth`

### `GET /auth/csrf`
Bootstrap a CSRF token for the SPA (call once before doing POSTs).
```jsonc
// 200
{ "csrf_token": "..." }   // send as the X-CSRFToken header on every POST
```

### `POST /auth/register`
Create a customer (status `pending` until TOTP confirmed).
```jsonc
// body
{ "full_name": "Tan Ah Kow", "nric": "S1234567D", "email": "a@b.com", "password": "Str0ng!Passw0rd" }
// 201
{ "user_id": "uuid", "provisioning_uri": "otpauth://totp/...", "backup_codes": ["AB12CD34EF", "..."] }
```
Password policy: ≥12 chars, upper + lower + digit + symbol. Render the QR from `provisioning_uri`;
show `backup_codes` once.

### `POST /auth/register/verify-totp`
```jsonc
{ "email": "a@b.com", "code": "123456" }   // → 200 { "status": "active" }
```

### `POST /auth/login`  (stage 1)
```jsonc
{ "email": "a@b.com", "password": "..." }  // → 200 { "mfa_token": "..." }
```

### `POST /auth/login/mfa`  (stage 2 — TOTP or a backup code; sets the session cookie)
```jsonc
{ "mfa_token": "...", "code": "123456" }   // → 200 { "status": "ok" } + Set-Cookie
```

### `POST /auth/logout`
→ `200 { "status": "logged_out" }` (revokes session, clears cookie).

### `POST /auth/email`  *(auth required)* — request email change (30-min link to the new address)
```jsonc
{ "new_email": "new@b.com" }               // → 200 { "status": "verification_sent" }
```
Rate-limited to 3/hour per account → `429` when exceeded. Sends a **verification link to the new
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
```jsonc
{ "email": "a@b.com" }                      // → 200 { "status": "reset_requested" }
```
Always generic (never reveals whether the email exists). Rate-limited 3/hour per account.

### `POST /auth/password/reset/verify`  — set a new password from the emailed link
Requires **two extra factors** on top of the link — the account's **NRIC** and a **TOTP code (or a
one-time backup code)** — so inbox access alone can't reset the password.
```jsonc
{ "token": "...", "new_password": "N3w!Str0ngPassw0rd", "nric": "S1234567D", "totp_code": "123456" }
// → 200 { "status": "password_reset" }
```
`new_password` must meet the FR-01 policy (≥12 chars, mixed case, digit, symbol) → else `400`;
`400` on a bad/expired/already-used token or malformed NRIC; `401` if the NRIC or `totp_code` is
wrong (same generic error for either); `429` on too many attempts. On success **all existing
sessions are revoked** and any lockout is cleared. The link is single-use. (`totp_code` accepts a
current TOTP or any unused backup code.)

> The reset email contains a **clickable link** (`<FRONTEND_BASE_URL>/reset-password?token=…`), not a
> raw token; the SPA reads `token` from the query string. The verify/unlock emails work the same way.

---

## Accounts — `/accounts`  *(all require auth)*

### `POST /accounts`
```jsonc
{ "account_type": "savings" }               // or "current"
// 201
{ "account_id": "uuid", "account_number": "0123456789", "account_type": "savings",
  "balance_cents": 0, "status": "active", "created_at": "..." }
```

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
| `GET /admin/users` | — | `{ "users": [ {user_id,email,full_name,nric_masked,role,account_status,created_at} ] }` |
| `GET /admin/accounts` | — | `{ "accounts": [ {account_id,user_id,account_number,account_type,balance_cents,status} ] }` |
| `GET /admin/audit?page=&type=&user=` | — | `{ "items": [ {event_id,event_timestamp,event_type,actor_user_id,actor_role,target_user_id,source_ip,outcome,action_detail} ], "page":1, "page_size":50 }` — `type`=event type; `user`=UUID (events where the user is actor **or** target; `400` if not a UUID); filters compose |
| `POST /admin/users/{id}/suspend` | `{ "reason": "..." }` | `{ "status": "suspended" }` (reason required) |
| `POST /admin/users/{id}/unlock` | — | `{ "status": "active" }` |
| `GET /admin/users/{id}/nric` | — | `{ "user_id": "…", "nric": "S1234567D", "nric_masked": "S****567D" }` (audited) |
| `POST /admin/accounts/{id}/close` | `{ "reason": "..." }` | `{ "account_id": "…", "status": "closed" }` (direct admin close; balance must be 0) |
| `POST /admin/accounts/{id}/closure/approve` | — | `{ "account_id": "…", "status": "closed" }` (approve a customer `close_requested`; 404 if none pending; 400 if balance≠0) |
| `POST /admin/accounts/{id}/closure/reject` | `{ "reason": "..." }` | `{ "account_id": "…", "status": "active" }` (reject → reactivate; reason required) |

---

## Infra
- `GET /healthz` → `200 { "status": "ok" }` (no auth; liveness probe).

## Typical happy path
`register` → `register/verify-totp` → `login` → `login/mfa` (cookie set) → `POST /accounts` →
`GET /accounts` → (set PIN) → `POST /transactions/transfer` → `GET /accounts/{id}/transactions`.

## Before integrating
1. **CSRF flow:** call `GET /auth/csrf` once, then send the returned token as `X-CSRFToken` on every POST.
2. Deploy **same-origin** (one domain via nginx) so the `SameSite=Strict` cookie + CSRF work — don't
   split the API onto a different subdomain.
