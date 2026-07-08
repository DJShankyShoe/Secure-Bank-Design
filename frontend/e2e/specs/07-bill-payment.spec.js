// FR-07: pay a registered (allowlisted) biller, insufficient balance rejected
// before execution. Billers are seeded by sql/06_seed_billers.sql, not
// created through the app (biller catalogue is config, not user input).
import { test, expect } from '@playwright/test';
import {
  NAV_TIMEOUT,
  createAdminUser,
  expectToast,
  getSuperadmin,
  onboardCustomerWithFundedAccount,
  performBillPayment,
} from '../fixtures/helpers.js';

test.describe('Bill payment', () => {
  test('pay a registered biller from a funded account succeeds', async ({ page, browser }) => {
    const superadmin = getSuperadmin();
    const admin = await createAdminUser(browser, superadmin);
    const user = await onboardCustomerWithFundedAccount(page, browser, admin, 50_000); // SGD 500

    await performBillPayment(page, {
      billerName: 'Singtel',
      sourceAccountNumber: user.accountNumber,
      amount: '88.80',
    });
    await expectToast(page, 'success');

    await page.goto('/history');
    await expect(page.getByText('bill_payment', { exact: false }).first()).toBeVisible({ timeout: NAV_TIMEOUT });
  });

  test('insufficient balance is rejected before execution (no partial state)', async ({ page, browser }) => {
    const superadmin = getSuperadmin();
    const admin = await createAdminUser(browser, superadmin);
    const user = await onboardCustomerWithFundedAccount(page, browser, admin, 500); // SGD 5

    await performBillPayment(page, {
      billerName: 'Singtel',
      sourceAccountNumber: user.accountNumber,
      amount: '200.00',
    });
    await expectToast(page, 'error');

    // No partial state: the failed payment must not appear in history.
    await page.goto('/history');
    await expect(page.getByText('bill_payment', { exact: false })).toHaveCount(0);
  });
});
