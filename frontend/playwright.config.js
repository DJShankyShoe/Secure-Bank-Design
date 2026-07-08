import { defineConfig, devices } from '@playwright/test';

// E2E suite against the real Flask backend + Postgres + a Mailpit SMTP catcher
// (see e2e/fixtures/mailbox.js). baseURL matches local dev's basicSsl-backed Vite
// server (Secure cookies need HTTPS even in dev — see vite.config.js). In CI the
// frontend/backend/mailpit are started as explicit workflow steps before this
// runs (see .github/workflows/e2e-playwright.yml); reuseExistingServer lets this
// config's own webServer stay a no-op there while still auto-starting the dev
// server for a local `npm run test:e2e`.
export default defineConfig({
  testDir: './e2e/specs',
  // Generous: the backend's TOTP replay protection (security/mfa.py — a code's
  // 30s time-step must be strictly newer than the last one an account
  // consumed) means a test that logs the SAME account in twice back-to-back
  // can legitimately need to wait out a whole 30s window each time (see
  // fixtures/totp.js::freshTotp). Two such logins in one test is ~60s alone.
  // Also needs headroom for fixtures/helpers.js's NAV_TIMEOUT (120s) — a test
  // chaining several post-action navigation waits (e.g. createAdminUser's
  // register -> TOTP -> verify-email -> login) could otherwise hit this
  // ceiling before any individual wait does, under sustained CI load.
  timeout: 360_000,
  expect: { timeout: 10_000 },
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  // Matched to the backend's gunicorn --workers 3 in e2e-playwright.yml — each
  // gunicorn worker holds its own connection pools (3 engines x pool_size 10,
  // hard-capped via max_overflow=0), so worker count on both sides must stay in
  // lockstep: too many Playwright workers per too few gunicorn workers queues
  // requests behind Argon2id's deliberately-expensive hash and starts timing
  // out page.waitForURL() calls; too many gunicorn workers risks exceeding
  // Postgres's default max_connections (100) under concurrent load.
  workers: process.env.CI ? 3 : undefined,
  // CI runs sharded across 4 jobs (see .github/workflows/e2e-playwright.yml);
  // 'blob' emits one small per-shard result bundle (no HTML/assets) that the
  // workflow's merge-reports job stitches into a single browsable HTML report
  // afterward — sharding + html reporters together produce report name
  // collisions, which is why CI no longer generates html directly.
  reporter: process.env.CI
    ? [['list'], ['blob']]
    : 'list',
  globalSetup: './e2e/global-setup.js',
  use: {
    baseURL: process.env.PW_BASE_URL || 'https://localhost:5173',
    ignoreHTTPSErrors: true,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
  webServer: {
    command: 'npm run dev',
    url: process.env.PW_BASE_URL || 'https://localhost:5173',
    ignoreHTTPSErrors: true,
    reuseExistingServer: true,
    timeout: 30_000,
  },
});
