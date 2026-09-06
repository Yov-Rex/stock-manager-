// All HTTP routes for the stock manager. Logic is intentionally kept here in
// one place — small surface, easy to read, easy to test.
const express = require('express');
const db = require('./db');
const assistant = require('./assistant');
const {
  sign, setAuthCookie, clearAuthCookie,
  requireAuth, requireAdmin, hashPassword, authenticate,
} = require('./auth');

const router = express.Router();
const { createLimiter } = require('./ratelimit');

// Rate limiters for sensitive endpoints. Sliding-window counters
// keyed by client IP (Express's req.ip, populated via `app.set('trust
// proxy', 1)` from the X-Forwarded-For header that Cloudflare Tunnel
// injects on every request).
const loginLimiter    = createLimiter({ name: 'login',    windowMs: 60_000, max: 10  }); // 10/min per IP
const restoreLimiter  = createLimiter({ name: 'restore',  windowMs: 5*60_000, max: 5   }); // 5/5min per IP
const backupLimiter   = createLimiter({ name: 'backup',   windowMs: 60_000, max: 5   }); // 5/min per IP
const writeLimiter    = createLimiter({ name: 'write',    windowMs: 60_000, max: 120 }); // 120/min per IP

// ---- Audit log helper ----
// Logs every mutating action (create/update/delete) on tracked entities.
// Failures here are intentionally non-fatal — we never want an audit
// failure to block a real write.
function audit(req, entity, entity_id, action, before, after) {
  try {
    db.prepare(`
      INSERT INTO audit_log (actor_user_id, entity, entity_id, action, before_json, after_json, ip)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      req.user ? req.user.id : null,
      entity,
      entity_id,
      action,
      before == null ? null : JSON.stringify(before),
      after  == null ? null : JSON.stringify(after),
      req.ip || null
    );
  } catch (e) {
    console.error('[audit] failed:', e.message);
  }
}

// ---- Auth ----
// /login is the only endpoint with no requireAuth — it's the gate.
// It's also the most attractive target for brute-force / credential
// stuffing, so it gets its own (strict) rate limiter and a dedicated
// audit-log entry for every attempt.
router.post('/auth/login', loginLimiter, (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) {
    audit(req, 'session', null, 'create', null,
          { username, ok: false, reason: 'missing fields' });
    return res.status(400).json({ error: 'username and password required' });
  }
  const user = authenticate(username, password);
  if (!user) {
    audit(req, 'session', null, 'create', null,
          { username, ok: false, reason: 'bad credentials' });
    // Generic error — don't leak whether the username exists.
    return res.status(401).json({ error: 'Invalid credentials' });
  }
  const token = sign(user);
  setAuthCookie(res, token);
  audit(req, 'session', user.id, 'create', null, { username, ok: true });
  res.json({ token, user });
});

router.post('/auth/logout', (_req, res) => {
  clearAuthCookie(res);
  res.json({ ok: true });
});

router.get('/auth/me', requireAuth, (req, res) => {
  res.json({ user: req.user });
});

// ---- Users (admin only) ----
router.get('/users', requireAuth, requireAdmin, (_req, res) => {
  const rows = db.prepare(`
    SELECT u.id, u.username, u.full_name, u.email, u.role,
           u.department_id, d.name AS department_name,
           u.created_at
    FROM users u
    LEFT JOIN departments d ON d.id = u.department_id
    ORDER BY u.id ASC
  `).all();
  res.json({ users: rows });
});

router.post('/users', requireAuth, requireAdmin, (req, res) => {
  const { username, full_name, email, password, role, department_id } = req.body || {};
  if (!username || !full_name || !password) {
    return res.status(400).json({ error: 'username, full_name, password required' });
  }
  // Widened role allow-list: 'staff' (default), 'manager', 'admin'.
  const finalRole = ['staff','manager','admin'].includes(role) ? role : 'staff';
  const finalDept = Number.isFinite(+department_id) ? +department_id : null;
  const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
  if (existing) return res.status(409).json({ error: 'username already taken' });
  const info = db.prepare(`
    INSERT INTO users (username, full_name, email, password_hash, role, department_id)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(username, full_name, email || null, hashPassword(password), finalRole, finalDept);
  audit(req, 'user', info.lastInsertRowid, 'create', null,
        { id: info.lastInsertRowid, username, full_name, email: email || null, role: finalRole, department_id: finalDept });
  res.status(201).json({ id: info.lastInsertRowid });
});
// Edit existing user (admin only). All fields optional; password, if
// provided, is rehashed.
router.patch('/users/:id', requireAuth, requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  const { full_name, email, role, department_id, password } = req.body || {};
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'invalid id' });
  const before = db.prepare('SELECT id, username, full_name, email, role, department_id FROM users WHERE id = ?').get(id);
  if (!before) return res.status(404).json({ error: 'user not found' });

  const updates = [];
  const params  = [];
  if (full_name !== undefined) { updates.push('full_name = ?'); params.push(full_name); }
  if (email     !== undefined) { updates.push('email = ?');     params.push(email || null); }
  if (role      !== undefined) {
    if (!['staff','manager','admin'].includes(role)) return res.status(400).json({ error: 'invalid role' });
    updates.push('role = ?'); params.push(role);
  }
  if (department_id !== undefined) {
    const d = Number.isFinite(+department_id) ? +department_id : null;
    updates.push('department_id = ?'); params.push(d);
  }
  if (password) {
    updates.push('password_hash = ?');
    params.push(hashPassword(password));
  }
  if (updates.length === 0) return res.json({ ok: true, updated: 0 });
  params.push(id);
  db.prepare(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`).run(...params);
  const after = db.prepare('SELECT id, username, full_name, email, role, department_id FROM users WHERE id = ?').get(id);
  audit(req, 'user', id, 'update', before, after);
  res.json({ ok: true, updated: updates.length });
});

router.delete('/users/:id', requireAuth, requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  if (id === req.user.id) return res.status(400).json({ error: 'cannot delete yourself' });
  const before = db.prepare('SELECT id, username, full_name, email, role, department_id FROM users WHERE id = ?').get(id);
  const info = db.prepare('DELETE FROM users WHERE id = ?').run(id);
  if (info.changes === 0) return res.status(404).json({ error: 'user not found' });
  audit(req, 'user', id, 'delete', before, null);
  res.json({ ok: true });
});

// ---- Items ----
router.get('/items', requireAuth, (req, res) => {
  const { q, category, low } = req.query;
  const clauses = ['active = 1'];
  const params = [];
  if (q) { clauses.push('(name LIKE ? OR sku LIKE ?)'); params.push(`%${q}%`, `%${q}%`); }
  if (category) { clauses.push('category = ?'); params.push(category); }
  if (low === '1') clauses.push('quantity <= min_quantity');
  const where = `WHERE ${clauses.join(' AND ')}`;
  const rows = db.prepare(`
    SELECT * FROM items ${where}
    ORDER BY (quantity <= min_quantity) DESC, name ASC
  `).all(...params);
  res.json({ items: rows });
});

router.get('/items/:id', requireAuth, (req, res) => {
  const item = db.prepare('SELECT * FROM items WHERE id = ?').get(req.params.id);
  if (!item) return res.status(404).json({ error: 'item not found' });
  const movements = db.prepare(`
    SELECT m.*, u.full_name AS user_name, u.username,
           r.name AS requester_name, d.name AS department_name
    FROM movements m
    LEFT JOIN users u ON u.id = m.user_id
    LEFT JOIN requesters r ON r.id = m.requester_id
    LEFT JOIN departments d ON d.id = m.department_id
    WHERE m.item_id = ?
    ORDER BY m.created_at DESC
    LIMIT 100
  `).all(req.params.id);
  res.json({ item, movements });
});

router.post('/items', requireAuth, requireAdmin, (req, res) => {
  const { sku, name, category, unit, quantity, min_quantity, unit_price, purchase_price, location, notes, active } = req.body || {};
  if (!sku || !name || !category) {
    return res.status(400).json({ error: 'sku, name, category required' });
  }
  try {
    const info = db.prepare(`
      INSERT INTO items (sku, name, category, unit, quantity, min_quantity, unit_price, purchase_price, location, notes, active)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      sku, name, category,
      unit || 'pcs',
      Number.isFinite(+quantity) ? +quantity : 0,
      Number.isFinite(+min_quantity) ? +min_quantity : 5,
      Number.isFinite(+unit_price) ? +unit_price : 0,
      Number.isFinite(+purchase_price) ? +purchase_price : 0,
      location || null,
      notes || null,
      active === 0 || active === false ? 0 : 1
    );
    // Opening balance counts as a stock-in movement for traceability
    const opening = Number.isFinite(+quantity) ? +quantity : 0;
    if (opening > 0) {
      db.prepare(`
        INSERT INTO movements (item_id, user_id, type, quantity, reason, counterparty)
        VALUES (?, ?, 'in', ?, 'Opening balance', NULL)
      `).run(info.lastInsertRowid, req.user.id, opening);
    }
    res.status(201).json({ id: info.lastInsertRowid });
    const created = db.prepare('SELECT * FROM items WHERE id = ?').get(info.lastInsertRowid);
    audit(req, 'item', info.lastInsertRowid, 'create', null, created);
  } catch (err) {
    if (String(err.message).includes('UNIQUE')) return res.status(409).json({ error: 'sku already exists' });
    res.status(500).json({ error: err.message });
  }
});

router.patch('/items/:id', requireAuth, requireAdmin, (req, res) => {
  const before = db.prepare('SELECT * FROM items WHERE id = ?').get(req.params.id);
  if (!before) return res.status(404).json({ error: 'item not found' });
  const allowed = ['name','category','unit','min_quantity','unit_price','purchase_price','location','notes','active'];
  const sets = [];
  const params = [];
  for (const k of allowed) {
    if (k in req.body) {
      const v = req.body[k];
      if (k === 'active') { sets.push('active = ?'); params.push(v === 0 || v === false ? 0 : 1); }
      else { sets.push(`${k} = ?`); params.push(v); }
    }
  }
  if (sets.length === 0) return res.status(400).json({ error: 'no editable fields supplied' });
  sets.push(`updated_at = datetime('now')`);
  params.push(req.params.id);
  const info = db.prepare(`UPDATE items SET ${sets.join(', ')} WHERE id = ?`).run(...params);
  if (info.changes === 0) return res.status(404).json({ error: 'item not found' });
  const after = db.prepare('SELECT * FROM items WHERE id = ?').get(req.params.id);
  audit(req, 'item', Number(req.params.id), 'update', before, after);
  res.json({ ok: true });
});

router.delete('/items/:id', requireAuth, requireAdmin, (req, res) => {
  const before = db.prepare('SELECT * FROM items WHERE id = ?').get(req.params.id);
  const info = db.prepare('DELETE FROM items WHERE id = ?').run(req.params.id);
  if (info.changes === 0) return res.status(404).json({ error: 'item not found' });
  audit(req, 'item', Number(req.params.id), 'delete', before, null);
  res.json({ ok: true });
});

// ---- Stock movements ----
router.post('/items/:id/in', requireAuth, (req, res) => {
  const b = req.body || {};
  const qty = Number(b.quantity);
  const reason = b.reason || null;
  const counterparty = b.counterparty || null;
  const supplier = b.supplier || null;
  const deliveryNote = b.delivery_note || null;
  const entryType = b.entry_type || null;
  const comment = b.comment || null;
  if (!Number.isFinite(qty) || qty <= 0) return res.status(400).json({ error: 'quantity must be a positive number' });
  const id = Number(req.params.id);
  const tx = db.transaction(() => {
    const item = db.prepare('SELECT id, quantity FROM items WHERE id = ?').get(id);
    if (!item) throw new Error('item not found');
    db.prepare('UPDATE items SET quantity = quantity + ?, updated_at = datetime(\'now\') WHERE id = ?').run(qty, id);
    const info = db.prepare(`
      INSERT INTO movements (item_id, user_id, type, quantity, reason, counterparty,
                             supplier, delivery_note, entry_type, comment)
      VALUES (?, ?, 'in', ?, ?, ?, ?, ?, ?, ?)
    `).run(id, req.user.id, qty, reason, counterparty, supplier, deliveryNote, entryType, comment);
    return info.lastInsertRowid;
  });
  try {
    const mvId = tx();
    const created = db.prepare('SELECT * FROM movements WHERE id = ?').get(mvId);
    audit(req, 'movement', mvId, 'create', null, created);
    res.status(201).json({ id: mvId });
  } catch (err) {
    res.status(err.message === 'item not found' ? 404 : 500).json({ error: err.message });
  }
});

router.post('/items/:id/out', requireAuth, (req, res) => {
  const b = req.body || {};
  const qty = Number(b.quantity);
  const reason = b.reason || null;
  const counterparty = b.counterparty || null;
  const requesterId = Number.isFinite(+b.requester_id) ? +b.requester_id : null;
  const departmentId = Number.isFinite(+b.department_id) ? +b.department_id : null;
  const comment = b.comment || null;
  if (!Number.isFinite(qty) || qty <= 0) return res.status(400).json({ error: 'quantity must be a positive number' });
  const id = Number(req.params.id);
  const tx = db.transaction(() => {
    const item = db.prepare('SELECT id, quantity FROM items WHERE id = ?').get(id);
    if (!item) throw new Error('item not found');
    if (item.quantity < qty) throw new Error('insufficient stock');
    db.prepare('UPDATE items SET quantity = quantity - ?, updated_at = datetime(\'now\') WHERE id = ?').run(qty, id);
    const info = db.prepare(`
      INSERT INTO movements (item_id, user_id, type, quantity, reason, counterparty,
                             requester_id, department_id, comment)
      VALUES (?, ?, 'out', ?, ?, ?, ?, ?, ?)
    `).run(id, req.user.id, qty, reason, counterparty, requesterId, departmentId, comment);
    return info.lastInsertRowid;
  });
  try {
    const mvId = tx();
    const created = db.prepare('SELECT * FROM movements WHERE id = ?').get(mvId);
    audit(req, 'movement', mvId, 'create', null, created);
    res.status(201).json({ id: mvId });
  } catch (err) {
    if (err.message === 'item not found') return res.status(404).json({ error: err.message });
    if (err.message === 'insufficient stock') return res.status(409).json({ error: err.message });
    res.status(500).json({ error: err.message });
  }
});

// ---- History / reports ----
router.get('/movements', requireAuth, (req, res) => {
  const { item_id, user_id, type, limit } = req.query;
  const clauses = [];
  const params = [];
  if (item_id) { clauses.push('m.item_id = ?'); params.push(+item_id); }
  if (user_id) { clauses.push('m.user_id = ?'); params.push(+user_id); }
  if (type === 'in' || type === 'out') { clauses.push('m.type = ?'); params.push(type); }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const cap = Math.min(parseInt(limit, 10) || 200, 1000);
  const rows = db.prepare(`
    SELECT m.*, i.name AS item_name, i.sku, u.full_name AS user_name, u.username,
           r.name AS requester_name, d.name AS department_name
    FROM movements m
    LEFT JOIN items i ON i.id = m.item_id
    LEFT JOIN users u ON u.id = m.user_id
    LEFT JOIN requesters r ON r.id = m.requester_id
    LEFT JOIN departments d ON d.id = m.department_id
    ${where}
    ORDER BY m.created_at DESC, m.id DESC
    LIMIT ${cap}
  `).all(...params);
  res.json({ movements: rows });
});

router.get('/stats/summary', requireAuth, (_req, res) => {
  const totals = db.prepare(`
    SELECT
      COUNT(*) AS item_count,
      COALESCE(SUM(quantity * COALESCE(NULLIF(purchase_price, 0), unit_price)), 0) AS inventory_value,
      COALESCE(SUM(CASE WHEN quantity <= min_quantity THEN 1 ELSE 0 END), 0) AS low_stock_count,
      COALESCE(SUM(CASE WHEN quantity = 0 THEN 1 ELSE 0 END), 0) AS out_of_stock_count
    FROM items
  `).get();
  const movement7d = db.prepare(`
    SELECT type, COALESCE(SUM(quantity), 0) AS qty
    FROM movements
    WHERE created_at >= datetime('now', '-7 days')
    GROUP BY type
  `).all();
  const inQty = (movement7d.find(r => r.type === 'in') || {}).qty || 0;
  const outQty = (movement7d.find(r => r.type === 'out') || {}).qty || 0;
  const top = db.prepare(`
    SELECT i.name, i.sku, COUNT(*) AS cnt
    FROM movements m JOIN items i ON i.id = m.item_id
    WHERE m.type = 'out' AND m.created_at >= datetime('now', '-30 days')
    GROUP BY m.item_id ORDER BY cnt DESC LIMIT 5
  `).all();
  res.json({ totals, last7days: { in: inQty, out: outQty }, topConsumed: top });
});

// =================================================================
// v2 add-on routes: requesters, departments, alerts, scan, import/export
// =================================================================

// ---- Requesters (admin CRUD; any-auth can list) ----
router.get('/requesters', requireAuth, (_req, res) => {
  const rows = db.prepare('SELECT * FROM requesters ORDER BY name ASC').all();
  res.json({ requesters: rows });
});
router.post('/requesters', requireAuth, requireAdmin, (req, res) => {
  const { name, email, phone } = req.body || {};
  if (!name) return res.status(400).json({ error: 'name required' });
  const info = db.prepare('INSERT INTO requesters (name, email, phone) VALUES (?, ?, ?)').run(name, email || null, phone || null);
  const created = db.prepare('SELECT * FROM requesters WHERE id = ?').get(info.lastInsertRowid);
  audit(req, 'requester', info.lastInsertRowid, 'create', null, created);
  res.status(201).json({ id: info.lastInsertRowid });
});
router.put('/requesters/:id', requireAuth, requireAdmin, (req, res) => {
  const before = db.prepare('SELECT * FROM requesters WHERE id = ?').get(req.params.id);
  if (!before) return res.status(404).json({ error: 'requester not found' });
  const { name, email, phone } = req.body || {};
  const sets = [];
  const params = [];
  if (name  !== undefined) { sets.push('name = ?');  params.push(name); }
  if (email !== undefined) { sets.push('email = ?'); params.push(email || null); }
  if (phone !== undefined) { sets.push('phone = ?'); params.push(phone || null); }
  if (sets.length === 0) return res.json({ ok: true, updated: 0 });
  params.push(req.params.id);
  const info = db.prepare(`UPDATE requesters SET ${sets.join(', ')} WHERE id = ?`).run(...params);
  if (info.changes === 0) return res.status(404).json({ error: 'requester not found' });
  const after = db.prepare('SELECT * FROM requesters WHERE id = ?').get(req.params.id);
  audit(req, 'requester', Number(req.params.id), 'update', before, after);
  res.json({ ok: true });
});
router.delete('/requesters/:id', requireAuth, requireAdmin, (req, res) => {
  const before = db.prepare('SELECT * FROM requesters WHERE id = ?').get(req.params.id);
  const info = db.prepare('DELETE FROM requesters WHERE id = ?').run(req.params.id);
  if (info.changes === 0) return res.status(404).json({ error: 'requester not found' });
  audit(req, 'requester', Number(req.params.id), 'delete', before, null);
  res.json({ ok: true });
});

// ---- Departments (admin CRUD; any-auth can list) ----
router.get('/departments', requireAuth, (_req, res) => {
  const rows = db.prepare('SELECT * FROM departments ORDER BY name ASC').all();
  res.json({ departments: rows });
});
router.post('/departments', requireAuth, requireAdmin, (req, res) => {
  const { name, description } = req.body || {};
  if (!name) return res.status(400).json({ error: 'name required' });
  try {
    const info = db.prepare('INSERT INTO departments (name, description) VALUES (?, ?)').run(name, description || null);
    const created = db.prepare('SELECT * FROM departments WHERE id = ?').get(info.lastInsertRowid);
    audit(req, 'department', info.lastInsertRowid, 'create', null, created);
    res.status(201).json({ id: info.lastInsertRowid });
  } catch (err) {
    if (String(err.message).includes('UNIQUE')) return res.status(409).json({ error: 'department name already exists' });
    res.status(500).json({ error: err.message });
  }
});
router.put('/departments/:id', requireAuth, requireAdmin, (req, res) => {
  const before = db.prepare('SELECT * FROM departments WHERE id = ?').get(req.params.id);
  if (!before) return res.status(404).json({ error: 'department not found' });
  const { name, description } = req.body || {};
  // Build dynamic UPDATE — only touch fields the client actually sent.
  const sets = [];
  const params = [];
  if (name        !== undefined) { sets.push('name = ?');        params.push(name); }
  if (description !== undefined) { sets.push('description = ?'); params.push(description || null); }
  if (sets.length === 0) return res.json({ ok: true, updated: 0 });
  params.push(req.params.id);
  try {
    const info = db.prepare(`UPDATE departments SET ${sets.join(', ')} WHERE id = ?`).run(...params);
    if (info.changes === 0) return res.status(404).json({ error: 'department not found' });
    const after = db.prepare('SELECT * FROM departments WHERE id = ?').get(req.params.id);
    audit(req, 'department', Number(req.params.id), 'update', before, after);
    res.json({ ok: true });
  } catch (err) {
    if (String(err.message).includes('UNIQUE')) return res.status(409).json({ error: 'department name already exists' });
    res.status(500).json({ error: err.message });
  }
});
router.delete('/departments/:id', requireAuth, requireAdmin, (req, res) => {
  const before = db.prepare('SELECT * FROM departments WHERE id = ?').get(req.params.id);
  const info = db.prepare('DELETE FROM departments WHERE id = ?').run(req.params.id);
  if (info.changes === 0) return res.status(404).json({ error: 'department not found' });
  audit(req, 'department', Number(req.params.id), 'delete', before, null);
  res.json({ ok: true });
});

// ---- Alerts (low-stock items, with last movement date) ----
router.get('/alerts', requireAuth, (_req, res) => {
  const rows = db.prepare(`
    SELECT i.*,
      (SELECT MAX(m.created_at) FROM movements m WHERE m.item_id = i.id) AS last_movement_at,
      (SELECT m.type FROM movements m WHERE m.item_id = i.id ORDER BY m.id DESC LIMIT 1) AS last_movement_type
    FROM items i
    WHERE i.active = 1 AND i.quantity <= i.min_quantity
    ORDER BY (CASE WHEN i.quantity = 0 THEN 0 ELSE 1 END), i.name ASC
  `).all();
  res.json({ alerts: rows });
});

// ---- Scan (lookup item by SKU/codebar) ----
router.get('/scan', requireAuth, (req, res) => {
  const code = (req.query.code || '').toString().trim();
  if (!code) return res.status(400).json({ error: 'code query param required' });
  const item = db.prepare('SELECT * FROM items WHERE sku = ? OR sku = ? LIMIT 1').get(code, code.toUpperCase());
  if (!item) return res.status(404).json({ error: 'item not found' });
  res.json({ item });
});

// ---- Export CSV ----
function csvEscape(v) {
  if (v === null || v === undefined) return '';
  const s = String(v);
  if (/[",\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
  return s;
}
router.get('/export/items', requireAuth, (_req, res) => {
  const rows = db.prepare('SELECT * FROM items ORDER BY name ASC').all();
  const cols = ['id','sku','name','category','unit','quantity','min_quantity','unit_price','purchase_price','active','location','notes','created_at','updated_at'];
  const out = [cols.join(',')].concat(
    rows.map(r => cols.map(c => csvEscape(r[c])).join(','))
  ).join('\n');
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="items.csv"');
  res.send(out);
});
router.get('/export/movements', requireAuth, (_req, res) => {
  const rows = db.prepare(`
    SELECT m.id, m.created_at, m.type, m.quantity, m.reason, m.counterparty,
           m.supplier, m.delivery_note, m.entry_type, m.requester_id, m.department_id, m.comment,
           i.sku, i.name AS item_name, u.username
    FROM movements m
    LEFT JOIN items i ON i.id = m.item_id
    LEFT JOIN users u ON u.id = m.user_id
    ORDER BY m.created_at DESC
  `).all();
  const cols = ['id','created_at','type','quantity','reason','counterparty','supplier','delivery_note','entry_type','requester_id','department_id','comment','sku','item_name','username'];
  const out = [cols.join(',')].concat(
    rows.map(r => cols.map(c => csvEscape(r[c])).join(','))
  ).join('\n');
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="movements.csv"');
  res.send(out);
});

// ---- Import items CSV (admin). Accepts raw text body (Content-Type: text/csv) or JSON {csv: "..."} ----
router.post('/import/items', requireAuth, requireAdmin, (req, res) => {
  let text = '';
  if (typeof req.body === 'string') text = req.body;
  else if (req.body && typeof req.body.csv === 'string') text = req.body.csv;
  if (!text) return res.status(400).json({ error: 'no CSV body provided' });
  // Strip BOM, parse comma-separated with quote support.
  if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
  const lines = text.split(/\r?\n/).filter(l => l.length > 0);
  if (lines.length < 2) return res.status(400).json({ error: 'CSV needs a header and at least one row' });
  const parseLine = (line) => {
    const out = []; let cur = ''; let inQ = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (inQ) {
        if (ch === '"' && line[i+1] === '"') { cur += '"'; i++; }
        else if (ch === '"') inQ = false;
        else cur += ch;
      } else {
        if (ch === ',') { out.push(cur); cur = ''; }
        else if (ch === '"') inQ = true;
        else cur += ch;
      }
    }
    out.push(cur);
    return out;
  };
  const header = parseLine(lines[0]).map(s => s.trim().toLowerCase());
  const required = ['sku','name','category'];
  for (const r of required) if (!header.includes(r)) return res.status(400).json({ error: `missing required column: ${r}` });
  const idx = (k) => header.indexOf(k);
  const ins = db.prepare(`
    INSERT OR IGNORE INTO items (sku, name, category, unit, quantity, min_quantity, unit_price, purchase_price, location, notes)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  let inserted = 0, skipped = 0;
  const tx = db.transaction(() => {
    for (let i = 1; i < lines.length; i++) {
      const cells = parseLine(lines[i]);
      if (cells.length < 3) { skipped++; continue; }
      const sku = (cells[idx('sku')] || '').trim();
      const name = (cells[idx('name')] || '').trim();
      const category = (cells[idx('category')] || '').trim();
      if (!sku || !name || !category) { skipped++; continue; }
      const unit = idx('unit') >= 0 ? (cells[idx('unit')] || 'pcs').trim() : 'pcs';
      const quantity = idx('quantity') >= 0 ? +cells[idx('quantity')] || 0 : 0;
      const min_quantity = idx('min_quantity') >= 0 ? +cells[idx('min_quantity')] || 5 : 5;
      const unit_price = idx('unit_price') >= 0 ? +cells[idx('unit_price')] || 0 : 0;
      const purchase_price = idx('purchase_price') >= 0 ? +cells[idx('purchase_price')] || 0 : 0;
      const location = idx('location') >= 0 ? (cells[idx('location')] || '').trim() || null : null;
      const notes = idx('notes') >= 0 ? (cells[idx('notes')] || '').trim() || null : null;
      const r = ins.run(sku, name, category, unit, quantity, min_quantity, unit_price, purchase_price, location, notes);
      if (r.changes > 0) inserted++; else skipped++;
    }
  });
  try { tx(); } catch (err) { return res.status(500).json({ error: err.message }); }
  res.json({ inserted, skipped });
});

// ---- Settings (admin) ----
// Single-row key/value store for app-wide settings (idle timeout, default
// language, …). Read by any authenticated user; updated by admin only.
router.get('/settings', requireAuth, (_req, res) => {
  const rows = db.prepare('SELECT key, value FROM settings').all();
  const out = {};
  for (const r of rows) out[r.key] = r.value;
  res.json(out);
});
router.put('/settings', requireAuth, requireAdmin, (req, res) => {
  const body = req.body || {};
  const upsert = db.prepare(`
    INSERT INTO settings (key, value) VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `);
  let updated = 0;
  for (const [k, v] of Object.entries(body)) {
    if (typeof v === 'string' || typeof v === 'number') {
      upsert.run(k, String(v));
      updated++;
    }
  }
  res.json({ ok: true, updated });
});

// ---- Audit log (admin) ----
// Returns the most recent N audit entries joined with the actor's
// username/full_name so the Admin UI can show "who did what".
router.get('/audit-log', requireAuth, requireAdmin, (req, res) => {
  const limit = Math.max(1, Math.min(500, Number(req.query.limit) || 100));
  const entity = String(req.query.entity || '').trim();
  const where = entity ? 'WHERE a.entity = ?' : '';
  const params = entity ? [entity] : [];
  params.push(limit);
  const rows = db.prepare(`
    SELECT a.id, a.actor_user_id, a.entity, a.entity_id, a.action,
           a.before_json, a.after_json, a.ip, a.created_at,
           u.username AS actor_username, u.full_name AS actor_full_name
    FROM audit_log a
    LEFT JOIN users u ON u.id = a.actor_user_id
    ${where}
    ORDER BY a.id DESC
    LIMIT ?
  `).all(...params);
  res.json({ entries: rows });
});

// ---- Database backup (admin) ----
// Streams a snapshot of the live SQLite file as a downloadable
// attachment. better-sqlite3's `.backup()` API writes to a file path;
// we use a temp file, then stream it to the response with the right
// Content-Disposition so the browser saves it as
// stockroom-backup-<timestamp>.sqlite.
router.get('/backup.sqlite', backupLimiter, requireAuth, requireAdmin, async (_req, res) => {
  const fs   = require('fs');
  const path = require('path');
  const os   = require('os');
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const tmp   = path.join(os.tmpdir(), 'stockroom-backup-' + Date.now() + '.sqlite');
  try {
    await db.backup(tmp);
    const stat = fs.statSync(tmp);
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="stockroom-backup-${stamp}.sqlite"`);
    res.setHeader('Content-Length', String(stat.size));
    fs.createReadStream(tmp).pipe(res);
    res.on('finish', () => { try { fs.unlinkSync(tmp); } catch {} });
    res.on('error',  () => { try { fs.unlinkSync(tmp); } catch {} });
  } catch (err) {
    try { fs.unlinkSync(tmp); } catch {}
    console.error('[backup] failed:', err);
    if (!res.headersSent) res.status(500).json({ error: err.message });
  }
});

// ---- Database restore (admin, DANGEROUS) ----
// Accepts a raw SQLite file in the request body and replaces the
// current data/stock.db. The server must be restarted afterwards for
// the changes to take effect, since better-sqlite3 keeps the DB open
// for the life of the process. We validate the bytes (must start with
// the SQLite magic header) before swapping, then schedule a process
// exit so the operator can re-launch the server.
router.post('/restore.sqlite', restoreLimiter, requireAuth, requireAdmin, (req, res) => {
  const fs = require('fs');
  const path = require('path');
  const buf = req.body;
  if (!buf || !Buffer.isBuffer(buf) || buf.length < 100) {
    return res.status(400).json({ error: 'upload a SQLite file in the request body' });
  }
  // SQLite files start with "SQLite format 3\0" (16 bytes).
  const header = buf.slice(0, 16).toString('utf8');
  if (!header.startsWith('SQLite format 3')) {
    return res.status(400).json({ error: 'not a valid SQLite file (bad magic header)' });
  }
  const dbPath = path.join(__dirname, '..', 'data', 'stock.db');
  const tmpPath = dbPath + '.restore-' + Date.now();
  try {
    fs.writeFileSync(tmpPath, buf);
    // Atomic-ish swap: rename current to .bak, then move tmp into place.
    // If something fails mid-way, the original is still there as .bak.
    const bakPath = dbPath + '.bak-' + Date.now();
    if (fs.existsSync(dbPath)) fs.renameSync(dbPath, bakPath);
    fs.renameSync(tmpPath, dbPath);
    console.log('[restore] database replaced (old at', bakPath + ')');
    // Schedule server exit after responding so the file lock releases
    // and the operator can re-launch with fresh data.
    setTimeout(() => {
      console.log('[restore] exiting so the server can be restarted with the new DB');
      process.exit(0);
    }, 500);
    res.json({ ok: true, restored: 'all', note: 'Server is restarting — refresh in a few seconds.' });
  } catch (err) {
    // Clean up tmp file on failure.
    try { fs.unlinkSync(tmpPath); } catch {}
    res.status(500).json({ error: err.message });
  }
});


// ---- AI assistant (Stockie) ----------------------------------------
// Authenticated chat that proxies to the configured LLM (OMNIROUTE_*).
// Reads run server-side; writes return as proposals the client must
// POST back to /assistant/execute with a matching proposal_id.
router.post('/assistant/chat', requireAuth, async (req, res) => {
  if (!assistant.enabled()) {
    return res.status(503).json({ error: 'assistant not configured (set OMNIROUTE_BASE_URL, OMNIROUTE_MODEL, OMNIROUTE_API_KEY in .env)' });
  }
  const messages = Array.isArray(req.body && req.body.messages) ? req.body.messages : [];
  if (messages.length === 0) return res.status(400).json({ error: 'messages required' });
  // Cap conversation length so a runaway client can't blow up context.
  const trimmed = messages.slice(-24);
  try {
    const out = await assistant.chat({ messages: trimmed, user: req.user });
    res.json(out);
  } catch (e) {
    console.error('[assistant] chat failed:', e.message);
    res.status(500).json({ error: e.message });
  }
});

router.post('/assistant/execute', requireAuth, (req, res) => {
  if (!assistant.enabled()) {
    return res.status(503).json({ error: 'assistant not configured' });
  }
  assistant.executeProposal(req, res);
});

// Lightweight probe so the client can show "Stockie is ready / not
// configured" in the widget header without making a chat call.
router.get('/assistant/status', requireAuth, (_req, res) => {
  res.json({ enabled: assistant.enabled(), tools: assistant.TOOLS.length });
});

module.exports = router;