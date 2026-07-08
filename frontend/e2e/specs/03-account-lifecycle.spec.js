// FR-02 (account opening, admin-approved) and FR-05 (customer-requested
// closure, admin-approved) — the full request/approve/reject lifecycle.
//
// Note: the README documents an "admin direct close" endpoint
// (POST /admin/accounts/{id}/close), but Admin/Users.jsx's account actions
// only expose Suspend/Reactivate — there is no "Close" button in the UI to
// drive, so that path isn't covered here (nothing to click).
import { test, expect } from '@playwright/test';
import {
  apiPost,
  approveAccountClosure,
  approveAccountOpening,
  createAdminUser,
  fieldByLabel,
  getSuperadmin,
  onboardCustomer,
  rejectAccountClosure,
  rejectAccountOpening,
  requestAccountOpening,
  selectField,
  selectOptionContainingText,
} from '../fixtures/helpers.js';
import { freshTotp } from '../fixtures/totp.js';

async function requestClosure(page, accountNumber, secret) {
  await page.goto('/account');
  await selectOptionContainingText(page, 'Select Account to Close', accountNumber);
  const code = await freshTotp(secret);
  await fieldByLabel(page, 'Authenticator Code (TOTP)').locator('input').fill(code);
  await page.getByRole('button', { name: 'Request Closure' }).click();
  await expect(page.locator('.toast--success')).toBeVisible();
}

test.describe('Account open/close lifecycle', () => {
  test('only one opening request may be pending at a time (409)', async ({ page }) => {
    await onboardCustomer(page);
    await requestAccountOpening(page, 'savings');

    // Manage.jsx hides the "open an account" form entirely once a request is
    // pending (shows only the inline note instead) — there's deliberately no
    // UI path left to attempt a second request, so this exercises the API
    // directly, the same way a replayed/raced client request would.
    const res = await apiPost(page, '/accounts', { account_type: 'current' });
    expect(res.status()).toBe(409);
  });

  test('admin approves an opening request -> account becomes active and usable', async ({ page, browser }) => {
    const superadmin = getSuperadmin();
    const admin = await createAdminUser(browser, superadmin);
    await onboardCustomer(page);
    const accountNumber = await requestAccountOpening(page);

    await approveAccountOpening(browser, admin, accountNumber);

    await page.goto('/dashboard');
    await expect(page.getByText(accountNumber)).toBeVisible({ timeout: 10_000 });
    await page.goto('/account');
    await expect(page.getByText(/awaiting admin approval/)).toHaveCount(0);
  });

  test('admin rejects an opening request -> account is closed, customer can request again', async ({ page, browser }) => {
    const superadmin = getSuperadmin();
    const admin = await createAdminUser(browser, superadmin);
    await onboardCustomer(page);
    const accountNumber = await requestAccountOpening(page);

    await rejectAccountOpening(browser, admin, accountNumber, 'e2e: incomplete KYC');

    await page.goto('/account');
    await expect(page.getByText(/awaiting admin approval/)).toHaveCount(0);
    // Free to request again.
    await selectField(page, 'Account Type', 'savings');
    await page.getByRole('button', { name: 'Request Account Opening' }).click();
    await expect(page.locator('.toast--success')).toBeVisible();
  });

  test('customer closure request (zero balance + TOTP) then admin approves -> closed', async ({ page, browser }) => {
    const superadmin = getSuperadmin();
    const admin = await createAdminUser(browser, superadmin);
    const user = await onboardCustomer(page);
    const accountNumber = await requestAccountOpening(page);
    await approveAccountOpening(browser, admin, accountNumber);

    await requestClosure(page, accountNumber, user.secret);
    await approveAccountClosure(browser, admin, accountNumber);

    await page.goto('/account');
    // Closed accounts drop out of the "select to close" list entirely.
    await expect(
      fieldByLabel(page, 'Select Account to Close').locator('option', { hasText: accountNumber })
    ).toHaveCount(0);
  });

  test('admin rejects a closure request -> account goes back to active', async ({ page, browser }) => {
    const superadmin = getSuperadmin();
    const admin = await createAdminUser(browser, superadmin);
    const user = await onboardCustomer(page);
    const accountNumber = await requestAccountOpening(page);
    await approveAccountOpening(browser, admin, accountNumber);

    await requestClosure(page, accountNumber, user.secret);
    await rejectAccountClosure(browser, admin, accountNumber, 'e2e: outstanding dispute');

    // Reactivated -> selectable to close again (still exists, active).
    await page.goto('/account');
    await expect(
      fieldByLabel(page, 'Select Account to Close').locator('option', { hasText: accountNumber })
    ).toHaveCount(1);
  });
});
