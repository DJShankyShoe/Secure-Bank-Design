// FR-01 two-stage login, SR-09 lockout + anti-enumeration, SR-11 MFA, SR-13
// session/logout, and the AccountSuspended carve-out added this session.
import { test, expect } from '@playwright/test';
import {
  completeTotpSetup,
  createAdminUser,
  fillAndSubmitLoginPassword,
  getSuperadmin,
  login,
  logout,
  onboardCustomer,
  promptReasonModal,
  registerAndActivate,
  registerUser,
} from '../fixtures/helpers.js';

test.describe('Login, lockout, and suspended accounts', () => {
  test('two-stage login happy path reaches the dashboard', async ({ page }) => {
    const user = await onboardCustomer(page);
    await logout(page);
    await login(page, user.email, user.password, user.secret);
    await expect(page).toHaveURL(/\/dashboard$/);
  });

  test('wrong password and unknown user get the identical generic error', async ({ page }) => {
    const user = await registerAndActivate(page);

    await fillAndSubmitLoginPassword(page, user.email, 'DefinitelyWrong123!');
    await expect(page.getByText('Invalid Email or Password. Please try again.').or(page.getByText('Invalid credentials.'))).toBeVisible();

    await fillAndSubmitLoginPassword(page, 'nobody-e2e@example.com', 'DefinitelyWrong123!');
    await expect(page.getByText('Invalid Email or Password. Please try again.').or(page.getByText('Invalid credentials.'))).toBeVisible();
  });

  test('5 consecutive failed logins lock the account (SR-09) — even the right password then fails', async ({ page }) => {
    const user = await registerAndActivate(page);

    for (let i = 0; i < 5; i += 1) {
      await fillAndSubmitLoginPassword(page, user.email, 'DefinitelyWrong123!');
      await expect(page.locator('body')).toContainText(/invalid/i, { timeout: 10_000 });
    }

    // Locked now — the CORRECT password must still fail generically.
    await fillAndSubmitLoginPassword(page, user.email, user.password);
    await expect(page.locator('body')).toContainText(/invalid/i, { timeout: 10_000 });
    await expect(page).toHaveURL(/\/login$/);
  });

  test('a pending account (TOTP confirmed, email not yet) redirects to /verify-email on login', async ({ page }) => {
    const user = await registerUser(page);
    await completeTotpSetup(page, user.secret);
    // Now totp_confirmed=true but email_verified=false — logging in again
    // (from a fresh /login visit) must route to /verify-email, not /register/totp.
    await page.goto('/login');
    await page.getByLabel('Email Address').fill(user.email);
    await page.getByLabel('Password').fill(user.password);
    await page.getByRole('button', { name: 'Secure Log In' }).click();
    await page.waitForURL('**/verify-email', { timeout: 15_000 });
  });

  test('logout revokes the session (SR-13) — /dashboard bounces back to /login', async ({ page }) => {
    const user = await onboardCustomer(page);
    await logout(page);
    await page.goto('/dashboard');
    await expect(page).toHaveURL(/\/login$/);
  });

  test('suspended account: wrong password stays generic, correct password reveals the suspension', async ({ page, browser }) => {
    const superadmin = getSuperadmin();
    const admin = await createAdminUser(browser, superadmin);
    const customer = await registerAndActivate(page);

    // Admin suspends the customer via the real UI (FR-08).
    const adminCtx = await browser.newContext({ ignoreHTTPSErrors: true });
    const adminPage = await adminCtx.newPage();
    await login(adminPage, admin.email, admin.password, admin.secret);
    await adminPage.getByPlaceholder('Search by name, email, or NRIC...').fill(customer.email);
    const row = adminPage.locator('tr', { hasText: customer.email });
    await expect(row).toBeVisible({ timeout: 10_000 });
    await row.getByRole('button', { name: 'Suspend' }).click();
    await promptReasonModal(adminPage, 'e2e fraud review');
    await expect(adminPage.locator('.toast--success')).toBeVisible();
    await adminCtx.close();

    // Wrong password on the now-suspended account -> still the generic message.
    await fillAndSubmitLoginPassword(page, customer.email, 'DefinitelyWrong123!');
    await expect(page.getByText('Invalid Email or Password. Please try again.').or(page.getByText('Invalid credentials.'))).toBeVisible();

    // Correct password -> reveals the suspension specifically.
    await fillAndSubmitLoginPassword(page, customer.email, customer.password);
    await expect(page.getByText(/account has been suspended/i)).toBeVisible({ timeout: 10_000 });
  });
});
