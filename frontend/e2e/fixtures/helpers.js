// Shared E2E helpers: registration/TOTP/email-verify/login flows, the custom
// notify.jsx modal (confirm/promptReason — NOT window.confirm/prompt, see
// src/ui/notify.jsx), and admin/superadmin setup helpers used across specs.
//
// Design note: helpers always take an explicit `page` (or `browser`, for flows
// needing more than one signed-in actor at once) rather than relying on a
// single global fixture — most specs in this suite need at least two actors
// (e.g. a customer and the admin who approves their request) live in the same
// test, each in its own isolated browser context.
import { expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { freshTotp } from './totp.js';
import { waitForEmail, extractToken } from './mailbox.js';
import { fundAccount } from './db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const AUTH_DIR = path.join(__dirname, '..', '.auth');
export const SUPERADMIN_FILE = path.join(AUTH_DIR, 'superadmin.json');

export const STRONG_PASSWORD = 'Str0ng!Passw0rd#1';
export const WEAK_PASSWORD = 'short1';
export const DEFAULT_PIN = '135790';

// Post-action navigation waits (register->TOTP, TOTP->verify-email, login->
// dashboard, etc.) all consistently succeed, just sometimes later than 60s on
// a loaded CI runner — never a hang, always eventually completes on retry.
// That points at the wait being too tight rather than anything actually
// broken, so it's generous here rather than tuned via worker-count alone.
export const NAV_TIMEOUT = 120_000;

// Explicit, not relying on the test runner's implicit per-project defaults —
// browser.newContext() only inherits baseURL/ignoreHTTPSErrors automatically
// when called on the fixture-provided `browser` from within a real Playwright
// test; calling it manually (e.g. in a standalone debug script, or arguably
// even here) needs it spelled out, or relative goto('/path') calls fail with
// "Cannot navigate to invalid URL".
export const NEW_CONTEXT_OPTS = {
  baseURL: process.env.PW_BASE_URL || 'https://localhost:5173',
  ignoreHTTPSErrors: true,
};

let _seq = 0;

/** A fresh, guaranteed-unique email for register()/login() fixtures. */
export function uniqueEmail(prefix = 'e2e') {
  _seq += 1;
  return `${prefix}-${Date.now()}-${_seq}-${Math.random().toString(36).slice(2, 8)}@example.com`;
}

/** A fresh, format-valid Singapore NRIC (no checksum enforced server-side). */
export function uniqueNric() {
  const letters = 'STFGM';
  const prefix = letters[Math.floor(Math.random() * letters.length)];
  const digits = String(Math.floor(1_000_000 + Math.random() * 8_999_999));
  const suffix = String.fromCharCode(65 + Math.floor(Math.random() * 26));
  return `${prefix}${digits}${suffix}`;
}

// --------------------------------------------------------------------------- //
// Generic field/label helpers (most forms in this app use a plain `.field`
// wrapper with a sibling <label> — no htmlFor/id — so getByLabel() won't find
// them; a few (Login, ForgotPassword, ResetPassword, SetupPin) DO use
// htmlFor/id and should just use page.getByLabel() directly instead.
// --------------------------------------------------------------------------- //

/** Locate a `.field` wrapper by its exact label text. `scope` is `page` or a
 * Locator (e.g. a specific `.content-card`) — several pages (Settings.jsx
 * especially) reuse the same label ("Current Password") in more than one
 * card, so page-wide lookups are ambiguous; pass the containing card as
 * `scope` in those cases.
 *
 * The `has` sub-locator is always built from the page, never from `scope`
 * itself: `scope.getByText(...)` bakes scope's OWN filter chain (e.g. "is a
 * .content-card matching this heading") into the sub-locator, and `has` then
 * requires that whole chain to be satisfiable AS A DESCENDANT of each `.field`
 * candidate — which can never be true (a .field is never itself an ancestor
 * of the .content-card it lives inside), so the filter silently matches
 * nothing. A plain page-global text locator has no such nested requirement. */
export function fieldByLabel(scope, exactLabel) {
  const pg = typeof scope.page === 'function' ? scope.page() : scope;
  return scope.locator('.field').filter({ has: pg.getByText(exactLabel, { exact: true }) });
}

export async function fillField(scope, label, value) {
  await fieldByLabel(scope, label).locator('input, textarea').fill(value);
}

export async function selectField(scope, label, value) {
  await fieldByLabel(scope, label).locator('select').selectOption(value);
}

/** Select an <option> under a labeled <select> by matching its visible text —
 * for selects whose option `value` is an opaque id (e.g. account_id UUID)
 * rather than the human-readable label (e.g. "savings (1234567890)"). */
export async function selectOptionContainingText(page, label, textSubstring) {
  const select = fieldByLabel(page, label).locator('select');
  const option = select.locator('option', { hasText: textSubstring }).first();
  await expect(option).toHaveCount(1, { timeout: 20_000 });
  const value = await option.getAttribute('value');
  await select.selectOption(value);
}

// --------------------------------------------------------------------------- //
// Custom modal (src/ui/notify.jsx) — NOT window.confirm/prompt, so
// page.on('dialog') never fires for these.
// --------------------------------------------------------------------------- //

export async function confirmModal(page) {
  await page.locator('.modal-card').waitFor({ state: 'visible' });
  await page.locator('.modal-btn--primary, .modal-btn--danger').click();
}

export async function cancelModal(page) {
  await page.locator('.modal-card').waitFor({ state: 'visible' });
  await page.locator('.modal-btn--ghost').click();
}

export async function promptReasonModal(page, reason) {
  await page.locator('.modal-card').waitFor({ state: 'visible' });
  await page.locator('#notify-input').fill(reason);
  await page.locator('.modal-btn--primary, .modal-btn--danger').click();
}

/** toast.jsx success/error toasts have no fixed text — wait on the CSS class.
 * Uses NAV_TIMEOUT, not the global 10s default: the action behind a toast is
 * usually a full POST -> DB (often with row locking) -> audit write -> email
 * dispatch round trip, the same cost profile as the navigation waits above,
 * and just as prone to landing >10s under concurrent CI load. */
export async function expectToast(page, type = 'success') {
  await expect(page.locator(`.toast--${type}`).first()).toBeVisible({ timeout: NAV_TIMEOUT });
}

// --------------------------------------------------------------------------- //
// Registration → TOTP setup → signup email verification (FR-01)
// --------------------------------------------------------------------------- //

export async function fillRegisterForm(page, { fullName, nric, email, password }) {
  await page.goto('/register');
  await fillField(page, 'Full Name (as in NRIC)', fullName);
  await fillField(page, 'NRIC', nric);
  await fillField(page, 'Email Address', email);
  await fillField(page, 'Password (Min 12 characters)', password);
  await fillField(page, 'Confirm Password', password);
}

/** Fill + submit the register form. Lands on /register/totp; returns the user
 * plus the base32 TOTP secret read straight off the rendered QR page. */
export async function registerUser(page, overrides = {}) {
  const user = {
    fullName: 'QA Test User',
    nric: uniqueNric(),
    email: uniqueEmail(),
    password: STRONG_PASSWORD,
    ...overrides,
  };
  await fillRegisterForm(page, user);
  await page.getByRole('button', { name: 'Register', exact: true }).click();
  await page.waitForURL('**/register/totp', { timeout: NAV_TIMEOUT });
  const secret = await page.locator('input[readonly]').inputValue();
  return { ...user, secret };
}

/** On /register/totp (or after reissueing the QR): submit a fresh code. */
export async function completeTotpSetup(page, secret) {
  const code = await freshTotp(secret);
  await page.locator('input[inputmode="numeric"]').fill(code);
  await page.getByRole('button', { name: 'Verify Authenticator' }).click();
  await page.waitForURL((url) => /\/(verify-email|login)$/.test(url.pathname), { timeout: NAV_TIMEOUT });
}

/** Read the real signup-verification email via Mailpit and click through it. */
export async function verifySignupEmailViaMailbox(page, email) {
  const msg = await waitForEmail(email, { subjectContains: undefined });
  const token = extractToken(msg.Text, '/verify-email');
  await page.goto(`/verify-email?token=${token}`);
  await expect(page.getByRole('button', { name: 'Proceed to Log In' })).toBeVisible({ timeout: NAV_TIMEOUT });
}

/** Full FR-01 happy path: register → confirm TOTP → verify signup email.
 * Account is 'active' afterward (both checks satisfied, order-independent). */
export async function registerAndActivate(page, overrides = {}) {
  const user = await registerUser(page, overrides);
  await completeTotpSetup(page, user.secret);
  await verifySignupEmailViaMailbox(page, user.email);
  return user;
}

// --------------------------------------------------------------------------- //
// Login / logout (FR-01 two-stage; SR-11)
// --------------------------------------------------------------------------- //

export async function fillAndSubmitLoginPassword(page, email, password) {
  await page.goto('/login');
  await page.getByLabel('Email Address').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Secure Log In' }).click();
}

export async function submitMfaCode(page, secret) {
  await page.waitForSelector('#securityCode', { timeout: 20_000 });
  const code = await freshTotp(secret);
  await page.locator('#securityCode').fill(code);
  await page.getByRole('button', { name: 'Authenticate' }).click();
}

/** Full two-stage login. Waits for navigation away from /login (customer
 * lands on /setup-pin the first time, else /dashboard; admin -> /console/users;
 * superadmin -> /super/roles). */
export async function login(page, email, password, secret) {
  await fillAndSubmitLoginPassword(page, email, password);
  await submitMfaCode(page, secret);
  await page.waitForURL((url) => !url.pathname.includes('/login'), { timeout: NAV_TIMEOUT });
}

export async function logout(page) {
  await page.getByRole('button', { name: 'Log out' }).click();
  await page.waitForURL('**/login', { timeout: 20_000 });
}

// --------------------------------------------------------------------------- //
// Mandatory transaction-PIN setup (ProtectedCustomerRoute gates every customer
// page on pinSetupCompleted) + full customer onboarding.
// --------------------------------------------------------------------------- //

export async function completePinSetup(page, pin = DEFAULT_PIN) {
  await page.waitForURL('**/setup-pin', { timeout: NAV_TIMEOUT });
  await page.locator('#pin').fill(pin);
  await page.locator('#confirmPin').fill(pin);
  await page.getByRole('button', { name: 'Complete Setup' }).click();
  await page.waitForURL('**/dashboard', { timeout: NAV_TIMEOUT });
}

/** register -> activate -> first login -> PIN setup -> lands on /dashboard. */
export async function onboardCustomer(page, overrides = {}) {
  const pin = overrides.pin || DEFAULT_PIN;
  const user = await registerAndActivate(page, overrides);
  await login(page, user.email, user.password, user.secret);
  await completePinSetup(page, pin);
  return { ...user, pin };
}

// --------------------------------------------------------------------------- //
// Superadmin bootstrap (FR-08: the first-ever account becomes superadmin) —
// written once by e2e/global-setup.js, read by every spec that needs staff.
// --------------------------------------------------------------------------- //

export function getSuperadmin() {
  return JSON.parse(fs.readFileSync(SUPERADMIN_FILE, 'utf-8'));
}

/** Authenticated GET/POST against the real backend, reusing `page`'s session
 * cookies — for asserting API-level behavior (status codes, response shape)
 * that has no UI to drive (e.g. a 404 on a target the UI deliberately never
 * shows an id for).
 *
 * Flask-WTF's WTF_CSRF_SSL_STRICT (on by default) requires the Referer header
 * to match the request's own origin for HTTPS requests — a real browser sets
 * this automatically on every fetch/form submit, but a bare page.request call
 * does not, so it must be set explicitly here or every POST 403s with
 * "CSRF validation failed." regardless of how correct the token is. */
export const apiGet = (page, path) =>
  page.request.get(path, { headers: { Referer: page.url() } });

export async function apiPost(page, path, body, extraHeaders = {}) {
  const referer = page.url();
  const csrfRes = await page.request.get('/auth/csrf', { headers: { Referer: referer } });
  const { csrf_token } = await csrfRes.json();
  return page.request.post(path, {
    headers: { 'X-CSRFToken': csrf_token, Referer: referer, ...extraHeaders },
    data: body,
  });
}

/** Register a fresh customer, then have the bootstrap superadmin promote them
 * to admin. Returns the new admin's login credentials (email/password/secret). */
export async function createAdminUser(browser, superadmin, overrides = {}) {
  const custCtx = await browser.newContext(NEW_CONTEXT_OPTS);
  const custPage = await custCtx.newPage();
  const user = await registerAndActivate(custPage, overrides);
  await custCtx.close();

  const saCtx = await browser.newContext(NEW_CONTEXT_OPTS);
  const saPage = await saCtx.newPage();
  await login(saPage, superadmin.email, superadmin.password, superadmin.secret);
  await saPage.goto('/super/roles');
  await saPage.getByPlaceholder('Search by name or email').fill(user.email);
  await saPage.getByRole('button', { name: 'Search' }).click();
  const row = saPage.locator('tr', { hasText: user.email });
  await expect(row).toBeVisible({ timeout: 20_000 });
  await row.locator('select').selectOption('admin');
  await confirmModal(saPage);
  await expectToast(saPage, 'success');
  await saCtx.close();

  return user;
}

// --------------------------------------------------------------------------- //
// Account opening/closure lifecycle (FR-02/05) — admin-actor helpers, each
// opens its own isolated browser context so the calling spec's own
// (customer-actor) page/session is left untouched.
// --------------------------------------------------------------------------- //

/** Assumes `page` is already logged in as a customer. Requests a new account
 * and returns its (frozen, open_requested) account number. */
export async function requestAccountOpening(page, accountType = 'savings') {
  await page.goto('/account');
  await selectField(page, 'Account Type', accountType);
  await page.getByRole('button', { name: 'Request Account Opening' }).click();
  await expectToast(page, 'success');
  const note = page.locator('.inline-note', { hasText: 'awaiting admin approval' });
  await expect(note).toBeVisible({ timeout: 20_000 });
  const text = await note.textContent();
  const match = text.match(/(\d{10})/);
  if (!match) throw new Error(`Could not find account number in opening note: ${text}`);
  return match[1];
}

async function _adminAction(browser, admin, path, accountNumber, { approve, reason }) {
  const ctx = await browser.newContext(NEW_CONTEXT_OPTS);
  const page = await ctx.newPage();
  await login(page, admin.email, admin.password, admin.secret);
  await page.goto(path);
  const row = page.locator('tr', { hasText: accountNumber });
  await expect(row).toBeVisible({ timeout: 20_000 });
  if (approve) {
    await row.getByRole('button', { name: 'Approve' }).click();
    await confirmModal(page);
  } else {
    await row.getByRole('button', { name: 'Reject' }).click();
    await promptReasonModal(page, reason || 'e2e test rejection');
  }
  await expectToast(page, 'success');
  await ctx.close();
}

export const approveAccountOpening = (browser, admin, accountNumber) =>
  _adminAction(browser, admin, '/console/openings', accountNumber, { approve: true });

export const rejectAccountOpening = (browser, admin, accountNumber, reason) =>
  _adminAction(browser, admin, '/console/openings', accountNumber, { approve: false, reason });

export const approveAccountClosure = (browser, admin, accountNumber) =>
  _adminAction(browser, admin, '/console/closures', accountNumber, { approve: true });

export const rejectAccountClosure = (browser, admin, accountNumber, reason) =>
  _adminAction(browser, admin, '/console/closures', accountNumber, { approve: false, reason });

/** Request + immediately approve one more active account (e.g. a customer's
 * 2nd account, for an own-account transfer). Returns its account number. */
export async function openApprovedAccount(page, browser, admin, accountType = 'savings') {
  const accountNumber = await requestAccountOpening(page, accountType);
  await approveAccountOpening(browser, admin, accountNumber);
  return accountNumber;
}

/** Same as openApprovedAccount, then directly funds it (see fixtures/db.js —
 * the app has no in-app deposit/top-up feature at all, so this is the only
 * way to get money into a freshly opened account for transfer/bill-pay tests). */
export async function openApprovedFundedAccount(page, browser, admin, amountCents, accountType = 'savings') {
  const accountNumber = await openApprovedAccount(page, browser, admin, accountType);
  fundAccount(accountNumber, amountCents);
  return accountNumber;
}

/** Full onboarding + one approved active account, ready to transact.
 * Returns the customer creds plus `accountNumber`. */
export async function onboardCustomerWithActiveAccount(page, browser, admin, overrides = {}) {
  const user = await onboardCustomer(page, overrides);
  const accountNumber = await openApprovedAccount(page, browser, admin, overrides.accountType);
  return { ...user, accountNumber };
}

/** Same as onboardCustomerWithActiveAccount, but the account is pre-funded. */
export async function onboardCustomerWithFundedAccount(page, browser, admin, amountCents, overrides = {}) {
  const user = await onboardCustomer(page, overrides);
  const accountNumber = await openApprovedFundedAccount(page, browser, admin, amountCents, overrides.accountType);
  return { ...user, accountNumber };
}

// --------------------------------------------------------------------------- //
// Fund transfer (FR-06/SR-12) and bill payment (FR-07)
// --------------------------------------------------------------------------- //

/** Fill + submit the Transfer form. Caller asserts on the resulting toast. */
export async function performTransfer(page, {
  sourceAccountNumber,
  destinationAccountNumber,
  amount,
  destinationType = 'Own account',
  beneficiaryName = 'E2E Beneficiary',
  reference,
  pin,
}) {
  await page.goto('/transfer');
  if (sourceAccountNumber) await selectField(page, 'From account', sourceAccountNumber);
  await selectField(page, 'Transfer type', destinationType);
  await fillField(page, 'Beneficiary name', beneficiaryName);
  await fillField(page, 'Beneficiary account number', destinationAccountNumber);
  await fillField(page, 'Amount (SGD)', String(amount));
  if (reference) await fillField(page, 'Reference', reference);
  if (pin) await fillField(page, 'Enter 6-digit transaction PIN', pin);
  await page.getByRole('button', { name: 'Continue' }).click();
}

/** Fill + submit the Pay Bill form. `billerName` matches the option's visible
 * text (its value is an opaque biller_id). Caller asserts on the resulting toast. */
export async function performBillPayment(page, { billerName, sourceAccountNumber, amount }) {
  await page.goto('/bills');
  if (billerName) await selectOptionContainingText(page, 'Registered Biller', billerName);
  if (sourceAccountNumber) await selectField(page, 'Pay From', sourceAccountNumber);
  await fillField(page, 'Amount (SGD)', String(amount));
  await page.getByRole('button', { name: 'Confirm Payment' }).click();
}
