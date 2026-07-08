# SecureBank

> Secure retail internet-banking web app (Singapore). A **React + Vite** single-page
> frontend and a **Flask + PostgreSQL 16** backend, fronted by **nginx + Cloudflare**, built
> **defence-in-depth** so that the failure of any single control does not cause compromise.

This is a **monorepo**: the API (`backend/`), the SPA (`frontend/`), the reverse-proxy config
(`nginx/`), and the CI/CD security pipeline (`.github/`) live together so a reviewer can trace a
request from the browser all the way to the database in a single checkout.

---

## Contents
- [1. Overview](#1-overview)
- [2. Architecture at a glance](#2-architecture-at-a-glance)
- [3. Repository layout](#3-repository-layout)  ← **start here for a code review**
- [4. How the code is organized for review](#4-how-the-code-is-organized-for-review)
- [5. Security control → source map](#5-security-control--source-map)
- [6. Reviewer quickstart](#6-reviewer-quickstart)
- [7. Local development](#7-local-development)
- [8. CI/CD & security scanning](#8-cicd--security-scanning)
- [9. Backend API reference](#9-backend-api-reference)
- [10. Frontend implementation notes](#10-frontend-implementation-notes)
- [11. Before integrating](#11-before-integrating)

---

## 1. Overview

Registered customers open accounts, transfer funds, pay registered billers, and review transaction
history through a browser; admin staff perform oversight under role-based access control. **Security
is the product** — every endpoint enforces its controls **server-side**, and the codebase is laid out
so each control can be reviewed in one place.

| Tier | Technology |
|---|---|
| **Frontend** | React 19 + React Router v7, built with **Vite**; plain CSS |
| **Backend** | **Python 3.12**, Flask, SQLAlchemy ORM |
| **Database** | **PostgreSQL 16** — three schemas, three least-privilege roles |
| **Security libs** | argon2-cffi (Argon2id), cryptography (AES-256-GCM), pyotp (TOTP), Flask-WTF (CSRF), Flask-Talisman (headers) |
| **Edge** | nginx reverse proxy + Cloudflare (TLS, per-IP rate limiting, WAF) |
| **CI/CD** | GitHub Actions (10 workflow files): pytest · flake8 · Bandit · Playwright E2E · Semgrep · OWASP Dependency-Check · Gitleaks · OWASP ZAP · Dependabot; separate production + test deploy targets |

**Feature set:** MFA login (password → TOTP), in-house server-side sessions, admin-approved account
open/close flows, fund transfer with a **PIN step-up for ≥ SGD 1,000**, bill payment to allowlisted
billers, admin oversight with a full audit log, self-service recovery (forgot-password, email
change — a lockout itself only auto-expires or needs an admin), and a customer notification bell —
all audited.

---

## 2. Architecture at a glance

Layered tiers, each independently enforcing controls:

```
Browser (React SPA)
   │  HTTPS · same-origin · Secure+HttpOnly+SameSite=Strict cookie · X-CSRFToken header
   ▼
Cloudflare ──► nginx     TLS termination · per-IP rate limits · ~1 MB body cap · serves the built SPA
   │            proxies /auth /accounts /transactions /admin · forwards the real client IP
   ▼
Flask app (gunicorn · stateless · 1..N instances)
   │  Security gateway runs BEFORE every protected handler, in order:
   │    1 session validation → 2 CSRF → 3 role check → 4 input allowlist → 5 resource ownership
   ▼
SQLAlchemy     parameterised ORM only · 5-second statement timeout
   ▼
PostgreSQL 16 — three schemas reached by three roles:
     application (app_user)   session (app_user)   audit (audit_writer=INSERT-only / admin_reader=SELECT-only)
```

Flask-Talisman adds security headers (HSTS, CSP, `nosniff`, frame-deny, referrer-policy) to **every**
response. All shared state (sessions, idempotency records, attempt counters) lives in PostgreSQL, so
app instances stay **stateless and horizontally scalable**.

---

## 3. Repository layout

Annotated tree of the whole monorepo. Generated/vendored directories (`node_modules/`,
`frontend/dist/`, `__pycache__/`) are omitted. **This is the fastest way to orient a review** — every
top-level area is single-purpose.

```
SecureBank/
├── backend/                          # Flask REST API (Python 3.12) — the security core
│   ├── app/
│   │   ├── __init__.py               # create_app() factory: ProxyFix → 3 DB engines → Talisman → CSRF → blueprints
│   │   ├── config.py                 # env-driven config; FAILS FAST if a required secret is missing (SR-07)
│   │   ├── extensions.py             # SQLAlchemy engines/binds (app / session / audit), CSRFProtect, Talisman
│   │   │
│   │   ├── blueprints/               # one folder per feature; routes.py = HTTP surface, service.py = domain logic
│   │   │   ├── auth/                  # registration, 2-stage login+MFA, PIN, brute-force lockout, reset, email change
│   │   │   │   ├── routes.py          #   HTTP endpoints + which decorators guard each
│   │   │   │   ├── service.py         #   registration, credentials, NRIC blind-index uniqueness, PIN set
│   │   │   │   ├── login_service.py   #   password→MFA flow + signed token serializers (MFA/reset/signup-email)
│   │   │   │   └── email_service.py   #   email-change request/verify flow
│   │   │   ├── accounts/              # open-request/approve, view, paginated history, close-request
│   │   │   ├── transactions/          # transfer (atomic + PIN step-up), bill payment, PIN mgmt, idempotency
│   │   │   ├── admin/                 # RBAC oversight (customer-scoped): users/accounts, approvals, NRIC reveal, audit read
│   │   │   ├── superadmin/            # role assignment + admin/staff management; full-scope audit read
│   │   │   └── notifications/         # customer notification bell — list, mark read/read-all (FR-10)
│   │   │
│   │   ├── models/                   # SQLAlchemy models, SPLIT BY SCHEMA (mirrors the DB privilege boundary)
│   │   │   ├── base.py               #   declarative base / shared column mixins
│   │   │   ├── application.py        #   users, accounts, transactions, billers, contact_preferences, ...
│   │   │   ├── session.py            #   sessions, idempotency_records, auth_attempts
│   │   │   └── audit.py              #   audit_events (append-only)
│   │   │
│   │   ├── security/                 # ★ REVIEWER FOCUS — every reusable security primitive lives here
│   │   │   ├── decorators.py         #   @require_authenticated / @require_role / CSRF / ownership pipeline (SR-05/06/13)
│   │   │   ├── crypto.py             #   Argon2id (password + distinct PIN params), AES-256-GCM, NRIC blind index (SR-01/03/12)
│   │   │   ├── sessions.py           #   server-side session create/validate/rotate/revoke — 15-min idle / 8-h absolute (SR-13)
│   │   │   ├── mfa.py                #   TOTP verify + single-use replay guard, backup codes (SR-11)
│   │   │   ├── lockout.py            #   per-account lockout + TOTP/PIN attempt windows, DB-backed (SR-09/11/12)
│   │   │   ├── validation.py         #   allowlist validators: email, NRIC, amount, string caps (SR-06)
│   │   │   └── masking.py            #   NRIC masking, e.g. S****567D (SR-03)
│   │   │
│   │   ├── services/                 # cross-cutting business services
│   │   │   ├── audit.py              #   structured audit emitter — audit_writer engine, own connection (SR-14)
│   │   │   ├── email.py              #   smtplib sender (async dispatch) + renders templates/email/*
│   │   │   ├── idempotency.py        #   Idempotency-Key lookup/store — replay-safe transfers/payments (SR-08)
│   │   │   └── cleanup.py            #   TTL cleanup of expired sessions / idempotency rows (`flask cleanup`)
│   │   │
│   │   └── templates/email/          # auto-escaped Jinja2 email bodies (receipts, verify, reset, alerts)
│   │
│   ├── sql/                          # PostgreSQL DDL — numbered = apply in order
│   │   ├── 01_schemas_roles.sql      #   the 3 schemas + 3 roles
│   │   ├── 02_application.sql        #   application tables
│   │   ├── 03_session.sql            #   session tables
│   │   ├── 04_audit.sql              #   audit table
│   │   ├── 05_grants.sql             #   ★ least-privilege GRANT/REVOKE (audit_writer = INSERT only)
│   │   └── 06_seed_billers.sql       #   allowlisted biller catalogue
│   │
│   ├── tests/                        # pytest suite — ONE FILE PER MODULE/FEATURE (mirrors app/)
│   ├── scripts/                      # run.sh (build/run gunicorn containers) · setup_production.sh (.env + DB)
│   ├── Dockerfile                    # production image: gunicorn, host networking, secrets injected at runtime
│   ├── requirements.txt              # pinned runtime deps (scanned by OWASP Dependency-Check)
│   ├── requirements-dev.txt          # test / lint / SAST tooling
│   ├── pytest.ini                    # pytest config
│   └── setup.cfg                     # flake8 (PEP 8) config — 100-char lines
│
├── frontend/                         # React + Vite single-page app
│   ├── src/
│   │   ├── main.jsx                  # React DOM entry point
│   │   ├── App.jsx                   # global auth state + protected routing ("traffic cop") + <NotificationHost/>
│   │   ├── api/api.js                # single API client: CSRF bootstrap, 401/session handling, every endpoint
│   │   ├── components/               # Layout.jsx + AdminLayout.jsx (nav shells) · SessionTimer.jsx (idle countdown)
│   │   │                             #   · NotificationBell.jsx (header bell, FR-10)
│   │   ├── ui/notify.jsx             # in-app toast + confirm/prompt modal kit (replaces browser alert/confirm/prompt)
│   │   ├── pages/                    # one folder per domain area
│   │   │   ├── Auth/                 #   Login, Register, RegisterTotpSetup, ForgotPassword, ResetPassword, SetupPin, VerifyEmail
│   │   │   ├── Dashboard/            #   Overview (balances) · History (filterable transactions)
│   │   │   ├── Transactions/         #   Transfer (PIN step-up ≥ SGD 1,000) · PayBill
│   │   │   ├── Accounts/             #   Manage (open / close)
│   │   │   ├── Settings/             #   Settings (email, password, notification toggles)
│   │   │   └── Admin/                #   Users, Openings, Closures, Audit
│   │   └── styles.css                # global theme + component styles
│   └── e2e/                          # Playwright E2E suite — real backend+frontend+Mailpit, no mocking (§7/§8)
│       ├── global-setup.js           #   runs once: bootstraps the first-ever account as superadmin (FR-08)
│       ├── fixtures/                 #   totp.js (code gen) · mailbox.js (Mailpit client) · db.js (test-only funding)
│       │                             #   · helpers.js (registration/login/admin-setup flows every spec reuses)
│       └── specs/                    #   one file per FR: registration, login, accounts, dashboard, settings,
│                                      #   transfer, bill-payment, password-reset, notifications, admin/superadmin RBAC
│
├── nginx/nginx.conf                  # reverse proxy: per-IP rate limits, body caps, forwards real client IP (infra)
├── docker-compose.yml                # nginx service — serves frontend/dist + proxies to the backend
├── .github/
│   ├── workflows/
│   │   ├── ci.yml                    # orchestrator only — wires every job below via needs: + reusable-workflow uses:
│   │   ├── frontend-build.yml        #   npm ci · vite build · npm audit
│   │   ├── backend-tests.yml         #   flake8 · Bandit · pytest, against a throwaway PostgreSQL service
│   │   ├── dependency-check.yml      #   OWASP Dependency-Check — SCA on the pinned requirements.txt
│   │   ├── sast-semgrep.yml          #   Semgrep — OWASP Top Ten + Python + JavaScript rulesets (BLOCKING)
│   │   ├── secret-scan-gitleaks.yml  #   Gitleaks — full git-history secret scan (BLOCKING)
│   │   ├── dast-zap.yml              #   OWASP ZAP baseline — boots the app, scans it running (BLOCKING)
│   │   ├── e2e-playwright.yml        #   Playwright E2E — live backend+frontend+Mailpit, every FR (BLOCKING)
│   │   ├── deploy-production.yml     #   SSH deploy to production EC2 — gated on the production branch
│   │   └── deploy-test.yml           #   SSH deploy to a separate test EC2 host — gated on integration-test
│   └── dependabot.yml                # weekly, grouped dependency-update PRs (pip/npm/github-actions), 7-day cooldown
├── .gitleaks.toml                    # secret-scan allowlist (non-secret token salts + CI-only dummy creds)
└── README.md                         # this file
```

---

## 4. How the code is organized for review

The layout is deliberate — these are the conventions a reviewer can rely on:

- **App-factory + blueprints.** `create_app()` (`backend/app/__init__.py`) wires the extensions once;
  each **blueprint is a self-contained feature** (`auth`, `accounts`, `transactions`, `admin`). To
  review a feature, read its folder top-to-bottom.
- **`routes.py` vs `service.py`.** `routes.py` is the thin HTTP surface — it declares which security
  decorators guard the endpoint, validates input, calls the service, and shapes the response/status.
  `service.py` holds the **business + security logic** (hashing, TOTP, atomic money movement, audit
  emission). **No security decision ever lives in a template or in the frontend.**
- **Security primitives are centralised in `app/security/`.** Crypto, sessions, decorators,
  validation, lockout, masking and MFA each live in one file, so you audit a control **once** and can
  find **every** call site from there.
- **Models mirror the database privilege boundary.** `models/` is split `application` / `session` /
  `audit`, exactly matching the three schemas and three roles. The audit table is **append-only** and
  is only ever written through the `audit_writer` engine.
- **DDL is explicit and ordered.** `sql/01…06` apply in sequence; **`05_grants.sql` is where least
  privilege is enforced at the database** (e.g. `audit_writer` gets `INSERT` and nothing else).
- **Tests mirror the modules.** `tests/test_<area>.py` maps 1:1 to the app modules, and the
  security-control cases (lockout, IDOR → 404, CSRF → 403, idempotency replay, atomic rollback, audit
  emission) sit right beside the happy-path tests. `frontend/e2e/specs/` mirrors the FRs the same
  way — one spec file per feature area, driving the real backend + frontend + Mailpit end-to-end.
- **Requirement traceability.** Controls carry their **FR-xx / SR-xx** IDs in comments, so any finding
  maps straight back to the requirement it implements.

**Reading one request end-to-end** (a high-value transfer):

```
frontend/src/pages/Transactions/Transfer.jsx
  → frontend/src/api/api.js            (attaches Idempotency-Key + X-CSRFToken)
    → nginx (rate-limit, forward client IP)
      → backend/app/blueprints/transactions/routes.py   (decorators: auth → CSRF → role → validation → ownership)
        → transactions/service.py       (PIN verify via security/crypto.py + lockout.py;
                                          atomic debit/credit with SELECT ... FOR UPDATE;
                                          replay-guard via services/idempotency.py)
          → services/audit.py           (writes the audit event, independent of the business txn)
          → services/email.py           (emails the receipt, honouring contact_preferences)
```

---

## 5. Security control → source map

Each Security Requirement maps to concrete, reviewable code:

| Control | Req. | Where to review |
|---|---|---|
| Password + PIN hashing (Argon2id, distinct params) | SR-01, SR-12 | `app/security/crypto.py` |
| TLS/HSTS headers + proxy awareness | SR-02 | `app/__init__.py` (Talisman, ProxyFix) |
| NRIC / TOTP-seed encryption (AES-256-GCM) + masking | SR-03 | `app/security/crypto.py`, `app/security/masking.py` |
| Injection / XSS (parameterised ORM + CSP) | SR-04 | all DB access via `models/*`; CSP in `app/__init__.py` |
| CSRF tokens on state-changing methods | SR-05 | `app/extensions.py` (CSRFProtect), `app/security/decorators.py` |
| Input allowlist validation | SR-06 | `app/security/validation.py` |
| Secrets from env (fail-fast) + pinned deps | SR-07 | `app/config.py`, `requirements*.txt`, `.gitleaks.toml` |
| Idempotency / replay protection | SR-08 | `app/services/idempotency.py`, `transactions/service.py` |
| Brute-force lockout + generic errors | SR-09 | `app/security/lockout.py`, `blueprints/auth/*` |
| Rate limiting + query timeout | SR-10 | `nginx/nginx.conf` (per-IP), `app/extensions.py` (statement timeout) |
| MFA (TOTP + one-time backup codes) | SR-11 | `app/security/mfa.py`, `blueprints/auth/login_service.py` |
| Transaction-PIN step-up (≥ SGD 1,000) | SR-12 | `blueprints/transactions/service.py`, `app/security/crypto.py` |
| Server-side session management | SR-13 | `app/security/sessions.py`, `app/security/decorators.py` |
| Append-only audit logging | SR-14 | `app/services/audit.py`, `models/audit.py`, `sql/05_grants.sql` |

Feature areas (FR) map to the matching blueprint + page folder: **auth/recovery** → `blueprints/auth`
+ `pages/Auth`, **accounts** → `blueprints/accounts` + `pages/Accounts`, **transfer/bill-pay** →
`blueprints/transactions` + `pages/Transactions`, **admin/RBAC** → `blueprints/admin` +
`blueprints/superadmin` + `pages/Admin`, **notification bell** → `blueprints/notifications`
(rendered via the header's bell icon in `components/`, not its own page folder).

---

## 6. Reviewer quickstart

Run the same checks CI runs, locally.

**Backend — tests, lint, SAST** (needs a local PostgreSQL with the schemas/roles from `sql/01…06`;
`scripts/setup_production.sh` provisions one):
```bash
cd backend
python -m venv .venv && source .venv/bin/activate
pip install -r requirements-dev.txt
flake8 .            # PEP 8 (config in setup.cfg)
bandit -r app       # SAST — no high/medium expected
pytest              # full suite: happy-path + security-control cases
```

**Frontend — build + dependency audit:**
```bash
cd frontend
npm install
npm run build       # production build must succeed with 0 errors
npm audit           # dependency SCA
```

**End-to-end tests** — the full Playwright suite (`frontend/e2e/`) needs a live backend, frontend,
and Mailpit, so it's not a quick one-liner; see §7 for the local setup and §8 for the CI job.

**Full security scanners** (Semgrep, Gitleaks, OWASP Dependency-Check, ZAP) run in CI — see the next
two sections for what they cover and how to reproduce them.

---

## 7. Local development

**Backend.** Configuration is entirely env-driven and the app **fails to start if a required variable
is missing**. The key variables: `FLASK_SECRET_KEY`, `AES_ENCRYPTION_KEY` (base64 of a 32-byte key),
`DATABASE_URL_APP`, `DATABASE_URL_AUDIT_WRITER`, `DATABASE_URL_ADMIN_READER`, the `SMTP_*` group,
`TOTP_ISSUER`, and `FRONTEND_BASE_URL`. Apply the DDL (`sql/01…06`) to a PostgreSQL 16 instance, then
run the app (see `backend/scripts/setup_production.sh` and `backend/scripts/run.sh`). The production
image (`backend/Dockerfile`) runs gunicorn with **host networking**, so secrets are passed at runtime
(`--env-file`) and never baked into the image.

**Frontend.**
```bash
cd frontend
npm install         # add --legacy-peer-deps if you hit a Vite peer-dep conflict
npm run dev         # Vite dev server on http://localhost:5173 (HMR)
```

**Serving together.** `docker-compose.yml` runs nginx, which serves the built SPA (`frontend/dist`)
and proxies the API paths to the backend — deploy **same-origin** so the `SameSite=Strict` session
cookie and CSRF flow work.

**End-to-end tests** (`frontend/e2e/`, Playwright — see §8 for the CI job). Drives the real backend +
frontend + a [Mailpit](https://github.com/axllent/mailpit) SMTP catcher through actual browser
sessions (registration, TOTP, transfers, admin/superadmin RBAC, etc.) — no mocking. Needs a
**completely empty** database (FR-08 auto-bootstraps the first-ever registered account as
superadmin) and Mailpit running locally:
```bash
# one-time: apply sql/01…06 to a fresh DB, point SMTP_HOST/PORT at Mailpit (127.0.0.1:1025)
cd frontend
npm install && npx playwright install --with-deps chromium
npm run test:e2e            # PW_BASE_URL defaults to https://localhost:5173
```

---

## 8. CI/CD & security scanning

`.github/workflows/ci.yml` is a slim **orchestrator** on every push/PR (least-privilege
`GITHUB_TOKEN`, SHA-pinned actions, verified against `git ls-remote` — not just the tag name). Every
actual job lives in its own reusable workflow file, called via `uses:`, so the Actions UI shows what's
actually running instead of one opaque "CI" entry. `needs:` only works within a single file, which is
exactly why `ci.yml` stays the orchestrator: it's what keeps the hard gate below intact across files.

| Job (file) | Tool | Purpose |
|---|---|---|
| `frontend` (`frontend-build.yml`) | Vite build + `npm audit` | build the SPA; JS dependency SCA |
| `backend` (`backend-tests.yml`) | flake8 + Bandit + pytest | PEP 8 lint, Python SAST, full test suite against a throwaway PostgreSQL |
| `dependency-check` (`dependency-check.yml`) | OWASP Dependency-Check | SCA on the pinned `requirements.txt` |
| `sast` (`sast-semgrep.yml`) | Semgrep | OWASP Top Ten + Python + JavaScript rulesets — **BLOCKING** |
| `secret-scan` (`secret-scan-gitleaks.yml`) | Gitleaks | scans full git history for committed secrets — **BLOCKING** |
| `dast` (`dast-zap.yml`) | OWASP ZAP (baseline) | boots the app and scans it running — **BLOCKING** |
| `e2e` (`e2e-playwright.yml`) | Playwright | full-suite E2E against a live backend + frontend + Mailpit (registration/TOTP, transfers, admin/superadmin RBAC, notifications, etc.) — **BLOCKING** |
| `deploy` (`deploy-production.yml`) | SSH | deploys to the **production** EC2 host — gated on the `production` branch |
| `deploy-test` (`deploy-test.yml`) | SSH | deploys to a **separate test** EC2 host — gated on the `integration-test` branch |

**`frontend`, `backend`, `dependency-check`, `sast`, `secret-scan`, `dast`, and `e2e` are all
hard-blocking**: both deploy jobs declare
`needs: [frontend, backend, dependency-check, sast, secret-scan, dast, e2e]`, so a single
Semgrep/Gitleaks/ZAP finding, a failed test (unit or end-to-end), or an unresolved high-CVSS
dependency stops the push from deploying anywhere — there is no `continue-on-error` escape hatch.
Each deploy job is passed only the secrets it actually needs (an explicit `secrets:` map, never
`secrets: inherit`), so a compromised production deploy step still has no path to the test host's
credentials or vice versa.

**Two independent deploy targets, one pipeline:**
- **`production`** branch → the real production EC2 host — nginx + Cloudflare tunnel, TLS-terminated,
  same architecture as §2.
- **`integration-test`** branch → a separate test EC2 host with **no nginx/Cloudflare**: the frontend
  is served by the same `basicSsl`-backed Vite dev server used for local development (self-signed
  HTTPS; `VITE_ALLOW_PUBLIC=true` widens it from localhost-only to public), and the backend deploys
  via the identical `run.sh` method as production. Promote a change from `integration-test` to
  `production` via a **pull request** — the pipeline itself never pushes `integration-test`'s content
  to `production` automatically.

**Dependabot** (`.github/dependabot.yml`) opens weekly, grouped update PRs for the three ecosystems in
this repo — `pip` (`backend/`), `npm` (`frontend/`), `github-actions` (`.github/workflows/`) — each
with a 7-day cooldown so a newly published (and potentially malicious or unstable) version isn't
proposed immediately. Every PR still needs a human to review and run the test suite before merging —
nothing auto-merges.

Two allowlist notes for reviewers: **`.gitleaks.toml`** documents that the only "secrets" in the repo
are non-secret `itsdangerous` token salts and deliberately fake CI-only test credentials; and the
Semgrep step **excludes `nginx/`** because it is infra config, not app code (its one finding was the
standard `proxy_set_header Host $host` idiom, not exploitable here).

---

## 9. Backend API reference

REST/JSON contract for the frontend and QA. (Base URL is the same origin as the SPA; nginx proxies
`/auth`, `/accounts`, `/transactions`, `/admin` to the backend.)

### Conventions
- **Base URL:** same origin as the SPA (e.g. `https://securebank.space`). nginx proxies
  `/auth`, `/accounts`, `/transactions`, `/admin` to the backend.
- **Content type:** JSON in, JSON out. Send `Content-Type: application/json`.
- **Money:** always integer minor units (`amount_cents`, `balance_cents`). `1000` = SGD 10.00.
- **Timestamps:** ISO-8601 UTC. **IDs** are UUID strings; account numbers are 10-digit strings.

### Authentication & sessions
1. **Session cookie** `sb_session` — `Secure`, `HttpOnly`, `SameSite=Strict`. Set on a successful
   MFA login and sent automatically by the browser on same-origin requests (use
   `credentials: "include"` for fetch). It is HttpOnly — JS cannot read it.
2. **CSRF** — every **POST** is CSRF-protected; send the token in the **`X-CSRFToken`** header.
   > Fetch a token from **`GET /auth/csrf`** (returns `{ "csrf_token": "..." }` and sets the session
   > cookie), then send it as `X-CSRFToken` on every POST. Re-fetch if you get a `403`.
3. **Two-stage login:** password → MFA. Stage 1 returns a short-lived `mfa_token` (not a session);
   stage 2 verifies a TOTP/backup code and sets the session cookie.

### Error shape
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

### Endpoint index

**Auth column:** `Public` = no session · `Auth` = logged-in session cookie · `Admin` = admin role ·
`Superadmin` = superadmin role · `Token` = gated by an emailed one-time token (no session needed).

**Three roles (FR-08), verified server-side on every request.** `customer` = own data only.
`admin` = customer oversight **only** (users/accounts, approvals, NRIC reveal, customer-scoped audit);
acting on a non-customer returns `404`. `superadmin` = admin/role management **only** (a distinct role,
**not** a superset of admin): assign roles, suspend/reactivate staff, and read the **full** audit log.
The **first-ever account** to register is bootstrapped as `superadmin`; everyone else defaults to `customer`.

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
| `GET /auth/me` | Auth | Current user's profile (name, role, status) |
| `POST /auth/password/change` | Auth | Change password (current + new) |
| `POST /auth/email` | Auth | Request an email change (current password + link to new address) |
| `POST /auth/email/verify` | Token | Confirm the new email |
| `POST /auth/password/reset/request` | Public | Email a reset link (needs email **+ NRIC**) |
| `GET /auth/password/reset/check` | Public | Is a reset token still valid? (call on page load) |
| `POST /auth/password/reset/verify` | Token | Set a new password (token + TOTP) |
| `POST /accounts` | Auth | Request a new account (→ `open_requested`, needs admin approval; `409` if one is already pending) |
| `GET /accounts` | Auth | List own accounts |
| `GET /accounts/{id}` | Auth | View one account |
| `GET /accounts/{id}/transactions` | Auth | Paginated, filterable history |
| `GET /accounts/preferences` | Auth | View notification preferences |
| `PUT /accounts/preferences` | Auth | Update notification preferences |
| `POST /accounts/{id}/close` | Auth | Request closure (→ admin approval) |
| `POST /transactions/pin` | Auth | Set/replace the transaction PIN (password only when replacing) |
| `GET /transactions/pin` | Auth | Whether a PIN is set (`pin_set`) |
| `GET /transactions/billers` | Auth | List allowlisted billers |
| `POST /transactions/transfer` | Auth | Transfer funds (`Idempotency-Key`) |
| `POST /transactions/bill-payment` | Auth | Pay a biller (`Idempotency-Key`) |
| `GET /notifications` | Auth | List own notifications, newest-first, + unread count (`?page=`) |
| `POST /notifications/{id}/read` | Auth | Mark one notification read |
| `POST /notifications/read-all` | Auth | Mark all notifications read |
| `GET /admin/users` | Admin | List/search users (`?q=`) |
| `GET /admin/users/{id}/accounts` | Admin | One user's accounts (drill-down) |
| `GET /admin/accounts` | Admin | List all accounts |
| `GET /admin/audit` | Admin | Read audit log — **customer-scoped** (`?type=`, `?user=`); staff-to-staff events hidden |
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
| `GET /superadmin/users` | Superadmin | List the user directory with roles (`?q=`, `?role=`) |
| `POST /superadmin/users/{id}/role` | Superadmin | Assign a role (`customer`/`admin`/`superadmin`) |
| `POST /superadmin/users/{id}/suspend` | Superadmin | Suspend an admin/superadmin (reason required) |
| `POST /superadmin/users/{id}/reactivate` | Superadmin | Reactivate a suspended admin/superadmin |
| `GET /superadmin/audit` | Superadmin | Read the **full** audit log (every event, incl. staff-to-staff) |

### Field validation (server-side allowlist — every field is checked before any logic)

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

### Auth — `/auth`

#### `GET /auth/csrf`
Bootstrap a CSRF token for the SPA (call once before doing POSTs).
```jsonc
// 200
{ "csrf_token": "..." }   // send as the X-CSRFToken header on every POST
```

#### `POST /auth/register`
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

#### `POST /auth/register/verify-totp`  — confirm the authenticator
```jsonc
{ "email": "a@b.com", "code": "123456" }
// → 200 { "status": "active" }   // or "pending" if the email isn't verified yet
```

#### `POST /auth/register/totp-setup`  — re-issue the authenticator QR
For a user who registered but closed the QR screen before scanning. Not logged in yet, so it takes
credentials:
```jsonc
{ "email": "a@b.com", "password": "..." }
// → 200 { "provisioning_uri": "otpauth://totp/..." }   // same seed as registration
```
Returns the URI **only** while the account is `pending` with TOTP not yet confirmed; otherwise a
generic `401` (the seed is never re-exposed once set up). Wrong passwords count toward lockout.

#### `POST /auth/register/verify-email`  — confirm the signup email (from the emailed link)
```jsonc
{ "token": "..." }
// → 200 { "status": "active" }   // or "pending" if TOTP isn't confirmed yet
```
The link is `<FRONTEND_BASE_URL>/verify-email?token=…` (24-h expiry). The SPA reads `token` from the
query string and POSTs it here.

#### `POST /auth/login`  (stage 1)
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

**If the password is correct but an admin/superadmin has suspended the account**, you get instead:
```jsonc
// 403
{ "error": "Your account has been suspended. Please contact support." }
```
Only reachable with the right password — a wrong-password guess on a suspended account still gets the
generic `401` above, so this doesn't help account enumeration (SR-09).

#### `POST /auth/register/resend-email`  — re-send the signup verification link
```jsonc
{ "email": "a@b.com" }                      // → 200 { "status": "verification_email_sent" }
```
Generic (no enumeration), rate-limited. Sends only if the account is pending with an unverified email.

#### `POST /auth/login/mfa`  (stage 2 — TOTP or a backup code; sets the session cookie)
```jsonc
{ "mfa_token": "...", "code": "123456" }   // → 200 { "status": "ok" } + Set-Cookie
```

#### `POST /auth/logout`
→ `200 { "status": "logged_out" }` (revokes session, clears cookie).

#### `GET /auth/me`  *(auth required)* — the current user's profile
Call after login to know who's signed in and gate UI by role. Masked NRIC only; no secrets.
```jsonc
// → 200
{ "user_id": "uuid", "email": "a@b.com", "full_name": "Tan Ah Kow", "role": "customer",
  "nric_masked": "S****567D", "email_verified": true, "account_status": "active",
  "created_at": "..." }
// 401 if not logged in
```

#### `POST /auth/password/change`  *(auth required)* — change password while logged in
```jsonc
{ "current_password": "...", "new_password": "N3w!Str0ngPassw0rd" }
// → 200 { "status": "password_changed" }
```
Re-verifies the current password (`401` if wrong); new password must meet the FR-01 policy and differ
from the old (`400`). On success **all your *other* sessions are revoked** (this one stays signed in).

#### `POST /auth/email`  *(auth required)* — request email change (30-min link to the new address)
```jsonc
{ "new_email": "new@b.com", "password": "<current password>" }
// → 200 { "status": "verification_sent" }   (generic, even if the address is already in use)
// → 401 if the current password is wrong
```
Re-verifies the caller's **current password** first (so a hijacked session can't change the email).
Rate-limited to 10/hour per account → `429` when exceeded. Sends a **verification link to the new
address** — the link points at `<FRONTEND_BASE_URL>/verify-email-change?token=…` and is confirmed via
`POST /auth/email/verify` — **and a security alert to the current/old address** (no token) so the real
owner is notified if a hijacked session tries to change the email.

#### `POST /auth/email/verify`
```jsonc
{ "token": "..." }                          // → 200 { "status": "email_updated", "email": "new@b.com" }
```

#### `POST /auth/password/reset/request`  — forgot password (emails a 30-min single-use link)
Requires **both** email **and** NRIC — a link is sent only if they match an existing account.
```jsonc
{ "email": "a@b.com", "nric": "S1234567D" }  // → 200 { "status": "reset_requested" }
```
Always generic `200` (never reveals whether the email/NRIC matched). Rate-limited 10/hour per account.

#### `GET /auth/password/reset/check?token=…`  — is the reset link still valid?
Call this when the `/reset-password` page loads, to show the form or an "expired link" message
before the user fills anything in. **Read-only** — it does not consume the token.
```jsonc
// → 200 { "valid": true }   // or false (bad/expired/already-used token)
```
Returns only a boolean (no account info); no CSRF/session needed.

#### `POST /auth/password/reset/verify`  — set a new password from the emailed link
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
> raw token; the SPA reads `token` from the query string. The verify-email/verify-email-change
> emails work the same way. (A lockout alert email carries **no** token/link — a locked account has
> no self-service unlock; it only auto-expires after 30 min or an admin unlocks it.)

---

### Accounts — `/accounts`  *(all require auth)*

#### `POST /accounts`  — **request** a new account (needs admin approval)
The account is created **frozen** (`open_requested`) and can't transact until an admin approves it.
Only **one opening request may be pending at a time**: while an `open_requested` account
exists, a second request returns `409`. Request again once it is approved or rejected.
```jsonc
{ "account_type": "savings" }               // or "current"
// 201
{ "account_id": "uuid", "account_number": "0123456789", "account_type": "savings",
  "balance_cents": 0, "status": "open_requested", "created_at": "..." }
// 409  — an opening request is already awaiting approval
{ "error": "You already have an account opening request awaiting approval." }
```
An admin then approves (→ `active`) or rejects (→ `closed`) — see the admin endpoints.

#### `GET /accounts`
→ `200 { "accounts": [ { account… }, … ] }`

#### `GET /accounts/{account_id}`
→ `200 { account… }` · `404` if not yours.

#### `GET /accounts/{account_id}/transactions`
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

#### `GET /accounts/preferences` · `PUT /accounts/preferences`  — notification settings
```jsonc
// GET → 200
{ "notify_on_transfer": true, "notify_on_login": true }
// PUT body (both optional; partial update) → 200 with the updated prefs
{ "notify_on_transfer": false }             // non-boolean value → 400
```
`notify_on_transfer` gates transfer + bill-payment receipt emails; `notify_on_login` gates the
"new sign-in" email. Both default to `true`.

#### `POST /accounts/{account_id}/close`  — **request** closure (zero balance + fresh TOTP)
This does **not** close the account immediately — it submits a request an admin must approve.
```jsonc
{ "totp_code": "123456" }
// → 200 { account… "status": "close_requested" } · 400 if balance≠0 · 401 bad code
```
While `close_requested` the account is **frozen** (no transfers in/out) until an admin approves
(→ `closed`) or rejects (→ `active`).

---

### Transactions — `/transactions`  *(all require auth)*

#### `POST /transactions/pin`  — set/replace the 6-digit transaction PIN
```jsonc
// FIRST-TIME setup (no PIN yet): password NOT required
{ "pin": "135790" }                         // → 200 { "status": "pin_set" }

// REPLACING an existing PIN: current password IS required
{ "password": "...", "pin": "246810" }      // → 200 { "status": "pin_set" }  (401 if wrong/missing)
```
First-time setup skips the password (the caller is already authenticated and no PIN yet exists);
replacing an existing PIN re-verifies it, so a hijacked session can't silently swap it. Use
`GET /transactions/pin` (`pin_set`) to decide which form to show.

#### `GET /transactions/pin`  — has the user set a transaction PIN yet?
```jsonc
// → 200 { "pin_set": true }   // or false
```
Boolean only (never the PIN/hash). Use it to prompt for PIN setup, or to decide whether to show the
PIN field on a high-value (≥ SGD 1,000) transfer.

#### `GET /transactions/billers`
→ `200 { "billers": [ { "biller_id": "uuid", "biller_name": "Singtel", "biller_category": "telco" } ] }`

#### `POST /transactions/transfer`
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

#### `POST /transactions/bill-payment`
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

### Notifications — `/notifications`  *(all require auth; own data only, FR-10)*

Backs the customer notification bell. Raised on: account lockout, admin suspend/reactivate of the
user, admin suspend/unsuspend/close of a bank account, and open/close request approve/reject.
History is kept — marking read never deletes anything.

#### `GET /notifications`  — list, newest-first, + unread count
```jsonc
// ?page=1 (25/page)
{ "items": [ { "notification_id": "uuid", "category": "account_locked",
    "title": "...", "body": "...", "read_at": null, "created_at": "..." } ],
  "unread_count": 3 }
```
Read-only — does **not** slide the SR-13 idle-session timer (the bell polls every 60 s in the
background regardless of whether the user is present).

#### `POST /notifications/{id}/read`
→ `200 { "status": "ok" }` · `404` if it isn't yours (IDOR-safe).

#### `POST /notifications/read-all`
→ `200 { "status": "ok", "marked": <count> }`

---

### Admin — `/admin`  *(require admin role; customer → 403)*

| Method · Path | Body | Returns |
|---|---|---|
| `GET /admin/users?q=` | — | `{ "users": [ {user_id,email,full_name,nric_masked,role,account_status,created_at} ] }` — optional `q` = case-insensitive search on email or name |
| `GET /admin/accounts` | — | `{ "accounts": [ {account_id,user_id,account_number,account_type,balance_cents,status} ] }` |
| `GET /admin/users/{id}/accounts` | — | `{ "accounts": [ {account_id,account_number,account_type,balance_cents,status} ] }` — one user's accounts (directory drill-down) |
| `GET /admin/audit?page=&type=&user=` | — | `{ "items": [ {event_id,event_timestamp,event_type,actor_user_id,actor_role,actor_name,target_user_id,target_name,source_ip,outcome,action_detail} ], "page":1, "page_size":50 }` — **customer-scoped**: only events involving a customer (actor is a customer **or** target is a non-staff user); staff-to-staff activity (role changes, staff logins) is withheld and visible only via `GET /superadmin/audit`. `actor_name`/`target_name` are server-resolved for display. `type`=event type; `user`=UUID (actor **or** target; `400` if not a UUID); filters compose |
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

### Superadmin — `/superadmin`  *(require superadmin role; customer/admin → 403)*

A **distinct** role — admin/role management **only**, never customer oversight. Every action is
audited with the superadmin as actor and **revokes the target's sessions** on any privilege change
(SR-13). Guards: **no self-action** (a superadmin can't change/suspend their own account — another
superadmin must), and the **last active superadmin** can't be demoted or suspended.

| Method · Path | Body | Returns |
|---|---|---|
| `GET /superadmin/users?q=&role=` | — | `{ "users": [ {user_id,email,full_name,role,account_status,created_at} ] }` — full directory; optional `q` search + `role` filter |
| `POST /superadmin/users/{id}/role` | `{ "role": "customer\|admin\|superadmin" }` | `{ "user_id": "…", "role": "admin" }` — `400` invalid role · `403` self-action · `409` demoting the last superadmin |
| `POST /superadmin/users/{id}/suspend` | `{ "reason": "..." }` | `{ "account_status": "suspended" }` — staff only; reason required; `404` if target isn't an admin/superadmin |
| `POST /superadmin/users/{id}/reactivate` | — | `{ "account_status": "active" }` — lift a staff suspension/lock |
| `GET /superadmin/audit?page=&type=&user=` | — | Same shape as `/admin/audit` but **full scope** — every event, including staff-to-staff (role changes, admin/superadmin logins) that the admin view withholds |

---

### Infra
- `GET /healthz` → `200 { "status": "ok" }` (no auth; liveness probe).

### Typical happy path
`register` → `register/verify-totp` → `login` → `login/mfa` (cookie set) → `POST /accounts` →
`GET /accounts` → (set PIN) → `POST /transactions/transfer` → `GET /accounts/{id}/transactions`.

---

## 10. Frontend implementation notes

### Security Implementation Notes
* **Input Validation:** Financial input fields use strict Regex (e.g., /^\d*\.?\d{0,2}$/) and inputMode="decimal" to prevent invalid data types or malformed floating-point numbers from entering the component state.
* **XSS Prevention:** React JSX inherently auto-escapes all string inputs. dangerouslySetInnerHTML is strictly prohibited across the codebase.
* **Masking:** Authenticator code inputs strip all non-numeric characters instantly to prevent injection or formatting errors.

---

## 11. Before integrating
1. **CSRF flow:** call `GET /auth/csrf` once, then send the returned token as `X-CSRFToken` on every POST.
2. Deploy **same-origin** (one domain via nginx) so the `SameSite=Strict` cookie + CSRF work — don't
   split the API onto a different subdomain.
