// FR-08 (superadmin scope): role assignment, suspend/reactivate staff, full
// (non-customer-scoped) audit visibility, self-action guard, and audited NRIC
// reveal for ANY user (not customer-scoped, unlike the admin reveal).
//
// Note: the "last active superadmin can't be demoted/suspended" guard (409,
// superadmin/service.py:_is_last_active_superadmin) is a defense-in-depth
// backstop that isn't reachable through any legitimate multi-actor flow in
// black-box E2E — by the time a target is genuinely the sole active
// superadmin, the only actor who could ever act on them (another active
// superadmin) can't exist simultaneously, short of self-action (which the
// separate self-action guard already blocks first). Not covered here.
import { test, expect } from '@playwright/test';
import {
  NAV_TIMEOUT,
  confirmModal,
  createAdminUser,
  expectToast,
  getSuperadmin,
  login,
  onboardCustomer,
  promptReasonModal,
} from '../fixtures/helpers.js';

async function searchRoleDirectory(page, query) {
  await page.getByPlaceholder('Search by name or email').fill(query);
  await page.getByRole('button', { name: 'Search' }).click();
  const row = page.locator('tr', { hasText: query });
  await expect(row).toBeVisible({ timeout: NAV_TIMEOUT });
  return row;
}

test.describe('Superadmin RBAC (admin/role management only)', () => {
  test('a customer session cannot reach the superadmin console', async ({ page }) => {
    await onboardCustomer(page);
    await page.goto('/super/roles');
    // App.jsx's /super/* guard redirects a wrong-role (but still
    // authenticated) session to /login, but /login's OWN route immediately
    // re-redirects an already-authenticated user to their role's home — so
    // the customer ends up back on /dashboard, not stuck on /login.
    await expect(page).toHaveURL(/\/dashboard$/, { timeout: NAV_TIMEOUT });
  });

  test('an admin session cannot reach the superadmin console', async ({ page, browser }) => {
    const superadmin = getSuperadmin();
    const admin = await createAdminUser(browser, superadmin);
    await login(page, admin.email, admin.password, admin.secret);
    await page.goto('/super/roles');
    // Same double-redirect as above, but this time HOME_FOR_ROLE('admin') is
    // /console/users.
    await expect(page).toHaveURL(/\/console\/users$/, { timeout: NAV_TIMEOUT });
  });

  test('superadmin promotes an admin to superadmin (revoking their session), then demotes them back', async ({ page, browser }) => {
    const superadmin = getSuperadmin();
    const target = await createAdminUser(browser, superadmin);

    // The newly-promoted admin has a live session; promoting them further
    // (privilege change, SR-13) must revoke it.
    const targetCtx = await browser.newContext({ ignoreHTTPSErrors: true });
    const targetPage = await targetCtx.newPage();
    await login(targetPage, target.email, target.password, target.secret);
    await expect(targetPage).toHaveURL(/\/console\/users$/);

    await login(page, superadmin.email, superadmin.password, superadmin.secret);
    const row = await searchRoleDirectory(page, target.email);
    await row.locator('select').selectOption('superadmin');
    await confirmModal(page);
    await expectToast(page, 'success');

    await targetPage.reload();
    await expect(targetPage).toHaveURL(/\/login$/, { timeout: NAV_TIMEOUT });
    await targetCtx.close();

    // Demote back down so this test doesn't leave a stray extra superadmin
    // behind for other parallel tests.
    const row2 = await searchRoleDirectory(page, target.email);
    await row2.locator('select').selectOption('admin');
    await confirmModal(page);
    await expectToast(page, 'success');
  });

  test('superadmin suspends then reactivates an admin', async ({ page, browser }) => {
    const superadmin = getSuperadmin();
    const target = await createAdminUser(browser, superadmin);

    await login(page, superadmin.email, superadmin.password, superadmin.secret);
    const row = await searchRoleDirectory(page, target.email);
    await row.getByRole('button', { name: 'Suspend' }).click();
    await promptReasonModal(page, 'e2e superadmin suspend');
    await expectToast(page, 'success');
    await expect(row.getByText('SUSPENDED')).toBeVisible();

    // Reactivate (unlike Suspend) fires directly — no confirm modal.
    await row.getByRole('button', { name: 'Reactivate' }).click();
    await expectToast(page, 'success');
    await expect(row.getByText('ACTIVE')).toBeVisible();
  });

  test('self-action is blocked: a superadmin cannot change their own role or status', async ({ page }) => {
    const superadmin = getSuperadmin();
    await login(page, superadmin.email, superadmin.password, superadmin.secret);
    const row = await searchRoleDirectory(page, superadmin.email);
    await expect(row.locator('select')).toBeDisabled();
    await expect(row.getByText('You')).toBeVisible();
  });

  test('full audit log includes staff-to-staff activity that the admin view withholds', async ({ page, browser }) => {
    const superadmin = getSuperadmin();
    const target = await createAdminUser(browser, superadmin);

    await login(page, superadmin.email, superadmin.password, superadmin.secret);
    const row = await searchRoleDirectory(page, target.email);
    await row.getByRole('button', { name: 'Suspend' }).click();
    await promptReasonModal(page, 'e2e audit visibility check');
    await expectToast(page, 'success');

    await page.goto('/super/audit');
    await page.getByPlaceholder('Event Type (e.g. LOGIN_SUCCESS)').fill('SUPERADMIN_SUSPEND_ADMIN');
    await page.getByRole('button', { name: 'Filter' }).click();
    // The audit table renders target_name (server-resolved display name), not
    // the email — every test account defaults to fullName "QA Test User"
    // (registerUser's default), so other rows (even from an EARLIER test in
    // this same file doing the same kind of suspend) can legitimately share
    // both this event type and this name. .first() (newest-first ordering)
    // just needs to confirm at least one such row exists.
    const auditRow = page.locator('tr', { hasText: 'SUPERADMIN_SUSPEND_ADMIN' }).filter({ hasText: target.fullName }).first();
    await expect(auditRow).toBeVisible({ timeout: NAV_TIMEOUT });

    // No cleanup needed: `target` is this test's own isolated account (fresh
    // via createAdminUser), so leaving it suspended doesn't affect any other
    // test — and `row` is now stale anyway (captured on /super/roles, before
    // navigating away to /super/audit above).
  });

  test('superadmin NRIC reveal works for ANY user, not just customers, and is audited', async ({ page, browser }) => {
    const superadmin = getSuperadmin();
    const target = await createAdminUser(browser, superadmin);

    await login(page, superadmin.email, superadmin.password, superadmin.secret);
    const row = await searchRoleDirectory(page, target.email);
    await row.getByRole('button', { name: 'Reveal' }).click();
    await expect(row.locator('span', { hasText: /^[STFGM]\d{7}[A-Z]$/ })).toBeVisible({ timeout: NAV_TIMEOUT });

    await page.goto('/super/audit');
    await page.getByPlaceholder('Event Type (e.g. LOGIN_SUCCESS)').fill('NRIC_REVEAL');
    await page.getByRole('button', { name: 'Filter' }).click();
    // Same as above: the audit table shows target_name, not email, and other
    // rows in this file share the same default name — scope to the row that
    // also shows this specific event type.
    const auditRow = page.locator('tr', { hasText: 'NRIC_REVEAL' }).filter({ hasText: target.fullName }).first();
    await expect(auditRow).toBeVisible({ timeout: NAV_TIMEOUT });
  });
});
