// RFC 6238 TOTP code generation, matching the backend's pyotp defaults (SHA1,
// 30s step, 6 digits — see backend/app/security/mfa.py). Written by hand against
// Node's built-in crypto so the E2E suite adds no new npm dependency.
import { createHmac } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function base32Decode(input) {
  const clean = input.toUpperCase().replace(/=+$/, '').replace(/\s/g, '');
  let bits = '';
  for (const char of clean) {
    const idx = BASE32_ALPHABET.indexOf(char);
    if (idx === -1) throw new Error(`Invalid base32 character: ${char}`);
    bits += idx.toString(2).padStart(5, '0');
  }
  const bytes = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) {
    bytes.push(parseInt(bits.slice(i, i + 8), 2));
  }
  return Buffer.from(bytes);
}

/** Return the current 6-digit TOTP code for a base32 secret (30s step, SHA1). */
export function totp(secret, forTimeMs = Date.now()) {
  const key = base32Decode(secret);
  const counter = Math.floor(forTimeMs / 1000 / 30);
  const counterBuf = Buffer.alloc(8);
  counterBuf.writeUInt32BE(0, 0);
  counterBuf.writeUInt32BE(counter, 4);

  const hmac = createHmac('sha1', key).update(counterBuf).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const binary =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);
  const code = binary % 1_000_000;
  return String(code).padStart(6, '0');
}

/** Pull the base32 `secret` query param out of an otpauth:// provisioning URI. */
export function secretFromUri(uri) {
  const url = new URL(uri);
  const secret = url.searchParams.get('secret');
  if (!secret) throw new Error(`No secret param in provisioning URI: ${uri}`);
  return secret;
}

// The backend enforces single-use replay protection per account
// (User.last_totp_timestep, security/mfa.py::verify_totp): a code is accepted
// only if its 30s time-step is STRICTLY NEWER than the last step that account
// consumed — even a numerically-correct code is rejected as "Invalid
// credentials" if it lands in an already-used (or earlier) step. Any test that
// logs the same account in more than once (e.g. logout -> log back in) can
// easily land two calls in the same 30s window, so track the last step handed
// out per secret and always advance past it.
//
// Persisted to disk, not just an in-memory Map: the bootstrap superadmin
// account (fixtures/helpers.js::getSuperadmin) is logged into from MANY
// separate OS processes — e2e/global-setup.js runs in its own process before
// any test worker starts, and every worker that calls createAdminUser() logs
// the same superadmin in again. An in-memory-only map is invisible across
// those processes, so a worker's "first" superadmin login can easily collide
// with a step global-setup already consumed moments earlier and get rejected
// as a replay. A shared file makes the tracking process-independent.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STEP_FILE = path.join(__dirname, '..', '.auth', 'totp-steps.json');
const LOCK_FILE = `${STEP_FILE}.lock`;
const STALE_LOCK_MS = 10_000; // a crashed process must never wedge every worker forever

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// Plain read-then-write on STEP_FILE is NOT atomic across the several OS
// processes sharing it (global-setup.js + every test worker), so two workers
// can both read the same lastStep, both independently compute the SAME "next
// free" step, and both submit that code to the server — the backend's
// single-use replay protection (security/mfa.py) then accepts whichever
// arrives first and rejects the other as a replay, and since there is no
// retry on that specific rejection, the loser's login() just waits forever
// for a navigation that will never come (surfacing as an E2E timeout that no
// amount of raising the timeout or tuning worker counts actually fixes).
// fs.openSync(..., 'wx') is an atomic exclusive-create, making it usable as a
// cross-process mutex with no extra dependency (same "no new npm dependency"
// constraint as the rest of this file).
async function withLock(fn) {
  fs.mkdirSync(path.dirname(LOCK_FILE), { recursive: true });
  for (;;) {
    try {
      const fd = fs.openSync(LOCK_FILE, 'wx');
      fs.closeSync(fd);
      break;
    } catch (err) {
      if (err.code !== 'EEXIST') throw err;
      try {
        if (Date.now() - fs.statSync(LOCK_FILE).mtimeMs > STALE_LOCK_MS) {
          fs.rmSync(LOCK_FILE, { force: true }); // holder almost certainly crashed
          continue;
        }
      } catch {
        // Lock file vanished between the failed open and this stat — retry.
      }
      await sleep(20 + Math.random() * 30);
    }
  }
  try {
    return fn();
  } finally {
    fs.rmSync(LOCK_FILE, { force: true });
  }
}

function readPersistedStep(secret) {
  try {
    const steps = JSON.parse(fs.readFileSync(STEP_FILE, 'utf-8'));
    return steps[secret] ?? -1;
  } catch {
    return -1;
  }
}

function writePersistedStep(secret, step) {
  let steps = {};
  try {
    steps = JSON.parse(fs.readFileSync(STEP_FILE, 'utf-8'));
  } catch {
    // First write, or file doesn't exist yet.
  }
  steps[secret] = step;
  fs.mkdirSync(path.dirname(STEP_FILE), { recursive: true });
  fs.writeFileSync(STEP_FILE, JSON.stringify(steps));
}

/**
 * A fresh, not-yet-consumed TOTP code for `secret`. Waits out both: (a) being
 * too close to a 30s boundary to survive the round-trip to the server, and
 * (b) landing on a time-step already used by an earlier call for this same
 * secret, anywhere in the suite (the account-level replay protection above).
 *
 * The wait itself happens OUTSIDE the lock (it can take up to ~30s, and
 * holding the lock that long would serialise every concurrent TOTP request in
 * the whole suite, not just the ones actually racing on this secret) — only
 * the brief read-and-claim is atomic. A lost race just loops back around and
 * computes a fresh step for the next window instead.
 */
export async function freshTotp(secret, marginMs = 3000) {
  const stepOf = (ms) => Math.floor(ms / 30_000);

  for (;;) {
    const lastStep = await withLock(() => readPersistedStep(secret));
    const now0 = Date.now();
    const step0 = stepOf(now0);
    if (step0 <= lastStep || now0 % 30_000 > 30_000 - marginMs) {
      const nextBoundary = (Math.max(step0, lastStep) + 1) * 30_000;
      await sleep(Math.max(0, nextBoundary - now0) + 200);
      continue;
    }

    const now = Date.now();
    const step = stepOf(now);
    const claimed = await withLock(() => {
      if (readPersistedStep(secret) >= step) return false; // raced — someone else got it
      writePersistedStep(secret, step);
      return true;
    });
    if (claimed) return totp(secret, now);
    // Lost the race for this step; loop and try again (will land on the
    // next window, since the winner just claimed this one).
  }
}
