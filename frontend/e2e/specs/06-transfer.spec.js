// FR-06 (fund transfer, atomic) + SR-12 (PIN step-up at/above SGD 1,000) +
// SR-08 (idempotency). Own-account transfers are used throughout since they
// need only one customer's two accounts, both fundable via fixtures/db.js.
import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import {
  DEFAULT_PIN,
  apiPost,
  createAdminUser,
  expectToast,
  getSuperadmin,
  onboardCustomerWithFundedAccount,
  openApprovedAccount,
  openApprovedFundedAccount,
  performTransfer,
} from '../fixtures/helpers.js';

test.describe('Fund transfer', () => {
  test('transfer below SGD 1,000 needs no PIN and succeeds', async ({ page, browser }) => {
    const superadmin = getSuperadmin();
    const admin = await createAdminUser(browser, superadmin);
    const user = await onboardCustomerWithFundedAccount(page, browser, admin, 50_000); // SGD 500
    const dest = await openApprovedAccount(page, browser, admin, 'current');

    // No `pin` passed — if the backend required one and didn't get it, this
    // would come back 403, not a success toast (SR-12 threshold is >= 1,000).
    await performTransfer(page, {
      sourceAccountNumber: user.accountNumber,
      destinationAccountNumber: dest,
      amount: '100.00',
      destinationType: 'Own account',
    });
    await expectToast(page, 'success');
  });

  test('transfer at/above SGD 1,000 requires the PIN; correct PIN succeeds', async ({ page, browser }) => {
    const superadmin = getSuperadmin();
    const admin = await createAdminUser(browser, superadmin);
    const user = await onboardCustomerWithFundedAccount(page, browser, admin, 500_000); // SGD 5000
    const dest = await openApprovedAccount(page, browser, admin, 'current');

    await performTransfer(page, {
      sourceAccountNumber: user.accountNumber,
      destinationAccountNumber: dest,
      amount: '1000.00',
      destinationType: 'Own account',
      pin: DEFAULT_PIN,
    });
    await expectToast(page, 'success');
  });

  test('wrong PIN is rejected on a high-value transfer', async ({ page, browser }) => {
    const superadmin = getSuperadmin();
    const admin = await createAdminUser(browser, superadmin);
    const user = await onboardCustomerWithFundedAccount(page, browser, admin, 500_000);
    const dest = await openApprovedAccount(page, browser, admin, 'current');

    await performTransfer(page, {
      sourceAccountNumber: user.accountNumber,
      destinationAccountNumber: dest,
      amount: '1500.00',
      destinationType: 'Own account',
      pin: '000000',
    });
    await expectToast(page, 'error');
  });

  test('insufficient balance is rejected before execution', async ({ page, browser }) => {
    const superadmin = getSuperadmin();
    const admin = await createAdminUser(browser, superadmin);
    const user = await onboardCustomerWithFundedAccount(page, browser, admin, 1_000); // SGD 10
    const dest = await openApprovedAccount(page, browser, admin, 'current');

    await performTransfer(page, {
      sourceAccountNumber: user.accountNumber,
      destinationAccountNumber: dest,
      amount: '500.00',
      destinationType: 'Own account',
    });
    await expectToast(page, 'error');
  });

  test('idempotency: replaying the same key returns the original result; a changed body 409s (SR-08)', async ({ page, browser }) => {
    const superadmin = getSuperadmin();
    const admin = await createAdminUser(browser, superadmin);
    const user = await onboardCustomerWithFundedAccount(page, browser, admin, 100_000); // SGD 1000
    const dest = await openApprovedFundedAccount(page, browser, admin, 0, 'current');

    await page.goto('/dashboard'); // any authenticated page, so apiPost has a Referer + session to reuse
    const idempotencyKey = randomUUID();
    const idempotencyHeader = { 'Idempotency-Key': idempotencyKey };
    const body = {
      source_account_number: user.accountNumber,
      destination_account_number: dest,
      amount_cents: 5000,
    };

    const first = await apiPost(page, '/transactions/transfer', body, idempotencyHeader);
    expect(first.status()).toBe(201);
    const firstJson = await first.json();

    const replay = await apiPost(page, '/transactions/transfer', body, idempotencyHeader);
    expect(replay.status()).toBe(201);
    const replayJson = await replay.json();
    expect(replayJson.transaction_id).toBe(firstJson.transaction_id);

    const conflict = await apiPost(page, '/transactions/transfer', { ...body, amount_cents: 9999 }, idempotencyHeader);
    expect(conflict.status()).toBe(409);
  });
});
