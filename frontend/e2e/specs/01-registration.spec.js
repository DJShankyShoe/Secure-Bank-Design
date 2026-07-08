// FR-01: registration, TOTP enrolment, signup email verification, anti-
// enumeration on duplicate email/NRIC, and the TOTP-re-setup fix (a user who
// never scanned the QR code the first time must still be able to get one).
//
// Note: "first-ever account becomes superadmin" (FR-08) is exercised by
// e2e/global-setup.js, not here — it can only happen once per database
// lifetime, and global setup already fails the whole run loudly if it
// doesn't work, so a duplicate assertion here would be redundant (and
// impossible to repeat against the same DB).
import { test, expect } from '@playwright/test';
import {
  STRONG_PASSWORD,
  WEAK_PASSWORD,
  completeTotpSetup,
  fillRegisterForm,
  registerUser,
  uniqueEmail,
  uniqueNric,
  verifySignupEmailViaMailbox,
} from '../fixtures/helpers.js';
import { waitForEmailCount } from '../fixtures/mailbox.js';

test.describe('Registration + TOTP setup (FR-01)', () => {
  test('happy path: register, confirm TOTP, verify signup email', async ({ page }) => {
    const user = await registerUser(page);
    expect(user.secret).toBeTruthy();
    await expect(page.getByRole('button', { name: 'Verify Authenticator' })).toBeVisible();

    await completeTotpSetup(page, user.secret);
    await expect(page).toHaveURL(/\/verify-email$/);
    await expect(page.getByText('Check Your Inbox')).toBeVisible();

    await verifySignupEmailViaMailbox(page, user.email);
    await page.getByRole('button', { name: 'Proceed to Log In' }).click();
    await expect(page).toHaveURL(/\/login$/);
  });

  test('registration rejects a weak password server-side', async ({ page }) => {
    await fillRegisterForm(page, {
      fullName: 'Weak Pw User',
      nric: uniqueNric(),
      email: uniqueEmail(),
      password: WEAK_PASSWORD,
    });
    await page.getByRole('button', { name: 'Register', exact: true }).click();
    await expect(page.locator('.toast--error')).toBeVisible();
    // Rejected server-side -> never navigates to the TOTP setup page.
    await expect(page).toHaveURL(/\/register$/);
  });

  test('duplicate email and duplicate NRIC both get the same generic error (anti-enumeration)', async ({ page }) => {
    const existing = await registerUser(page);

    // Same email, different NRIC.
    await fillRegisterForm(page, {
      fullName: 'Dup Email User',
      nric: uniqueNric(),
      email: existing.email,
      password: STRONG_PASSWORD,
    });
    await page.getByRole('button', { name: 'Register', exact: true }).click();
    const dupEmailToast = page.locator('.toast--error');
    await expect(dupEmailToast).toBeVisible();
    const dupEmailMessage = await dupEmailToast.textContent();
    await expect(page).toHaveURL(/\/register$/);

    // Same NRIC, different email.
    await fillRegisterForm(page, {
      fullName: 'Dup Nric User',
      nric: existing.nric,
      email: uniqueEmail(),
      password: STRONG_PASSWORD,
    });
    await page.getByRole('button', { name: 'Register', exact: true }).click();
    const dupNricToast = page.locator('.toast--error');
    await expect(dupNricToast).toBeVisible();
    const dupNricMessage = await dupNricToast.textContent();
    await expect(page).toHaveURL(/\/register$/);

    // Identical wording either way -> can't tell which field collided.
    expect(dupEmailMessage).toBe(dupNricMessage);
    expect(dupEmailMessage).toContain('already exists');
  });

  test('"Resend Verification Email" sends a second email to the same address', async ({ page }) => {
    const user = await registerUser(page);
    await completeTotpSetup(page, user.secret);
    await expect(page).toHaveURL(/\/verify-email$/);

    await page.getByRole('button', { name: 'Resend Verification Email' }).click();
    await expect(page.getByText(/a new link is on its way/i)).toBeVisible({ timeout: 10_000 });
    await waitForEmailCount(user.email, 2);
  });

  test('TOTP re-setup: a user who never scanned the QR can still get one later', async ({ page }) => {
    // Reproduces the exact reported bug: register, do NOT confirm TOTP, log in
    // later with the correct password -> landed on /register/totp with no QR
    // data and (before the fix) a dead-end "you already scanned it" message.
    const user = await registerUser(page);
    // Do not call completeTotpSetup — simulate closing the tab / not scanning.

    await page.goto('/login');
    await page.getByLabel('Email Address').fill(user.email);
    await page.getByLabel('Password').fill(user.password);
    await page.getByRole('button', { name: 'Secure Log In' }).click();
    // Backend reports totp_confirmed:false -> Login.jsx redirects straight here
    // (never shows an MFA-code screen at all).
    await page.waitForURL('**/register/totp', { timeout: 15_000 });

    // No QR shown yet — the old bug's dead-end message, now replaced with a
    // real way to get the QR.
    await expect(page.locator('input[readonly]')).toHaveCount(0);
    await page.getByRole('button', { name: 'Never scanned it? Get the QR code' }).click();
    await page.locator('input[type="password"]').fill(user.password);
    await page.getByRole('button', { name: 'Show QR Code' }).click();

    await expect(page.locator('input[readonly]')).toBeVisible({ timeout: 10_000 });
    const secret = await page.locator('input[readonly]').inputValue();
    expect(secret).toBe(user.secret); // same seed, never rotated

    await completeTotpSetup(page, secret);
    await expect(page).toHaveURL(/\/verify-email$/);
  });
});
