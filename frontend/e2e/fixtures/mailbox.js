// Thin client for Mailpit (github.com/axllent/mailpit), the SMTP catcher the
// E2E suite points the backend's SMTP_HOST/SMTP_PORT at (see
// .github/workflows/e2e-playwright.yml and README §7 for local setup). Lets
// tests read the real emails the app sends — signup verification, email
// change, password reset — instead of reaching into the database for tokens.

const MAILPIT_URL = process.env.MAILPIT_URL || 'http://127.0.0.1:8025';

async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Mailpit request failed (${res.status}): ${url}`);
  return res.json();
}

/**
 * Poll Mailpit until an email to `recipient` arrives (optionally filtered by a
 * substring of the subject, useful when a test sends more than one email to
 * the same address and needs a specific one). Returns the full message body
 * (Mailpit's `/api/v1/message/{id}` shape, notably `.Text`).
 */
export async function waitForEmail(recipient, { subjectContains, timeoutMs = 20_000, pollMs = 500 } = {}) {
  const deadline = Date.now() + timeoutMs;
  const query = encodeURIComponent(`to:"${recipient}"`);
  while (Date.now() < deadline) {
    const search = await fetchJson(`${MAILPIT_URL}/api/v1/search?query=${query}&limit=25`);
    const messages = search.messages || [];
    const candidates = subjectContains
      ? messages.filter((m) => (m.Subject || '').includes(subjectContains))
      : messages;
    if (candidates.length > 0) {
      // Mailpit's search returns newest first.
      return fetchJson(`${MAILPIT_URL}/api/v1/message/${candidates[0].ID}`);
    }
    await new Promise((r) => setTimeout(r, pollMs));
  }
  throw new Error(
    `No email arrived for ${recipient}` +
    (subjectContains ? ` with subject containing "${subjectContains}"` : '') +
    ` within ${timeoutMs}ms`
  );
}

/** Raw search — returns Mailpit's message summaries (no bodies) for a recipient. */
export async function searchEmails(recipient, { subjectContains } = {}) {
  const query = encodeURIComponent(`to:"${recipient}"`);
  const search = await fetchJson(`${MAILPIT_URL}/api/v1/search?query=${query}&limit=50`);
  const messages = search.messages || [];
  return subjectContains
    ? messages.filter((m) => (m.Subject || '').includes(subjectContains))
    : messages;
}

/** Poll until at least `count` emails have arrived for `recipient`. */
export async function waitForEmailCount(recipient, count, { timeoutMs = 20_000, pollMs = 500 } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const messages = await searchEmails(recipient);
    if (messages.length >= count) return messages;
    await new Promise((r) => setTimeout(r, pollMs));
  }
  throw new Error(`Fewer than ${count} emails arrived for ${recipient} within ${timeoutMs}ms`);
}

/** Extract the first `<pathPrefix>?token=...` link from an email's plain-text body. */
export function extractLink(text, pathPrefix) {
  const escaped = pathPrefix.replace(/[/]/g, '\\/');
  const re = new RegExp(`https?:\\/\\/[^\\s"'<>]*${escaped}\\?token=[^\\s"'<>]+`, 'i');
  const match = text.match(re);
  if (!match) {
    throw new Error(`No link with prefix "${pathPrefix}" found in email body:\n${text}`);
  }
  return match[0];
}

/** Extract just the `token` query param from the first matching link. */
export function extractToken(text, pathPrefix) {
  const link = extractLink(text, pathPrefix);
  return new URL(link).searchParams.get('token');
}

/** Wipe every message in Mailpit. Only safe in global setup, before parallel
 * tests start sending mail — never call this from within a spec. */
export async function clearMailbox() {
  await fetch(`${MAILPIT_URL}/api/v1/messages`, { method: 'DELETE' });
}
