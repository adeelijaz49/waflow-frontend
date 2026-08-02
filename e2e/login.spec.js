// Passwordless login end-to-end smoke test.
//
// Not wired into CI — run manually against local dev servers (frontend on
// :4200, backend on :3000, with AUTH_TEST_MODE=true in the backend's .env so
// the real OTP code/magic-link token come back in the API response instead
// of requiring a real WhatsApp/email round trip):
//   node e2e/login.spec.js
//
// Exercises: unauthenticated redirect, WhatsApp OTP login for the real
// migrated Owner account, sidebar reflecting the real workspace/user/role,
// and logout clearing the session.
const { chromium } = require('playwright');

const FRONTEND = 'http://localhost:4200';
const API = 'http://localhost:3000/api';
const OWNER_PHONE = '61422286126'; // the real migrated Owner (scripts/migrate-to-workspace.js)

function assert(cond, msg) {
  if (!cond) throw new Error(`ASSERTION FAILED: ${msg}`);
}

async function jsonFetch(url, opts) {
  const res = await fetch(url, opts);
  const text = await res.text();
  let body;
  try { body = JSON.parse(text); } catch { body = text; }
  return { status: res.status, body };
}

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const pageErrors = [];
  page.on('pageerror', e => pageErrors.push(String(e)));

  try {
    await page.goto(`${FRONTEND}/dashboard`, { waitUntil: 'networkidle' });
    assert(page.url().endsWith('/login'), `expected an unauthenticated visit to /dashboard to redirect to /login, got ${page.url()}`);
    console.log('PASS: unauthenticated visit to a protected route redirects to /login');

    await page.fill('input[type="tel"]', OWNER_PHONE);
    await page.click('.btn-login-primary');
    await page.waitForSelector('input[inputmode="numeric"]', { timeout: 10000 });
    console.log('PASS: requesting an OTP shows the code-entry step');

    const otpRes = await jsonFetch(`${API}/auth/otp/request`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ phone: OWNER_PHONE }),
    });
    const code = otpRes.body.testCode;
    assert(/^\d{6}$/.test(code), `expected AUTH_TEST_MODE to echo back a 6-digit test code, got ${JSON.stringify(otpRes.body)}`);

    await page.fill('input[inputmode="numeric"]', code);
    await page.click('.btn-login-primary');
    await page.waitForURL('**/dashboard', { timeout: 10000 });
    console.log('PASS: verifying the correct code logs in and lands on /dashboard');

    const storeName = await page.locator('.store-name').innerText();
    const storeSub = await page.locator('.store-sub').innerText();
    assert(storeName.length > 0, 'expected the sidebar to show a real workspace name');
    assert(/Owner/.test(storeSub), `expected the sidebar to show the Owner role, got "${storeSub}"`);
    console.log(`PASS: sidebar reflects the real session -> "${storeName}" / "${storeSub}"`);

    await page.click('.btn-logout');
    await page.waitForURL('**/login', { timeout: 10000 });
    console.log('PASS: logout clears the session and redirects to /login');

    assert(pageErrors.length === 0, `expected zero browser console/page errors, got: ${JSON.stringify(pageErrors)}`);
    console.log('PASS: zero browser console/page errors');

    console.log('\nAll login e2e checks passed.');
  } finally {
    await browser.close();
  }
})().catch(err => {
  console.error(err);
  process.exit(1);
});
