/* v2 add-on smoke test. Runs in JSDOM via the same harness as e2e.js. */
const { JSDOM } = require('jsdom');
const path = require('path');
const fs = require('fs');
const http = require('http');

const PUBLIC = path.join(__dirname, '..', 'public');
const SERVER = 'http://localhost:3000';

function getJSON(p) {
  return new Promise((resolve, reject) => {
    const u = new URL(SERVER + p);
    const req = http.request({ hostname: u.hostname, port: u.port, path: u.pathname + u.search, method: 'GET' }, (res) => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(Buffer.concat(chunks).toString('utf8')) }); }
        catch (e) { resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString('utf8') }); }
      });
    });
    req.on('error', reject);
    req.end();
  });
}
function req(method, p, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(SERVER + p);
    const data = body ? (typeof body === 'string' ? body : JSON.stringify(body)) : null;
    const h = Object.assign({}, headers);
    if (data && !h['Content-Type']) h['Content-Type'] = 'application/json';
    const r = http.request({ hostname: u.hostname, port: u.port, path: u.pathname + u.search, method, headers: h }, (res) => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let parsed = text;
        try { parsed = JSON.parse(text); } catch {}
        resolve({ status: res.statusCode, body: parsed, headers: res.headers, raw: text });
      });
    });
    r.on('error', reject);
    if (data) r.write(data);
    r.end();
  });
}

function assert(cond, msg) {
  if (!cond) { console.error('  FAIL:', msg); process.exitCode = 1; throw new Error(msg); }
  console.log('  ok:', msg);
}

(async () => {
  // --- backend ---
  console.log('[addon] backend');

  const login = await req('POST', '/api/auth/login', { username: 'admin', password: 'admin123' });
  assert(login.status === 200, 'admin login');
  const cookie = login.headers['set-cookie'][0].split(';')[0];
  const H = { Cookie: cookie };

  const r = await req('GET', '/api/requesters', null, H);
  assert(r.status === 200 && Array.isArray(r.body.requesters), 'GET /api/requesters');
  assert(r.body.requesters.length >= 3, 'has seeded requesters (got ' + r.body.requesters.length + ')');

  const d = await req('GET', '/api/departments', null, H);
  assert(d.status === 200 && Array.isArray(d.body.departments), 'GET /api/departments');
  assert(d.body.departments.length >= 5, 'has seeded departments (got ' + d.body.departments.length + ')');

  const a = await req('GET', '/api/alerts', null, H);
  assert(a.status === 200 && Array.isArray(a.body.alerts), 'GET /api/alerts');
  // Some items have quantity <= min so we expect at least 0; just verify shape
  if (a.body.alerts.length > 0) {
    const it = a.body.alerts[0];
    assert(typeof it.last_movement_at !== 'undefined', 'alert row has last_movement_at');
  }

  // scan known
  const items = (await req('GET', '/api/items?q=', null, H)).body.items;
  const s1 = await req('GET', '/api/scan?code=' + encodeURIComponent(items[0].sku), null, H);
  assert(s1.status === 200 && s1.body.item && s1.body.item.id === items[0].id, 'scan known SKU');

  const s2 = await req('GET', '/api/scan?code=ZZZ-DOES-NOT-EXIST', null, H);
  assert(s2.status === 404, 'scan unknown returns 404');

  // export items
  const exp = await req('GET', '/api/export/items', null, H);
  assert(exp.status === 200 && exp.raw.split('\n').length >= 2, 'export items csv');

  // import dedupe
  const stamp = Date.now().toString(36);
  const csv = 'sku,name,category,unit,quantity\nADD-IMP-' + stamp + '-1,Addon Import Pen,Writing,pcs,7\nADD-IMP-' + stamp + '-2,Addon Import Stapler,Office,pcs,3\nADD-IMP-' + stamp + '-1,Duplicate Pen,Writing,pcs,9';
  const imp = await req('POST', '/api/import/items', csv, Object.assign({}, H, { 'Content-Type': 'text/csv' }));
  assert(imp.status === 200 && imp.body.inserted === 2 && imp.body.skipped === 1, 'import inserts 2, skips 1 (got ' + JSON.stringify(imp.body) + ')');

  // stock-out with requester + department join
  const items2 = (await req('GET', '/api/items?q=', null, H)).body.items;
  const pick = items2.find(i => i.quantity >= 2);
  if (pick) {
    const out = await req('POST', `/api/items/${pick.id}/out`, { quantity: 1, requester_id: 1, department_id: 1, comment: 'addon-test' }, H);
    assert(out.status === 201, 'stock-out with requester/department');
    const ms = (await req('GET', '/api/movements?item_id=' + pick.id + '&limit=1', null, H)).body.movements;
    assert(ms[0] && ms[0].requester_name && ms[0].department_name, 'movement row joins requester+department (got ' + (ms[0] && ms[0].requester_name) + ' / ' + (ms[0] && ms[0].department_name) + ')');
  }

  // --- frontend (JSDOM) ---
  console.log('[addon] frontend');
  const html = fs.readFileSync(path.join(PUBLIC, 'index.html'), 'utf8');
  const dom = new JSDOM(html, {
    url: SERVER + '/',
    runScripts: 'outside-only',
    pretendToBeVisual: true,
  });
  const win = dom.window;
  // patch fetch to use node http
  win.fetch = (url, opts = {}) => {
    const u = new URL(url.startsWith('http') ? url : SERVER + url);
    return new Promise((resolve, reject) => {
      const data = opts.body ? (typeof opts.body === 'string' ? opts.body : JSON.stringify(opts.body)) : null;
      const headers = Object.assign({}, opts.headers || {});
      if (data && !headers['Content-Type']) headers['Content-Type'] = 'application/json';
      const r = http.request({ hostname: u.hostname, port: u.port, path: u.pathname + u.search, method: opts.method || 'GET', headers }, (res) => {
        const chunks = [];
        res.on('data', c => chunks.push(c));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          let parsed = text; try { parsed = JSON.parse(text); } catch {}
          const Hdr = function (h) { this._h = h; };
          Hdr.prototype.get = function (k) { return this._h[k.toLowerCase()] || null; };
          resolve({ status: res.statusCode, ok: res.statusCode < 400,
            headers: new Hdr(res.headers),
            text: async () => text, json: async () => parsed });
        });
      });
      r.on('error', reject);
      if (data) r.write(data);
      r.end();
    });
  };
  win.localStorage.setItem('sm_jwt', cookie.split('=')[1]);
  // load app.js
  const appJs = fs.readFileSync(path.join(PUBLIC, 'app.js'), 'utf8');
  const addonJs = fs.readFileSync(path.join(PUBLIC, 'addon.js'), 'utf8');
  win.eval(appJs);
  win.eval(addonJs);
  // wait for boot
  await new Promise(r => setTimeout(r, 200));

  // set hash to alerts, dispatch hashchange
  win.location.hash = '#alerts';
  win.dispatchEvent(new win.Event('hashchange'));
  await new Promise(r => setTimeout(r, 200));
  const navs = win.document.querySelectorAll('.nav-link');
  const hasAlerts = Array.from(navs).some(n => n.dataset.route === 'alerts');
  assert(hasAlerts, 'Alerts nav link injected');
  const pageTitle = win.document.querySelector('#page-title');
  assert(pageTitle && pageTitle.textContent === 'Alerts', 'page-title is Alerts (got ' + (pageTitle && pageTitle.textContent) + ')');

  // nav to scan
  win.location.hash = '#scan';
  win.dispatchEvent(new win.Event('hashchange'));
  await new Promise(r => setTimeout(r, 100));
  const scanInput = win.document.querySelector('#scan-input');
  assert(!!scanInput, 'Scan page has input');

  // nav to requesters
  win.location.hash = '#requesters';
  win.dispatchEvent(new win.Event('hashchange'));
  await new Promise(r => setTimeout(r, 500));
  const reqsHTML = win.document.querySelector('#view-root').innerHTML;
  assert(/M\. Dupont/.test(reqsHTML), 'Requesters page shows M. Dupont');
  assert(reqsHTML.includes('New requester'), 'Requesters page has New button');

  // nav to departments
  win.location.hash = '#departments';
  win.dispatchEvent(new win.Event('hashchange'));
  await new Promise(r => setTimeout(r, 500));
  const deptHTML = win.document.querySelector('#view-root').innerHTML;
  assert(/Comptabilité/.test(deptHTML), 'Departments page shows Comptabilité');

  // -----------------------------------------------------------------
  // Bug-fix regression tests (added when fixing the user's bug list)
  // -----------------------------------------------------------------

  // Extract the JWT once for direct win.fetch calls (the addon's api()
  // helper already does this for in-app calls, but some tests need
  // direct HTTP access to assert on server state).
  const jwt = win.localStorage.getItem('sm_jwt');
  assert(jwt && jwt.length > 10, 'JWT is in localStorage');

  // v1 People nav link must be hidden — user management moved to Admin page
  const peopleLink = win.document.querySelector('a[data-route="users"]');
  assert(peopleLink && peopleLink.style.display === 'none',
         'People nav link is hidden (moved into Admin)');

  // Admin page renders the admin content, NOT the dashboard (v1 routeTo bug)
  win.location.hash = '#admin';
  win.dispatchEvent(new win.Event('hashchange'));
  await new Promise(r => setTimeout(r, 600));
  const adminHTML = win.document.querySelector('#view-root').textContent;
  assert(/System overview/.test(adminHTML) || /Vue d/.test(adminHTML),
         'Admin page renders admin content (not dashboard fallback)');
  assert(!/Inventory value/.test(adminHTML) || !/Stock in \(7 days\)/.test(adminHTML),
         'Admin page is not clobbered by v1 dashboard render');

  // Item detail modal now uses tabs (Details / Stock in / Stock out / Movements)
  win.location.hash = '#items';
  win.dispatchEvent(new win.Event('hashchange'));
  await new Promise(r => setTimeout(r, 500));
  // open detail for the first item. There are now 3 icon-buttons per
  // row (quick stock-out, view detail, edit); we want the second one
  // (View detail) — title="View detail" is a stable anchor.
  const viewBtn = win.document.querySelector('#view-root .icon-btn[title="View detail"]');
  assert(!!viewBtn, 'view-detail icon button is present');
  viewBtn.click();
  await new Promise(r => setTimeout(r, 400));
  const tabs = win.document.querySelectorAll('#modal-root .tab');
  assert(tabs.length === 4, 'item-detail modal has 4 tabs (got ' + tabs.length + ')');
  const labels = Array.from(tabs).map(t => t.textContent.trim());
  assert(/Details/.test(labels.join(' ')),  'tab: Details');
  assert(/Stock in/.test(labels.join(' ')), 'tab: Stock in');
  assert(/Stock out/.test(labels.join(' ')),'tab: Stock out');
  assert(/Movements/.test(labels.join(' ')),'tab: Movements');
  // switching to "Stock in" exposes a form, not a static message
  tabs[1].click();
  await new Promise(r => setTimeout(r, 50));
  const inForm = win.document.querySelector('#modal-root input[name=qty]');
  assert(!!inForm, 'Stock-in tab exposes a quantity input');
  // close
  win.document.getElementById('modal-close').click();
  await new Promise(r => setTimeout(r, 50));

  // Items table shows a "Value" column
  win.location.hash = '#items';
  win.dispatchEvent(new win.Event('hashchange'));
  await new Promise(r => setTimeout(r, 400));
  const itemsHTML = win.document.querySelector('#view-root').textContent;
  assert(/Value/.test(itemsHTML), 'Items table has a Value column');

  // -----------------------------------------------------------------
  // Inventory audit page (new feature)
  // -----------------------------------------------------------------
  // Capture starting quantity for the first item so we can verify
  // the audit movement changes it correctly.
  const itemsBefore = await (await win.fetch('/api/items', { headers: { Authorization: 'Bearer ' + jwt } })).json();
  const first = itemsBefore.items[0];
  const startQty = first.quantity;

  win.location.hash = '#inventory';
  win.dispatchEvent(new win.Event('hashchange'));
  await new Promise(r => setTimeout(r, 600));
  const invHTML = win.document.querySelector('#view-root').innerHTML;
  assert(/Inventory audit/.test(invHTML), 'Inventory page renders title');
  const invRows = win.document.querySelectorAll('#inv-table tbody tr');
  assert(invRows.length === itemsBefore.items.length,
         'Inventory table has one row per item (got ' + invRows.length + ')');
  // The first row's counted input and delta cell must exist
  const firstRow = invRows[0];
  assert(!!firstRow.querySelector('input.counted'), 'row has a Counted input');
  assert(!!firstRow.querySelector('.delta'),     'row has a Delta cell');
  assert(!!firstRow.querySelector('input.note'),  'row has an Audit note input');

  // Enter a counted value (startQty + 3) for the first item and save
  const newCounted = startQty + 3;
  firstRow.querySelector('input.counted').value = String(newCounted);
  firstRow.querySelector('input.counted').dispatchEvent(new win.Event('input'));
  await new Promise(r => setTimeout(r, 50));
  assert(firstRow.querySelector('.delta').textContent.trim() === '+3',
         'Delta shows +3 (got "' + firstRow.querySelector('.delta').textContent.trim() + '")');

  // Save the audit
  win.document.getElementById('inv-save').click();
  await new Promise(r => setTimeout(r, 1500));
  // The first item's quantity must have increased by 3
  const itemsAfter = await (await win.fetch('/api/items', { headers: { Authorization: 'Bearer ' + jwt } })).json();
  const after = itemsAfter.items.find(i => i.id === first.id);
  assert(after.quantity === startQty + 3,
         'audit applied: first item went from ' + startQty + ' to ' + after.quantity);

  // The audit movement must have been recorded with reason "Inventory audit"
  const movRes = await (await win.fetch('/api/movements?item_id=' + first.id + '&limit=1',
                                         { headers: { Authorization: 'Bearer ' + jwt } })).json();
  const lastMv = movRes.movements[0];
  assert(lastMv && lastMv.type === 'in' && lastMv.quantity === 3 && /audit/i.test(lastMv.reason || ''),
         'audit movement recorded (type=' + (lastMv && lastMv.type) + ', qty=' + (lastMv && lastMv.quantity) + ', reason=' + (lastMv && lastMv.reason) + ')');

  // /api/settings is reachable (admin page depends on it)
  const settingsRes = await win.fetch('/api/settings', { headers: { Authorization: 'Bearer ' + jwt } });
  assert(settingsRes.status === 200, 'GET /api/settings returns 200');

  // -----------------------------------------------------------------
  // New v3 features: manager role, email/department on users, edit
  // user, edit department, quick stock-out, scan-mini modal, audit
  // log, backup endpoint.
  // -----------------------------------------------------------------

  // Create a manager-role user with email + department. Use the existing
  // admin user for authentication so this also verifies the role
  // allow-list accepts 'manager'. Use a unique username so the test
  // is repeatable across runs without manual cleanup.
  const uname = 'manager_' + Math.random().toString(36).slice(2, 10);
  const deptRes  = await (await win.fetch('/api/departments', { headers: { Authorization: 'Bearer ' + jwt } })).json();
  const deptId   = (deptRes.departments && deptRes.departments[0] && deptRes.departments[0].id) || 1;
  const mkRes = await win.fetch('/api/users', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + jwt },
    body: JSON.stringify({
      username: uname, full_name: 'Manager One', password: 'managerpass',
      email: uname + '@example.com', role: 'manager', department_id: deptId
    })
  });
  assert(mkRes.status === 201, 'create manager user (got ' + mkRes.status + ')');

  // GET /api/users returns email + department_name
  const usersRes = await (await win.fetch('/api/users', { headers: { Authorization: 'Bearer ' + jwt } })).json();
  const manager = usersRes.users.find(u => u.username === uname);
  assert(!!manager, 'manager appears in /api/users');
  assert(manager.email === uname + '@example.com', 'user.email returned by API');
  assert(manager.role === 'manager', 'user.role === manager');
  assert(manager.department_id === deptId, 'user.department_id matches');

  // PATCH /api/users/:id — change the email
  const patchRes = await win.fetch('/api/users/' + manager.id, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + jwt },
    body: JSON.stringify({ email: 'updated@example.com' })
  });
  assert(patchRes.status === 200, 'PATCH /api/users/:id returns 200');
  const usersRes2 = await (await win.fetch('/api/users', { headers: { Authorization: 'Bearer ' + jwt } })).json();
  const updated = usersRes2.users.find(u => u.id === manager.id);
  assert(updated.email === 'updated@example.com', 'PATCH updated the email');

  // Edit a department via PUT (was unused before this round)
  const deptPut = await win.fetch('/api/departments/' + deptId, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + jwt },
    body: JSON.stringify({ description: 'Updated by e2e test' })
  });
  assert(deptPut.status === 200, 'PUT /api/departments/:id returns 200');
  const deptRes2 = await (await win.fetch('/api/departments', { headers: { Authorization: 'Bearer ' + jwt } })).json();
  const updatedDept = deptRes2.departments.find(d => d.id === deptId);
  assert(updatedDept.description === 'Updated by e2e test', 'department description was updated');

  // Audit log endpoint returns entries from the actions above
  const auditRes = await (await win.fetch('/api/audit-log?limit=20', { headers: { Authorization: 'Bearer ' + jwt } })).json();
  assert(Array.isArray(auditRes.entries), '/api/audit-log returns entries array');
  assert(auditRes.entries.length >= 3, 'audit log captured the create/patch/put (' + auditRes.entries.length + ' entries)');
  // At least one entry must be for a user update
  assert(auditRes.entries.some(e => e.entity === 'user' && e.action === 'update'),
         'audit log includes a user update entry');
  // The actor should be the admin who is currently logged in for all
  // non-login events. Login attempts (entity='session') have a null
  // actor_user_id by definition.
  assert(auditRes.entries.filter(e => e.entity !== 'session')
                           .every(e => e.actor_username === 'admin'),
         'audit log actor is the admin user for non-login entries');

  // Backup endpoint returns the live SQLite bytes
  const backupRes = await win.fetch('/api/backup.sqlite', { headers: { Authorization: 'Bearer ' + jwt } });
  assert(backupRes.status === 200, 'GET /api/backup.sqlite returns 200');
  // Older JSDOM may not implement arrayBuffer/blob on Response; the
  // Content-Length header is enough to confirm a real file came back.
  const len = parseInt(backupRes.headers.get('Content-Length') || '0', 10);
  assert(len > 100, 'backup Content-Length > 100 (got ' + len + ')');
  let backupBytes;
  if (typeof backupRes.arrayBuffer === 'function') {
    try { backupBytes = new Uint8Array(await backupRes.arrayBuffer()); }
    catch (e) { /* fall through */ }
  }
  if (!backupBytes && typeof backupRes.blob === 'function') {
    try { backupBytes = new Uint8Array(await (await backupRes.blob()).arrayBuffer()); }
    catch (e) { /* fall through */ }
  }
  if (backupBytes) {
    const magic = String.fromCharCode.apply(null, backupBytes.slice(0, 15));
    assert(magic.startsWith('SQLite format 3'), 'backup has SQLite magic header (got "' + magic + '")');
  }

  // Delete the test user so the e2e test is repeatable
  const delRes = await win.fetch('/api/users/' + manager.id, {
    method: 'DELETE', headers: { Authorization: 'Bearer ' + jwt }
  });
  assert(delRes.status === 200, 'DELETE /api/users/:id returns 200');

  // Items page now shows the quick stock-out icon button
  win.location.hash = '#items';
  win.dispatchEvent(new win.Event('hashchange'));
  await new Promise(r => setTimeout(r, 400));
  const qsOut = win.document.querySelector('#view-root .icon-btn[title="Quick stock-out"]');
  assert(!!qsOut, 'items table has a quick stock-out icon button');

  // People page renders the email + department columns + edit/remove icons
  win.location.hash = '#users';
  win.dispatchEvent(new win.Event('hashchange'));
  await new Promise(r => setTimeout(r, 500));
  const peopleHTML = win.document.querySelector('#view-root').innerHTML;
  assert(/Email/.test(peopleHTML), 'people page has an Email column header');
  assert(/Department/.test(peopleHTML), 'people page has a Department column header');
  const editIcons = win.document.querySelectorAll('#view-root .icon-btn[title="Edit"]');
  assert(editIcons.length >= 1, 'people page has at least one edit icon');

  // Admin page renders audit + backup cards
  win.location.hash = '#admin';
  win.dispatchEvent(new win.Event('hashchange'));
  await new Promise(r => setTimeout(r, 600));
  const adminHTML2 = win.document.querySelector('#view-root').innerHTML;
  assert(/Audit log/.test(adminHTML2) || /Journal d/.test(adminHTML2),
         'Admin page has an audit-log card');
  assert(/Backup/.test(adminHTML2) || /Sauvegarde/.test(adminHTML2),
         'Admin page has a backup card');

  // language switch to FR
  const langSel = win.document.querySelector('.lang-select');
  assert(!!langSel, 'language select exists');
  langSel.value = 'fr';
  langSel.dispatchEvent(new win.Event('change'));
  await new Promise(r => setTimeout(r, 50));
  assert(win.document.documentElement.lang === 'fr', 'document.lang switched to fr');

  langSel.value = 'ar';
  langSel.dispatchEvent(new win.Event('change'));
  await new Promise(r => setTimeout(r, 50));
  assert(win.document.documentElement.lang === 'ar' && win.document.documentElement.dir === 'rtl', 'RTL applied for Arabic');

  console.log('\nALL ADDON TESTS PASSED');
  process.exit(0);
})().catch(e => { console.error('addon test threw:', e); process.exit(1); });
