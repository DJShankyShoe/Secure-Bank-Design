// FR-09: forgot-password flow. Identity (email+NRIC) is proven at the
// REQUEST step (ForgotPassword.jsx has no NRIC field at the verify step —
// only TOTP/backup code, confirmed against login_service.verify_password_reset,
// which never re-checks NRIC). Both steps stay generic (anti-enumeration,
// SR-09), and a reset must NOT clear an existing brute-force lockout.
import { test, expect } from '@playwright/test';
import { fillAndSubmitLoginPassword, login, registerAndActivate } from '../fixtures/helpers.js';
import { freshTotp } from '../fixtures/totp.js';
import { waitForEmail, waitForEmailCount, searchEmails, extractToken } from '../fixtures/mailbox.js';

async function requestReset(page, email, nric) {
  await page.goto('/forgot-password');
  await page.getByLabel('NRIC').fill(nric);
  await page.getByLabel('Registered Email Address').fill(email);
  await page.getByRole('button', { name: 'Send Recovery Link' }).click();
  await expect(page.getByText(/a password reset link has been sent/i)).toBeVisible({ timeout: 10_000 });
}

test.describe('Password reset (forgot password)', () => {
  test('correct email+NRIC sends a real reset link; wrong NRIC sends none — same generic message either way', async ({ page }) => {
    const user = await registerAndActivate(page); // consumes exactly 1 email (signup verify)
    const before = await searchEmails(user.email);
    expect(before.length).toBe(1);

    await requestReset(page, user.email, 'S0000000Z'); // wrong NRIC, right email
    await page.waitForTimeout(1500); // let any async send land, if one were coming
    const afterWrongNric = await searchEmails(user.email);
    expect(afterWrongNric.length).toBe(1); // nothing new — request silently ignored

    await requestReset(page, user.email, user.nric); // correct pair
    const afterCorrect = await waitForEmailCount(user.email, 2);
    expect(afterCorrect.length).toBe(2);
  });

  test('wrong TOTP at the reset link stays generic and does not change the password', async ({ page }) => {
    const user = await registerAndActivate(page);
    await requestReset(page, user.email, user.nric);
    const msg = await waitForEmail(user.email);
    const token = extractToken(msg.Text, '/reset-password');

    await page.goto(`/reset-password?token=${token}`);
    await expect(page.getByRole('button', { name: 'Reset password' })).toBeVisible({ timeout: 15_000 });
    await page.getByLabel('New Password').fill('Ev3nStr0nger!Pw#2');
    await page.getByLabel('Confirm Password').fill('Ev3nStr0nger!Pw#2');
    await page.getByLabel('Authenticator Code').fill('000000');
    await page.getByRole('button', { name: 'Reset password' }).click();
    await expect(page.getByText('Verification code is incorrect.')).toBeVisible({ timeout: 10_000 });

    // Old password still works -> nothing was changed.
    await fillAndSubmitLoginPassword(page, user.email, user.password);
    await page.waitForSelector('#securityCode', { timeout: 10_000 });
  });

  test('correct TOTP resets the password and revokes ALL existing sessions', async ({ page, browser }) => {
    const user = await registerAndActivate(page);

    const otherCtx = await browser.newContext({ ignoreHTTPSErrors: true });
    const otherPage = await otherCtx.newPage();
    await login(otherPage, user.email, user.password, user.secret);
    await expect(otherPage).toHaveURL(/\/setup-pin$|\/dashboard$/);

    await requestReset(page, user.email, user.nric);
    const msg = await waitForEmail(user.email);
    const token = extractToken(msg.Text, '/reset-password');
    const newPassword = 'Ev3nStr0nger!Pw#2';

    await page.goto(`/reset-password?token=${token}`);
    await expect(page.getByRole('button', { name: 'Reset password' })).toBeVisible({ timeout: 15_000 });
    await page.getByLabel('New Password').fill(newPassword);
    await page.getByLabel('Confirm Password').fill(newPassword);
    await page.getByLabel('Authenticator Code').fill(await freshTotp(user.secret));
    await page.getByRole('button', { name: 'Reset password' }).click();
    await expect(page).toHaveURL(/\/login$/, { timeout: 10_000 });

    // Old password now fails; new one works.
    await fillAndSubmitLoginPassword(page, user.email, user.password);
    await expect(page.getByText(/invalid/i)).toBeVisible({ timeout: 10_000 });
    await fillAndSubmitLoginPassword(page, user.email, newPassword);
    await page.waitForSelector('#securityCode', { timeout: 10_000 });

    // The pre-existing session is dead.
    await otherPage.reload();
    await expect(otherPage).toHaveURL(/\/login$/, { timeout: 10_000 });
    await otherCtx.close();
  });

  test('a password reset does NOT clear an existing brute-force lockout (SR-09)', async ({ page }) => {
    const user = await registerAndActivate(page);

    for (let i = 0; i < 5; i += 1) {
      await fillAndSubmitLoginPassword(page, user.email, 'DefinitelyWrong123!');
      await expect(page.getByText(/invalid/i)).toBeVisible({ timeout: 10_000 });
    }

    await requestReset(page, user.email, user.nric);
    const msg = await waitForEmail(user.email);
    const token = extractToken(msg.Text, '/reset-password');
    const newPassword = 'Ev3nStr0nger!Pw#2';

    await page.goto(`/reset-password?token=${token}`);
    await expect(page.getByRole('button', { name: 'Reset password' })).toBeVisible({ timeout: 15_000 });
    await page.getByLabel('New Password').fill(newPassword);
    await page.getByLabel('Confirm Password').fill(newPassword);
    await page.getByLabel('Authenticator Code').fill(await freshTotp(user.secret));
    await page.getByRole('button', { name: 'Reset password' }).click();
    await expect(page).toHaveURL(/\/login$/, { timeout: 10_000 });

    // Even with the brand-new (correct) password, the account is still locked.
    await fillAndSubmitLoginPassword(page, user.email, newPassword);
    await expect(page.getByText(/invalid/i)).toBeVisible({ timeout: 10_000 });
  });
});
