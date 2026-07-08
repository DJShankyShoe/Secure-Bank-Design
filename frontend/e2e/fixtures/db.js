// Test-fixture-only DB access, via the `psql` CLI (already a required part of
// this project's Postgres tooling — no new npm dependency). Used for exactly
// one thing: funding a test account's balance. The app has no in-app deposit/
// top-up feature anywhere in its FRs, so a freshly opened account (always
// balance_cents=0) can otherwise never move money at all — there is no UI
// path to reach that precondition. This never substitutes for driving the
// actual feature under test (transfer/bill-payment) through the real UI.
import { execFileSync } from 'node:child_process';

const PGHOST = process.env.PW_PGHOST || '127.0.0.1';
const PGPORT = process.env.PW_PGPORT || '5432';
const PGUSER = process.env.PW_PGUSER || 'app_user';
const PGPASSWORD = process.env.PW_PGPASSWORD || 'app_pw';
const PGDATABASE = process.env.PW_PGDATABASE || 'securebank_e2e';

/** Directly set an account's balance (test setup only — see file header). */
export function fundAccount(accountNumber, amountCents) {
  if (!/^\d{10}$/.test(String(accountNumber))) {
    throw new Error(`fundAccount: not a valid 10-digit account number: ${accountNumber}`);
  }
  if (!Number.isInteger(amountCents) || amountCents < 0) {
    throw new Error(`fundAccount: amountCents must be a non-negative integer: ${amountCents}`);
  }
  execFileSync(
    'psql',
    [
      '-h', PGHOST, '-p', PGPORT, '-U', PGUSER, '-d', PGDATABASE,
      '-v', 'ON_ERROR_STOP=1', '-q',
      '-c', `UPDATE application.accounts SET balance_cents = ${amountCents} ` +
            `WHERE account_number = '${accountNumber}';`,
    ],
    { env: { ...process.env, PGPASSWORD }, stdio: 'pipe' }
  );
}
