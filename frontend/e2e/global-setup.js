import { chromium } from '@playwright/test';
import fs from 'node:fs';
import {
  AUTH_DIR,
  STRONG_PASSWORD,
  SUPERADMIN_FILE,
  login,
  registerAndActivate,
  uniqueEmail,
  uniqueNric,
} from './fixtures/helpers.js';

/**
 * Runs once before the whole suite. FR-08: the first-ever account in an empty
 * `users` table is auto-bootstrapped as superadmin — that can only happen
 * once per database lifetime, so it MUST happen here (single-threaded, before
 * any parallel spec can register an account and race it) rather than in any
 * individual spec. Every spec needing an admin/superadmin reads the resulting
 * credentials via helpers.getSuperadmin().
 */
export default async function globalSetup() {
  const baseURL = process.env.PW_BASE_URL || 'https://localhost:5173';
  fs.mkdirSync(AUTH_DIR, { recursive: true });

  const browser = await chromium.launch();
  const context = await browser.newContext({ baseURL, ignoreHTTPSErrors: true });
  const page = await context.newPage();

  const superadmin = await registerAndActivate(page, {
    fullName: 'QA Bootstrap Superadmin',
    nric: uniqueNric(),
    email: uniqueEmail('superadmin'),
    password: STRONG_PASSWORD,
  });

  await login(page, superadmin.email, superadmin.password, superadmin.secret);
  try {
    await page.waitForURL('**/super/roles', { timeout: 15_000 });
  } catch {
    throw new Error(
      `Bootstrap account did not land on /super/roles (got ${page.url()} instead). ` +
      'This suite requires a completely EMPTY database — FR-08 only auto-promotes ' +
      'the first-ever registered account to superadmin. Point PW_BASE_URL/the backend ' +
      'at a fresh database, not one with pre-existing users.'
    );
  }

  fs.writeFileSync(SUPERADMIN_FILE, JSON.stringify(superadmin, null, 2));
  await browser.close();
}
