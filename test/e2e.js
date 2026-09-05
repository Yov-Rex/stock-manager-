// End-to-end test: load the real index.html + app.js in JSDOM against the
// real running server. Verifies login, dashboard, items CRUD, stock-in/out,
// and movements all work through the actual UI code paths.

const path = require('path');
const fs = require('fs');
const { JSDOM, ResourceLoader } = require('jsdom');

const BASE = 'http://localhost:3000';

class LocalLoader extends ResourceLoader {
  fetch(url, options) {
    // Bypass JSDOM's external resource handling — we explicitly pull files
    // from disk so we don't need a network roundtrip.
    if (url.startsWith(BASE + '/')) {
      const rel = url.slice(BASE.length);
      const p = path.join(PUBLIC_DIR, rel === '/' ? 'index.html' : rel);
      if (fs.existsSync(p)) return Promise.resolve(Buffer.from(fs.readFileSync(p)));
    }
    return super.fetch(url, options);
  }
}

const PUBLIC_DIR = path.join(__dirname, '..', 'public');
async function main() {
  console.log('[test] loading SPA from disk into JSDOM...');
  const indexPath = path.join(PUBLIC_DIR, 'index.html');
  const html = fs.readFileSync(indexPath, 'utf8');

  const dom = new JSDOM(html, {
    url: BASE + '/',
    runScripts: 'dangerously',
    resources: new LocalLoader(),
    pretendToBeVisual: true,
  });

  // Wait for app.js (defer) to finish wiring up.
  await new Promise(r => dom.window.addEventListener('load', r));
  await new Promise(r => setTimeout(r, 600));

  const { document } = dom.window;

  // Helpers
  const ok = (cond, msg) => {
    if (!cond) { console.error('  FAIL:', msg); process.exit(1); }
    console.log('  ok:', msg);
  };

  console.log('[test] initial render shows login screen');
  ok(!document.getElementById('login-screen').hidden, 'login screen visible');
  ok(document.getElementById('app-shell').hidden, 'app shell hidden');
  ok(document.querySelector('#login-form input[name=username]').value === 'admin', 'username prefilled with admin');
  ok(document.querySelector('#login-form input[name=password]').value === 'admin123', 'password prefilled');

  console.log('[test] submit login form');
  // Override fetch so the SPA talks to our live server.
  dom.window.fetch = async (url, opts = {}) => {
    const u = url.startsWith('http') ? url : BASE + url;
    const res = await (await import('node-fetch').catch(() => null) || { default: null });
    if (res.default) return res.default(u, opts);
    return globalThis.fetch(u, opts);
  };

  // node has native fetch since 18 — use it.
  dom.window.fetch = (url, opts) => {
    const u = url.startsWith('http') ? url : BASE + url;
    return globalThis.fetch(u, opts);
  };

  // Submit form
  const submit = new dom.window.Event('submit', { bubbles: true, cancelable: true });
  document.getElementById('login-form').dispatchEvent(submit);

  // Wait for the shell to render
  for (let i = 0; i < 30; i++) {
    if (!document.getElementById('app-shell').hidden) break;
    await new Promise(r => setTimeout(r, 100));
  }
  ok(!document.getElementById('app-shell').hidden, 'app shell became visible after login');
  ok(document.getElementById('who-name').textContent === 'Administrator', `who-name == Administrator (got: ${document.getElementById('who-name').textContent})`);

  // Verify token is stored
  const token = dom.window.localStorage.getItem('sm_jwt');
  ok(token && token.length > 30, 'JWT stored in localStorage');

  // The dashboard should have rendered KPI cards
  await new Promise(r => setTimeout(r, 500));
  const kpis = document.querySelectorAll('.kpi');
  ok(kpis.length >= 4, `dashboard shows ${kpis.length} KPI cards`);

  // Navigate to items
  dom.window.location.hash = '#items';
  dom.window.dispatchEvent(new dom.window.Event('hashchange'));
  await new Promise(r => setTimeout(r, 800));
  console.log('  debug: items page hash =', dom.window.location.hash);
  const tables = document.querySelectorAll('#view-root table');
  console.log('  debug: tables on items page =', tables.length);
  for (let i = 0; i < tables.length; i++) {
    const r = tables[i].querySelectorAll('tbody tr').length;
    console.log(`    table ${i}: ${r} rows`);
  }
  const rows = document.querySelectorAll('#view-root tbody tr');
  ok(rows.length >= 10, `items page lists ${rows.length} rows`);

  // Verify stock status chips
  const chips = document.querySelectorAll('#view-root .chip');
  ok(chips.length > 0, `stock status chips rendered (${chips.length})`);

  // Trigger a stock-out movement through the API so the movements page is non-empty
  await dom.window.fetch('/api/items/1/out', {
    method: 'POST',
    headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: JSON.stringify({ quantity: 2, reason: 'e2e test', counterparty: 'e2e' }),
  });

  // Navigate to movements
  dom.window.location.hash = '#movements';
  dom.window.dispatchEvent(new dom.window.Event('hashchange'));
  await new Promise(r => setTimeout(r, 700));
  ok(document.querySelectorAll('#view-root tbody tr').length > 0, 'movements page has rows after first in/out');

  // Navigate to people
  dom.window.location.hash = '#users';
  dom.window.dispatchEvent(new dom.window.Event('hashchange'));
  await new Promise(r => setTimeout(r, 500));
  ok(document.querySelectorAll('#view-root tbody tr').length >= 1, 'people page has at least 1 user');

  // --- Full flow: create an item via API, see it on items page ----------
  const createRes = await dom.window.fetch('/api/items', {
    method: 'POST',
    headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: JSON.stringify({ sku: 'E2E-001', name: 'E2E Pen', category: 'Stationery', unit: 'pcs', quantity: 30, min_quantity: 5 }),
  });
  const created = await createRes.json();
  ok(createRes.status === 201, `POST /items -> ${createRes.status}`);

  // Stock-in 7
  const inRes = await dom.window.fetch('/api/items/' + created.id + '/in', {
    method: 'POST',
    headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: JSON.stringify({ quantity: 7, reason: 'restock', counterparty: 'Acme' }),
  });
  ok(inRes.status === 201, `POST stock-in -> ${inRes.status}`);

  // Stock-out 4
  const outRes = await dom.window.fetch('/api/items/' + created.id + '/out', {
    method: 'POST',
    headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: JSON.stringify({ quantity: 4, reason: 'office use', counterparty: 'Yovre' }),
  });
  ok(outRes.status === 201, `POST stock-out -> ${outRes.status}`);

  // Verify final state
  const itemRes = await (await dom.window.fetch('/api/items/' + created.id, { headers: { 'Authorization': 'Bearer ' + token } })).json();
  ok(itemRes.item.quantity === 33, `final quantity 30 + 7 - 4 = 33 (got ${itemRes.item.quantity})`);
  ok(itemRes.movements.length === 3, `3 movements recorded (got ${itemRes.movements.length})`);

  // Insufficient stock should 409
  const overRes = await dom.window.fetch('/api/items/' + created.id + '/out', {
    method: 'POST',
    headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: JSON.stringify({ quantity: 9999 }),
  });
  ok(overRes.status === 409, `overdraw returns 409 (got ${overRes.status})`);

  // Re-render items and ensure new item is present
  dom.window.location.hash = '#items';
  dom.window.dispatchEvent(new dom.window.Event('hashchange'));
  await new Promise(r => setTimeout(r, 500));
  const newItemRow = Array.from(document.querySelectorAll('#view-root tbody tr'))
    .find(r => r.textContent.includes('E2E-001'));
  ok(!!newItemRow, 'newly created item appears on items page');

  // Open the item detail modal
  const viewBtn = newItemRow.querySelector('button.icon-btn');
  viewBtn.click();
  await new Promise(r => setTimeout(r, 400));
  ok(!document.getElementById('modal-root').hidden, 'item detail modal opens');
  ok(document.getElementById('modal-title').textContent.includes('E2E Pen'), 'modal title shows item name');
  // close modal
  document.getElementById('modal-close').click();
  await new Promise(r => setTimeout(r, 200));
  ok(document.getElementById('modal-root').hidden, 'modal closes on close button');

  // Clean up
  await dom.window.fetch('/api/items/' + created.id, { method: 'DELETE', headers: { 'Authorization': 'Bearer ' + token } });

  console.log('\nALL UI TESTS PASSED');
  process.exit(0);
}

main().catch(err => {
  console.error('TEST CRASHED:', err);
  process.exit(1);
});