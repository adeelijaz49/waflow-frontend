// AI Mode Phase 4 end-to-end smoke test.
//
// Not wired into CI — this repo has no e2e runner yet, and AI Mode calls a
// real Claude API + real Mongo data, which CI shouldn't depend on. Run
// manually against local dev servers (frontend on :4200, backend on :3000):
//   node e2e/ai-mode.spec.js
//
// Exercises: a read-only question round trip, then the full action
// confirm-gate round trip (propose -> zero side effect -> confirm -> real
// side effect), using an isDemo-flagged promotion + an existing isDemo
// customer so nothing here can ever trigger a real WhatsApp send.
const { chromium } = require('playwright');

const FRONTEND = 'http://localhost:4200';
const API = 'http://localhost:3000/api';

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
  const demoCustomers = await jsonFetch(`${API}/customers?isDemo=true&limit=1`);
  const customer = demoCustomers.body.customers?.[0] || demoCustomers.body[0];
  assert(customer?._id, 'expected at least one isDemo customer to exist as a test fixture');

  const promoRes = await jsonFetch(`${API}/promotions`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: '__test_ai_e2e_promo__', scope: 'products', customerType: 'cash', isDemo: true }),
  });
  const promo = promoRes.body;
  assert(promo?._id, 'failed to create the scratch test promotion');

  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const pageErrors = [];
  page.on('pageerror', e => pageErrors.push(String(e)));

  try {
    await page.goto(`${FRONTEND}/ai-mode`, { waitUntil: 'networkidle' });

    // Read-only round trip
    await page.fill('.ai-input', 'How many total orders does the store have? Use your tool, then tell me the exact number.');
    await page.click('.btn-send');
    await page.waitForSelector('.wa-bubble-business .wa-bubble-text', { timeout: 30000 });
    const answerBubbles = await page.locator('.wa-bubble-text').allInnerTexts();
    assert(answerBubbles.length >= 2, 'expected a user bubble and an assistant reply bubble');
    assert(/\d/.test(answerBubbles[1]), 'expected the assistant reply to contain a real number');
    console.log('PASS: read-only question round trip ->', answerBubbles[1]);

    // Action round trip: propose
    await page.fill('.ai-input', `Send the promotion with id ${promo._id} to the customer with id ${customer._id} over WhatsApp. Call the send tool now with these exact ids, don't ask me anything first.`);
    await page.click('.btn-send');
    await page.waitForSelector('.pending-action-card', { timeout: 30000 });
    console.log('PASS: action proposal rendered a pending-action confirm card');

    const reportBefore = await jsonFetch(`${API}/promotions/${promo._id}/report`);
    assert(reportBefore.body.messagesSent === 0, 'expected zero side effects before confirming');
    console.log('PASS: zero side effects before confirm (messagesSent = 0)');

    // Confirm — real side effect should now happen
    await page.click('.btn-confirm');
    await page.waitForFunction(() => !document.querySelector('.pending-action-card'), { timeout: 15000 });

    const reportAfter = await jsonFetch(`${API}/promotions/${promo._id}/report`);
    assert(reportAfter.body.messagesSent === 1, 'expected exactly one message sent after confirming');
    console.log('PASS: confirmed action produced the real side effect (messagesSent = 1)');

    const finalBubbles = await page.locator('.wa-bubble-text').allInnerTexts();
    const lastReply = finalBubbles[finalBubbles.length - 1];
    assert(!/^Done\. \{/.test(lastReply), 'expected the confirmed-action reply to be phrased in plain language, not raw JSON');
    console.log('PASS: confirmed-action reply is plain language ->', lastReply);

    assert(pageErrors.length === 0, `expected zero browser console/page errors, got: ${JSON.stringify(pageErrors)}`);
    console.log('PASS: zero browser console/page errors');

    console.log('\nAll AI Mode e2e checks passed.');
  } finally {
    await browser.close();
    await jsonFetch(`${API}/promotions/${promo._id}`, { method: 'DELETE' });
  }
})().catch(err => {
  console.error(err);
  process.exit(1);
});
