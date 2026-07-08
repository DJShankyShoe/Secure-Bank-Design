// FR-08 (admin scope): customers can't reach the console, the admin directory
// is customer-only, acting on a non-customer target 404s (hides existence),
// and the admin audit view withholds staff-to-staff activity.
import { test, expect } from '@playwright/test';
import {
  NAV_TIMEOUT,
  apiGet,
  apiPost,
  createAdminUser,
  getSuperadmin,
  login,
  onboardCustomer,
} from '../fixtures/helpers.js';

test.describe('Admin RBAC (customer oversight only)', () => {
  test('a customer session cannot reach the admin console', async ({ page }) => {
    await onboardCustomer(page);
    await page.goto('/console/users');
    // App.jsx's /console/* guard redirects a wrong-role (but still
    // authenticated) session to /login, but /login's OWN route then
    // immediately re-redirects an already-authenticated user to their role's
    // home — so the customer ends up back on /dashboard, not stuck on /login.
    await expect(page).toHaveURL(/\/dashboard$/, { timeout: NAV_TIMEOUT });
  });

  test('the admin user directory excludes admins/superadmins', async ({ page, browser }) => {
    const superadmin = getSuperadmin();
    const admin1 = await createAdminUser(browser, superadmin);
    const admin2 = await createAdminUser(browser, superadmin);

    await login(page, admin1.email, admin1.password, admin1.secret);
    const res = await apiGet(page, `/admin/users?q=${encodeURIComponent(admin2.email)}`);
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.users.some((u) => u.email === admin2.email)).toBe(false);
  });

  test('an admin acting on a non-customer (another admin) target gets a hiding 404', async ({ page, browser }) => {
    const superadmin = getSuperadmin();
    const admin1 = await createAdminUser(browser, superadmin);
    const admin2 = await createAdminUser(browser, superadmin);

    // Learn admin2's id from the ONE view that legitimately shows it: the
    // superadmin's full directory. The admin's own UI never exposes it
    // (previous test) — this is the only way to get an id to attempt against.
    const saCtx = await browser.newContext({ ignoreHTTPSErrors: true });
    const saPage = await saCtx.newPage();
    await login(saPage, superadmin.email, superadmin.password, superadmin.secret);
    const dirRes = await apiGet(saPage, `/superadmin/users?q=${encodeURIComponent(admin2.email)}`);
    const dirBody = await dirRes.json();
    const admin2Id = dirBody.users.find((u) => u.email === admin2.email).user_id;
    await saCtx.close();

    await login(page, admin1.email, admin1.password, admin1.secret);
    const res = await apiPost(page, `/admin/users/${admin2Id}/suspend`, { reason: 'e2e probe' });
    expect(res.status()).toBe(404);
  });

  test('admin audit view withholds a superadmin login (customer-scoped)', async ({ page, browser }) => {
    // A raw event-count comparison would be flaky here: the suite runs many
    // specs in parallel, all logging customers in/out against the same
    // LOGIN_SUCCESS bucket. Instead, check for the absence of THIS specific,
    // uniquely-named actor — robust regardless of concurrent test noise.
    const superadmin = getSuperadmin();
    const admin = await createAdminUser(browser, superadmin);

    const saCtx = await browser.newContext({ ignoreHTTPSErrors: true });
    const saPage = await saCtx.newPage();
    await login(saPage, superadmin.email, superadmin.password, superadmin.secret);
    await saCtx.close();

    await login(page, admin.email, admin.password, admin.secret);
    const res = await apiGet(page, '/admin/audit?type=LOGIN_SUCCESS');
    const items = (await res.json()).items;
    expect(items.some((e) => e.actor_name === 'E2E Bootstrap Superadmin')).toBe(false);
  });
});
