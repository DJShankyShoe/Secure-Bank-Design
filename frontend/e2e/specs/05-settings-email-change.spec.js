// FR-04 (email change: current-password re-verify, link-gated activation,
// alert to the old address) plus the rest of Settings.jsx: password change
// (other sessions revoked), notification preference toggles, and PIN replace.
//
// Note: Settings.jsx has a "first-time PIN setup" branch (no password field)
// for !pinIsSet, but ProtectedCustomerRoute forces every customer through
// /setup-pin before any customer page (including /settings) is reachable —
// so in normal usage pinIsSet is always already true here. Only the "replace
// an existing PIN" branch is exercised below; the other is effectively dead
// in the real app, not just untested.
import { test, expect } from '@playwright/test';
import {
  NAV_TIMEOUT,
  expectToast,
  fillField,
  login,
  onboardCustomer,
} from '../fixtures/helpers.js';
import { waitForEmail, extractToken } from '../fixtures/mailbox.js';

function cardByHeading(page, heading) {
  return page.locator('.content-card').filter({ has: page.getByRole('heading', { name: heading }) });
}

test.describe('Settings: email change, password change, PIN, preferences', () => {
  test('email change requires the current password (wrong password -> 401, no email sent)', async ({ page }) => {
    const user = await onboardCustomer(page);
    await page.goto('/settings');
    const emailCard = cardByHeading(page, 'Update Email Address');
    await fillField(emailCard, 'New Email Address', 'someone-new@example.com');
    await fillField(emailCard, 'Current Password', 'TotallyWrongPassword1!');
    await page.getByRole('button', { name: 'Send Verification Link' }).click();
    await expectToast(page, 'error');
  });

  test('email change: link goes to the NEW address, alert goes to the OLD address, activates only after the link is used', async ({ page }) => {
    const user = await onboardCustomer(page);
    const newEmail = `${user.email.split('@')[0]}-newaddr@example.com`;

    await page.goto('/settings');
    await expect(page.getByText(user.email)).toBeVisible();
    const emailCard = cardByHeading(page, 'Update Email Address');
    await fillField(emailCard, 'New Email Address', newEmail);
    await fillField(emailCard, 'Current Password', user.password);
    await page.getByRole('button', { name: 'Send Verification Link' }).click();
    await expectToast(page, 'success');

    // Old address gets a no-token security alert; still shown as current until used.
    const alertMsg = await waitForEmail(user.email);
    expect(alertMsg.Text).not.toContain('token=');
    await page.reload();
    await expect(page.getByText(user.email)).toBeVisible();

    // New address gets the real verification link.
    const verifyMsg = await waitForEmail(newEmail);
    const token = extractToken(verifyMsg.Text, '/verify-email-change');
    await page.goto(`/verify-email-change?token=${token}`);
    await expect(page.getByRole('button', { name: 'Back to Settings' })).toBeVisible({ timeout: NAV_TIMEOUT });

    await page.goto('/settings');
    await expect(page.getByText(newEmail)).toBeVisible({ timeout: NAV_TIMEOUT });
  });

  test('password change revokes other sessions but keeps the current one signed in', async ({ page, browser }) => {
    const user = await onboardCustomer(page);

    // A second, independent session for the same user.
    const otherCtx = await browser.newContext({ ignoreHTTPSErrors: true });
    const otherPage = await otherCtx.newPage();
    await login(otherPage, user.email, user.password, user.secret);
    await expect(otherPage).toHaveURL(/\/dashboard$/);

    const newPassword = 'Ev3nStr0nger!Pw#2';
    await page.goto('/settings');
    const pwCard = cardByHeading(page, 'Change Password');
    await fillField(pwCard, 'Current Password', user.password);
    await fillField(pwCard, 'New Password (Min 12 characters)', newPassword);
    await fillField(pwCard, 'Confirm New Password', newPassword);
    await page.getByRole('button', { name: 'Update Password' }).click();
    await expectToast(page, 'success');

    // This session (the one that changed it) stays signed in.
    await page.reload();
    await expect(page).toHaveURL(/\/settings$/);

    // The OTHER session was revoked.
    await otherPage.reload();
    await expect(otherPage).toHaveURL(/\/login$/, { timeout: NAV_TIMEOUT });

    await otherCtx.close();
  });

  test('wrong current password on PIN replace reports "current password", not "invalid PIN"', async ({ page }) => {
    // Regression test for the fix earlier this session (service.py CurrentPasswordWrong).
    const user = await onboardCustomer(page);
    await page.goto('/settings');
    const pinCard = cardByHeading(page, 'Transaction PIN');
    await fillField(pinCard, 'Current Password', 'TotallyWrongPassword1!');
    await fillField(pinCard, 'New 6-digit PIN', '224466');
    await fillField(pinCard, 'Confirm New PIN', '224466');
    await page.getByRole('button', { name: 'Update PIN' }).click();
    await expect(page.getByText('Current password is incorrect.')).toBeVisible();
  });

  test('PIN replace succeeds with the correct current password', async ({ page }) => {
    const user = await onboardCustomer(page);
    await page.goto('/settings');
    const pinCard = cardByHeading(page, 'Transaction PIN');
    await fillField(pinCard, 'Current Password', user.password);
    await fillField(pinCard, 'New 6-digit PIN', '224466');
    await fillField(pinCard, 'Confirm New PIN', '224466');
    await page.getByRole('button', { name: 'Update PIN' }).click();
    await expectToast(page, 'success');
  });

  test('notification preference toggles persist across a reload', async ({ page }) => {
    await onboardCustomer(page);
    await page.goto('/settings');
    const transferToggle = page.locator('#notifyTransfer');
    await expect(transferToggle).toBeChecked(); // defaults to true
    await transferToggle.uncheck();
    await page.waitForTimeout(500); // fire-and-forget PUT, no toast to await
    await page.reload();
    await expect(page.locator('#notifyTransfer')).not.toBeChecked();
  });
});
