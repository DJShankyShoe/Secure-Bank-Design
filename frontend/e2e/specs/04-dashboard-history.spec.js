// FR-03: dashboard balances/account list (incl. the suspended-tag and closed-
// account-exclusion fixes from this session) and transaction history filters.
import { test, expect } from '@playwright/test';
import {
  NAV_TIMEOUT,
  NEW_CONTEXT_OPTS,
  createAdminUser,
  expectToast,
  fieldByLabel,
  getSuperadmin,
  login,
  onboardCustomerWithActiveAccount,
  onboardCustomerWithFundedAccount,
  openApprovedAccount,
  performTransfer,
  promptReasonModal,
  selectOptionContainingText,
} from '../fixtures/helpers.js';

test.describe('Dashboard and transaction history', () => {
  test('dashboard lists per-account balances and marks a suspended account', async ({ page, browser }) => {
    const superadmin = getSuperadmin();
    const admin = await createAdminUser(browser, superadmin);
    const user = await onboardCustomerWithActiveAccount(page, browser, admin);

    await page.goto('/dashboard');
    await expect(page.getByText(user.accountNumber)).toBeVisible();
    await expect(page.locator('.tag.warning', { hasText: 'Suspended' })).toHaveCount(0);

    // Admin suspends this specific account (not the user) via the directory.
    const adminCtx = await browser.newContext(NEW_CONTEXT_OPTS);
    const adminPage = await adminCtx.newPage();
    await login(adminPage, admin.email, admin.password, admin.secret);
    await adminPage.goto('/console/users');
    await adminPage.getByPlaceholder('Search by name, email, or NRIC...').fill(user.email);
    const row = adminPage.locator('tr', { hasText: user.email });
    await row.locator('button', { hasText: /^[▶▼]$/ }).click();
    // The outer expandable row also contains this text (its cell holds the
    // ENTIRE nested accounts table), so a plain hasText match is ambiguous —
    // .last() picks the innermost (nested, more specific) row.
    const acctRow = adminPage.locator('tr', { hasText: user.accountNumber }).last();
    await expect(acctRow).toBeVisible({ timeout: NAV_TIMEOUT });
    await acctRow.getByRole('button', { name: 'Suspend' }).click();
    await promptReasonModal(adminPage, 'e2e: suspicious activity');
    await expectToast(adminPage, 'success');
    await adminCtx.close();

    await page.goto('/dashboard');
    await expect(page.locator('.tag.warning', { hasText: 'Suspended' })).toBeVisible({ timeout: NAV_TIMEOUT });
  });

  test('dashboard "Accounts" metric only counts active accounts', async ({ page, browser }) => {
    const superadmin = getSuperadmin();
    const admin = await createAdminUser(browser, superadmin);
    const user = await onboardCustomerWithActiveAccount(page, browser, admin);
    await page.goto('/dashboard');
    const metricCard = page.locator('.metric-card', { hasText: 'Accounts' }).locator('.metric-value');
    await expect(metricCard).not.toHaveText('Loading...', { timeout: NAV_TIMEOUT });
    expect((await metricCard.textContent()).trim()).toBe('1');

    // A second (still pending) opening request must not inflate the count.
    await page.goto('/account');
    await page.getByRole('button', { name: 'Request Account Opening' }).click();
    await expectToast(page, 'success');
    await page.goto('/dashboard');
    await expect(metricCard).not.toHaveText('Loading...', { timeout: NAV_TIMEOUT });
    const metricAfter = await metricCard.textContent();
    expect(metricAfter.trim()).toBe('1');
  });

  test('transaction history shows a completed transfer and the type filter narrows results', async ({ page, browser }) => {
    const superadmin = getSuperadmin();
    const admin = await createAdminUser(browser, superadmin);
    // A freshly opened account always starts at balance_cents=0 (no in-app
    // deposit/top-up feature at all) — fund it directly so this transfer has
    // something to move (fixtures/db.js; see 06-transfer.spec.js for the
    // same pattern).
    const user = await onboardCustomerWithFundedAccount(page, browser, admin, 5_000);
    const secondAccount = await openApprovedAccount(page, browser, admin, 'current');

    await performTransfer(page, {
      sourceAccountNumber: user.accountNumber,
      destinationAccountNumber: secondAccount,
      amount: '25.00',
      destinationType: 'Own account',
      reference: 'e2e history fixture',
    });
    await expectToast(page, 'success');

    await page.goto('/history');
    // The <option> value is the account's UUID; only its visible text is the number.
    await selectOptionContainingText(page, 'Account', user.accountNumber);
    await expect(page.getByText('transfer', { exact: false }).first()).toBeVisible({ timeout: NAV_TIMEOUT });

    await fieldByLabel(page, 'Transaction Type').locator('select').selectOption('bill_payment');
    await page.getByRole('button', { name: 'Apply Filters' }).click();
    await expect(page.getByText('No transactions found matching your criteria.')).toBeVisible({ timeout: NAV_TIMEOUT });
  });
});
