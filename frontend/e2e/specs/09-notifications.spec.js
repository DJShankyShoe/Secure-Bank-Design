// FR-10: the customer notification bell. Polling is every 60s in the app;
// tests force a fresh mount (reload) instead of waiting on that real-time
// interval. Opening the bell marks everything read (no per-item action) —
// history is kept, so a re-open still lists the same items with a 0 badge.
import { test, expect } from '@playwright/test';
import {
  NAV_TIMEOUT,
  approveAccountOpening,
  createAdminUser,
  expectToast,
  getSuperadmin,
  login,
  onboardCustomer,
  onboardCustomerWithActiveAccount,
  promptReasonModal,
  requestAccountOpening,
} from '../fixtures/helpers.js';
import { waitForEmail } from '../fixtures/mailbox.js';

const bell = (page) => page.locator('button[aria-label="Notifications"]');
const badge = (page) => bell(page).locator('span', { hasText: /^\d+\+?$/ });

test.describe('Notification bell', () => {
  test('an approved opening request raises a badge + in-app notification', async ({ page, browser }) => {
    const superadmin = getSuperadmin();
    const admin = await createAdminUser(browser, superadmin);
    // Plain onboarding (no pre-existing active account) — this test approves
    // exactly ONE opening request, so there's only ever one "Account opening
    // approved" notification to match.
    const user = await onboardCustomer(page);
    const accountNumber = await requestAccountOpening(page);

    await approveAccountOpening(browser, admin, accountNumber);

    await page.reload(); // force a fresh mount instead of waiting on the 60s poll
    await expect(badge(page)).toBeVisible({ timeout: NAV_TIMEOUT });

    await bell(page).click();
    await expect(page.getByText('Account opening approved')).toBeVisible({ timeout: NAV_TIMEOUT });

    // Opening the panel marked everything read -> badge clears, but the item
    // itself is kept (no delete) — still there on a later re-open.
    await page.mouse.click(10, 10); // click outside the panel to close it
    await page.reload();
    await expect(badge(page)).toHaveCount(0);
    await bell(page).click();
    await expect(page.getByText('Account opening approved')).toBeVisible({ timeout: NAV_TIMEOUT });
  });

  test('admin-suspending the user sends the "Account suspended" alert email', async ({ page, browser }) => {
    const superadmin = getSuperadmin();
    const admin = await createAdminUser(browser, superadmin);
    const user = await onboardCustomerWithActiveAccount(page, browser, admin);

    const adminCtx = await browser.newContext({ ignoreHTTPSErrors: true });
    const adminPage = await adminCtx.newPage();
    await login(adminPage, admin.email, admin.password, admin.secret);
    await adminPage.getByPlaceholder('Search by name, email, or NRIC...').fill(user.email);
    const row = adminPage.locator('tr', { hasText: user.email });
    await expect(row).toBeVisible({ timeout: NAV_TIMEOUT });
    await row.getByRole('button', { name: 'Suspend' }).click();
    await promptReasonModal(adminPage, 'e2e notification check');
    await expectToast(adminPage, 'success');
    await adminCtx.close();

    // The suspension revokes the customer's own session server-side (FR-08),
    // so the in-app bell can't be observed afterward — the alert email is the
    // channel this test can actually verify.
    const emailMsg = await waitForEmail(user.email, { subjectContains: 'suspended' });
    expect(emailMsg.Subject.toLowerCase()).toContain('suspended');
  });
});
