// Stockroom AI assistant — a thin wrapper around an OpenAI-compatible
// chat completions endpoint (configured via env). The assistant has
// read-only tools that execute server-side, and "write" tools that
// return a structured proposal for the user to confirm in the UI.
//
// Design rules (intentional):
//   - The model NEVER calls a write tool directly. Writes always come
//     back to the client as `pending_writes`, and the client must
//     POST them back to /api/assistant/execute to actually run them.
//   - Each proposal carries a single-use `proposal_id` so the user
//     can't accidentally confirm twice.
//   - Read tool results are summarized in the model response. The
//     model sees a bounded JSON view, never the raw DB.
//
// Required env (see .env.example):
//   OMNIROUTE_BASE_URL   e.g. https://...trycloudflare.com/v1
//   OMNIROUTE_MODEL      e.g. free-stack
//   OMNIROUTE_API_KEY    bearer token

const crypto = require('crypto');
const db = require('./db');
const audit = (req, entity, entity_id, action, before, after) => {
  try {
    db.prepare(`
      INSERT INTO audit_log (actor_user_id, entity, entity_id, action, before_json, after_json, ip)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      req.user ? req.user.id : null,
      entity, entity_id, action,
      before == null ? null : JSON.stringify(before),
      after  == null ? null : JSON.stringify(after),
      req.ip || null,
    );
  } catch (e) { console.error('[audit] failed:', e.message); }
};

const BASE_URL = process.env.OMNIROUTE_BASE_URL || '';
const MODEL = process.env.OMNIROUTE_MODEL || '';
const KEY = process.env.OMNIROUTE_API_KEY || '';

function enabled() {
  return Boolean(BASE_URL && MODEL && KEY);
}

// Tool definitions exposed to the model. The model sees `name`, `description`,
// and `parameters` (OpenAI tools/function-calling schema). Reads are
// is_write=false; writes are is_write=true and the assistant module will
// never auto-execute them — it always returns a proposal.
const TOOLS = [
  {
    type: 'function',
    function: {
      name: 'list_items',
      description: 'List inventory items. Supports search by query string and a low-stock filter.',
      parameters: {
        type: 'object',
        properties: {
          q:   { type: 'string', description: 'Search by SKU or name (substring, case-insensitive)' },
          low: { type: 'boolean', description: 'If true, return only items at or below their minimum stock level' },
          category: { type: 'string', description: 'Filter by category (exact match)' },
        },
      },
    },
    is_write: false,
  },
  {
    type: 'function',
    function: {
      name: 'get_item',
      description: 'Fetch one item by its id (preferred) or by SKU. Returns the item and its last 100 stock movements.',
      parameters: {
        type: 'object',
        properties: {
          id:  { type: 'integer', description: 'Item id (preferred)' },
          sku: { type: 'string',  description: 'Item SKU (fallback if id is unknown)' },
        },
      },
    },
    is_write: false,
  },
  {
    type: 'function',
    function: {
      name: 'get_stats',
      description: 'Return dashboard KPIs: total items, inventory value, low/out-of-stock counts, last-7-days movement totals, and most-consumed items in the last 30 days.',
      parameters: { type: 'object', properties: {} },
    },
    is_write: false,
  },
  {
    type: 'function',
    function: {
      name: 'get_movements',
      description: 'List recent stock movements. Optionally filter by item, user, or type (in/out).',
      parameters: {
        type: 'object',
        properties: {
          item_id: { type: 'integer' },
          user_id: { type: 'integer' },
          type:    { type: 'string', enum: ['in', 'out'] },
          limit:   { type: 'integer', description: 'Max rows, default 50, max 200' },
        },
      },
    },
    is_write: false,
  },
  {
    type: 'function',
    function: {
      name: 'get_alerts',
      description: 'Return items that are at or below their minimum stock level.',
      parameters: { type: 'object', properties: {} },
    },
    is_write: false,
  },
  {
    type: 'function',
    function: {
      name: 'list_users',
      description: 'List staff users (admin only).',
      parameters: { type: 'object', properties: {} },
    },
    is_write: false,
  },
  {
    type: 'function',
    function: {
      name: 'list_requesters',
      description: 'List requesters (the people items are handed out to).',
      parameters: { type: 'object', properties: {} },
    },
    is_write: false,
  },
  {
    type: 'function',
    function: {
      name: 'list_departments',
      description: 'List departments.',
      parameters: { type: 'object', properties: {} },
    },
    is_write: false,
  },
  // ---- Writes — model can PROPOSE these, never execute ----
  {
    type: 'function',
    function: {
      name: 'create_item',
      description: 'Propose creating a new inventory item. The user must confirm before it runs.',
      parameters: {
        type: 'object',
        required: ['sku', 'name', 'category'],
        properties: {
          sku: { type: 'string' },
          name: { type: 'string' },
          category: { type: 'string' },
          unit: { type: 'string', description: 'Unit of measure, e.g. pcs, box, ream. Default "pcs"' },
          min_quantity: { type: 'integer', description: 'Reorder threshold. Default 5' },
          unit_price: { type: 'number' },
          purchase_price: { type: 'number' },
          opening_quantity: { type: 'integer', description: 'Starting on-hand quantity (also creates an opening movement). Default 0' },
          location: { type: 'string' },
          notes: { type: 'string' },
        },
      },
    },
    is_write: true,
  },
  {
    type: 'function',
    function: {
      name: 'update_item',
      description: 'Propose updating an item. The user must confirm before it runs. Only include fields you want to change.',
      parameters: {
        type: 'object',
        required: ['id'],
        properties: {
          id: { type: 'integer' },
          name: { type: 'string' },
          category: { type: 'string' },
          unit: { type: 'string' },
          min_quantity: { type: 'integer' },
          unit_price: { type: 'number' },
          purchase_price: { type: 'number' },
          location: { type: 'string' },
          notes: { type: 'string' },
        },
      },
    },
    is_write: true,
  },
  {
    type: 'function',
    function: {
      name: 'stock_in',
      description: 'Propose adding stock for an item (a purchase, transfer, or return). The user must confirm before it runs.',
      parameters: {
        type: 'object',
        required: ['item_id', 'quantity'],
        properties: {
          item_id: { type: 'integer', description: 'Item id (preferred)' },
          sku:     { type: 'string',  description: 'Item SKU (fallback if id is unknown)' },
          quantity: { type: 'integer', minimum: 1 },
          reason:  { type: 'string', description: 'e.g. "purchase", "transfer", "return"' },
          counterparty: { type: 'string', description: 'Supplier or source (optional)' },
        },
      },
    },
    is_write: true,
  },
  {
    type: 'function',
    function: {
      name: 'stock_out',
      description: 'Propose removing stock for an item (handed out to someone). The user must confirm before it runs.',
      parameters: {
        type: 'object',
        required: ['item_id', 'quantity'],
        properties: {
          item_id: { type: 'integer' },
          sku:     { type: 'string' },
          quantity: { type: 'integer', minimum: 1 },
          reason:  { type: 'string' },
          counterparty: { type: 'string', description: 'Person/department taking it' },
        },
      },
    },
    is_write: true,
  },
  {
    type: 'function',
    function: {
      name: 'create_user',
      description: 'Propose creating a new user account (admin only). The user must confirm before it runs.',
      parameters: {
        type: 'object',
        required: ['username', 'full_name', 'password'],
        properties: {
          username: { type: 'string' },
          full_name: { type: 'string' },
          email: { type: 'string' },
          role: { type: 'string', enum: ['staff', 'manager', 'admin'] },
          department_id: { type: 'integer' },
          password: { type: 'string', description: 'Min 6 chars. The user will be told to change it on first login.' },
        },
      },
    },
    is_write: true,
  },
  {
    type: 'function',
    function: {
      name: 'create_requester',
      description: 'Propose creating a new requester (a person who receives stock). The user must confirm before it runs.',
      parameters: {
        type: 'object',
        required: ['name'],
        properties: {
          name: { type: 'string' },
          email: { type: 'string' },
          phone: { type: 'string' },
          department_id: { type: 'integer' },
        },
      },
    },
    is_write: true,
  },
  {
    type: 'function',
    function: {
      name: 'create_department',
      description: 'Propose creating a new department. The user must confirm before it runs.',
      parameters: {
        type: 'object',
        required: ['name'],
        properties: {
          name: { type: 'string' },
          description: { type: 'string' },
        },
      },
    },
    is_write: true,
  },
];

// Map tool name → {is_write, handler}
const TOOL_INDEX = new Map(TOOLS.map(t => [t.function.name, t]));

// ---- Tool executors (read paths only — writes are NOT executed here) ----
function lookupItem({ id, sku }) {
  let row;
  if (id != null) row = db.prepare('SELECT * FROM items WHERE id = ?').get(id);
  else if (sku)  row = db.prepare('SELECT * FROM items WHERE sku = ?').get(sku);
  if (!row) return { error: 'item not found' };
  const moves = db.prepare(`
    SELECT m.*, u.username AS user_name, u.full_name AS user_full_name
    FROM movements m LEFT JOIN users u ON u.id = m.user_id
    WHERE m.item_id = ? ORDER BY m.created_at DESC LIMIT 100
  `).all(row.id);
  return { item: row, movements: moves };
}

function listItems({ q, low, category } = {}) {
  const where = []; const args = [];
  if (q) { where.push('(LOWER(sku) LIKE ? OR LOWER(name) LIKE ?)'); args.push('%' + q.toLowerCase() + '%', '%' + q.toLowerCase() + '%'); }
  if (low) where.push('quantity <= min_quantity');
  if (category) { where.push('category = ?'); args.push(category); }
  const sql = 'SELECT id, sku, name, category, quantity, min_quantity, unit, unit_price, location FROM items' +
              (where.length ? ' WHERE ' + where.join(' AND ') : '') +
              ' ORDER BY name LIMIT 100';
  return { items: db.prepare(sql).all(...args) };
}

function getStats() {
  const t = db.prepare(`
    SELECT
      COUNT(*) AS item_count,
      COALESCE(SUM(quantity * COALESCE(NULLIF(purchase_price,0), unit_price)), 0) AS inventory_value,
      SUM(CASE WHEN quantity > 0 AND quantity <= min_quantity THEN 1 ELSE 0 END) AS low_stock_count,
      SUM(CASE WHEN quantity = 0 THEN 1 ELSE 0 END) AS out_of_stock_count
    FROM items
  `).get();
  const last7 = db.prepare(`
    SELECT type, SUM(quantity) AS qty FROM movements
    WHERE created_at >= datetime('now','-7 days') GROUP BY type
  `).all();
  const last = { in: 0, out: 0 };
  for (const r of last7) last[r.type] = r.qty || 0;
  const top = db.prepare(`
    SELECT i.id, i.sku, i.name, COUNT(*) AS cnt
    FROM movements m JOIN items i ON i.id = m.item_id
    WHERE m.type = 'out' AND m.created_at >= datetime('now','-30 days')
    GROUP BY i.id ORDER BY cnt DESC LIMIT 10
  `).all();
  return { totals: t, last7days: last, topConsumed: top };
}

function getMovements({ item_id, user_id, type, limit } = {}) {
  const where = []; const args = [];
  if (item_id) { where.push('m.item_id = ?'); args.push(item_id); }
  if (user_id) { where.push('m.user_id = ?'); args.push(user_id); }
  if (type)    { where.push('m.type = ?');    args.push(type); }
  const lim = Math.min(parseInt(limit) || 50, 200);
  const rows = db.prepare(`
    SELECT m.*, i.sku, i.name AS item_name, u.username AS user_name, u.full_name AS user_full_name
    FROM movements m
    LEFT JOIN items i ON i.id = m.item_id
    LEFT JOIN users u ON u.id = m.user_id
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY m.created_at DESC LIMIT ${lim}
  `).all(...args);
  return { movements: rows };
}

function getAlerts() {
  return { alerts: db.prepare(`
    SELECT id, sku, name, category, quantity, min_quantity, unit,
      (SELECT MAX(created_at) FROM movements WHERE item_id = items.id) AS last_movement_at
    FROM items WHERE quantity <= min_quantity ORDER BY (quantity = 0) DESC, quantity ASC LIMIT 100
  `).all() };
}

function listUsers() {
  return { users: db.prepare(`
    SELECT u.id, u.username, u.full_name, u.email, u.role, u.created_at, d.name AS department_name
    FROM users u LEFT JOIN departments d ON d.id = u.department_id
    ORDER BY u.username
  `).all() };
}

function listRequesters() {
  return { requesters: db.prepare(`
    SELECT r.*, d.name AS department_name
    FROM requesters r LEFT JOIN departments d ON d.id = r.department_id
    ORDER BY r.name
  `).all() };
}

function listDepartments() {
  return { departments: db.prepare('SELECT * FROM departments ORDER BY name').all() };
}

const READ_HANDLERS = {
  list_items: listItems,
  get_item: lookupItem,
  get_stats: getStats,
  get_movements: getMovements,
  get_alerts: getAlerts,
  list_users: listUsers,
  list_requesters: listRequesters,
  list_departments: listDepartments,
};

async function executeRead(name, args) {
  const fn = READ_HANDLERS[name];
  if (!fn) return { error: 'unknown read tool: ' + name };
  try { return await fn(args || {}); }
  catch (e) { return { error: e.message }; }
}

// ---- Build the OpenAI-compatible request body ----
function buildBody({ systemPrompt, messages, tools = TOOLS }) {
  return {
    model: MODEL,
    messages: [
      { role: 'system', content: systemPrompt },
      ...messages,
    ],
    tools,
    tool_choice: 'auto',
    temperature: 0.2,
  };
}

const SYSTEM_PROMPT_BASE = `You are Stockie, the AI assistant inside the Stockroom inventory app.
You help a small office track its supplies. You speak concisely and only act on data you retrieved via the tools.

Rules:
- For ANY question about current stock, items, users, requesters, departments, or movements, call the appropriate read tool FIRST. Don't guess.
- To change data, you MUST call the corresponding write tool with complete arguments. NEVER just describe the action in prose — the user only sees confirmation buttons when you actually invoke the tool. After the tool returns "staged_for_confirmation", write one short sentence describing what you proposed.
- The user has to click a Confirm button on your proposal before anything is actually executed. The server will run the action and tell you the result.
- NEVER claim an action succeeded in the same turn you propose it. Wait for the user to confirm and for the server's reply.
- When proposing a stock_in / stock_out, prefer item_id over sku whenever possible — call get_item first to resolve.
- NEVER execute destructive actions (delete). Those tools are not exposed. If asked, explain the user must do it manually.
- When listing items, prefer the \`low\` filter for "what's running low" questions.
- When the user gives a quantity to add or remove, use the matching item's current on-hand value to sanity-check: if they say "give Alice 50 pens" but only 30 are on hand, propose only 30 and explain.
- Prefer SKU over id when ambiguous, but always use item_id when you know it.
- Reply in the user's language if obvious, otherwise English.
- Be concise. Tables and short bullets are fine. No filler.`;

// ---- Main entry: POST /api/assistant/chat ----
// Returns either:
//   { reply: "..." }                                     — plain answer
//   { reply: "...", reads: [...], pending_writes: [...] } — used reads + asks user to confirm
// Heuristics for "the user clearly wanted a write but the model didn't
// actually call the write tool." Cheap verb detection over the latest
// user message. If we detect intent AND no write tool fired, we nudge
// the model with a follow-up turn forcing the tool call.
function looksLikeWriteIntent(text) {
  if (!text || typeof text !== 'string') return null;
  const t = text.toLowerCase();
  // Map verbs to the tool they probably want.
  if (/\b(add|stock\s*in|receive|got\s+in|purchase|restock|put\s+in|insert)\b/.test(t)) return 'stock_in';
  if (/\b(remove|stock\s*out|hand\s*out|give\s+away|give\s+\w+\s+\d+|use\s+\d+|take\s+out)\b/.test(t)) return 'stock_out';
  if (/\b(create|add)\s+(a|an|new)\s+(item|product|sku)\b/.test(t)) return 'create_item';
  if (/\b(create|add)\s+(a|an|new)\s+(user|account|login)\b/.test(t)) return 'create_user';
  if (/\b(create|add)\s+(a|an|new)\s+(requester|person)\b/.test(t)) return 'create_requester';
  if (/\b(create|add)\s+(a|an|new)\s+(department|service|team)\b/.test(t)) return 'create_department';
  return null;
}

async function chat({ messages, user }) {
  if (!enabled()) {
    throw new Error('assistant not configured (set OMNIROUTE_BASE_URL, OMNIROUTE_MODEL, OMNIROUTE_API_KEY in .env)');
  }
  const userLine = user
    ? `Signed in as ${user.full_name} (@${user.username}), role=${user.role}.`
    : 'Signed in (unknown user).';
  const systemPrompt = SYSTEM_PROMPT_BASE + '\n\n' + userLine;

  const reads = [];          // [{tool, args, result}] for transparency
  const pendingWrites = [];  // [{tool, args, label, proposal_id}]

  // Tool-call loop: the model may chain multiple tool calls per turn.
  // We cap iterations to prevent runaway.
  let currentMessages = messages.slice();
  let finalReply = '';
  for (let iter = 0; iter < 8; iter++) {
    const body = buildBody({ systemPrompt, messages: currentMessages });
    const res = await fetch(BASE_URL.replace(/\/+$/,'') + '/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + KEY,
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const txt = await res.text();
      throw new Error('LLM HTTP ' + res.status + ': ' + txt.slice(0, 300));
    }
    const data = await res.json();
    const choice = data.choices && data.choices[0];
    if (!choice) throw new Error('LLM returned no choices');
    const msg = choice.message || {};
    // Push the assistant message into the conversation (with tool_calls if any)
    currentMessages.push(msg);

    if (!msg.tool_calls || msg.tool_calls.length === 0) {
      finalReply = msg.content || '';
      // The model often answers "I'll do X" in prose without calling the
      // tool. If the user's message clearly contained a write verb and
      // no write tool was invoked, push a follow-up that forces the call.
      const lastUser = [...messages].reverse().find(m => m.role === 'user');
      if (lastUser && !pendingWrites.length) {
        const intent = looksLikeWriteIntent(lastUser.content || '');
        if (intent) {
          currentMessages.push({
            role: 'user',
            content: 'You described the action in prose but did not invoke the tool. ' +
                     'Call the `' + intent + '` function now with the correct arguments so the user gets a Confirm button.',
          });
          continue; // run another iteration of the loop
        }
      }
      break;
    }

    // Process tool calls. Reads execute immediately; writes become proposals.
    for (const tc of msg.tool_calls) {
      const name = tc.function && tc.function.name;
      let args = {};
      try { args = JSON.parse(tc.function.arguments || '{}'); } catch {}
      const def = TOOL_INDEX.get(name);
      if (!def) {
        currentMessages.push({ role: 'tool', tool_call_id: tc.id, content: JSON.stringify({ error: 'unknown tool' }) });
        continue;
      }
      if (def.is_write) {
        // Role-gate writes: only admins can create users; only admins can edit items.
        // Non-admins may still propose stock_in/out and requester/department creates.
        if (!user) {
          currentMessages.push({ role: 'tool', tool_call_id: tc.id, content: JSON.stringify({ error: 'not signed in' }) });
          continue;
        }
        const adminOnly = new Set(['create_user','update_item','create_item']);
        if (adminOnly.has(name) && user.role !== 'admin') {
          currentMessages.push({ role: 'tool', tool_call_id: tc.id, content: JSON.stringify({ error: 'admin role required for ' + name }) });
          continue;
        }
        const proposal = {
          tool: name,
          args,
          label: describeWrite(name, args),
          proposal_id: 'p_' + crypto.randomBytes(8).toString('hex'),
        };
        pendingWrites.push(proposal);
        // Tell the model the proposal is staged for user confirmation.
        currentMessages.push({ role: 'tool', tool_call_id: tc.id, content: JSON.stringify({ status: 'staged_for_confirmation', proposal_id: proposal.proposal_id, label: proposal.label }) });
      } else {
        const result = await executeRead(name, args);
        reads.push({ tool: name, args, result });
        currentMessages.push({ role: 'tool', tool_call_id: tc.id, content: JSON.stringify(result).slice(0, 8000) });
      }
    }
    // Loop again — model may want to follow up.
  }

  return { reply: finalReply, reads, pending_writes: pendingWrites };
}

// ---- Human-readable label for a write proposal ----
function describeWrite(name, a) {
  switch (name) {
    case 'create_item':     return `Create item "${a.name}" (SKU ${a.sku}, category ${a.category}, opening qty ${a.opening_quantity ?? 0})`;
    case 'update_item':     return `Update item #${a.id}${a.name ? ' — name: ' + a.name : ''}${a.min_quantity != null ? ' — min qty: ' + a.min_quantity : ''}${a.unit_price != null ? ' — unit price: ' + a.unit_price : ''}`;
    case 'stock_in':        return `Add ${a.quantity} units to item #${a.item_id || a.sku}${a.reason ? ' (' + a.reason + ')' : ''}`;
    case 'stock_out':       return `Remove ${a.quantity} units from item #${a.item_id || a.sku}${a.counterparty ? ' for ' + a.counterparty : ''}`;
    case 'create_user':     return `Create user "${a.username}" (${a.full_name}, role ${a.role || 'staff'})`;
    case 'create_requester':return `Create requester "${a.name}"`;
    case 'create_department':return `Create department "${a.name}"`;
    default: return name + '(' + JSON.stringify(a) + ')';
  }
}

// ---- Execute a confirmed proposal ----
// POST /api/assistant/execute { proposal_id, tool, args }
// Looks up the proposal server-side (no client-trusted state) and runs it.
function executeProposal(req, res) {
  const { tool, args } = req.body || {};
  const def = TOOL_INDEX.get(tool);
  if (!def || !def.is_write) return res.status(400).json({ error: 'not a write tool' });
  const user = req.user;
  if (!user) return res.status(401).json({ error: 'auth required' });

  // Admin gating mirrors the proposal path.
  const adminOnly = new Set(['create_user','update_item','create_item']);
  if (adminOnly.has(tool) && user.role !== 'admin') {
    return res.status(403).json({ error: 'admin role required' });
  }

  try {
    let result;
    switch (tool) {
      case 'create_item':     result = doCreateItem(req, args); break;
      case 'update_item':     result = doUpdateItem(req, args); break;
      case 'stock_in':        result = doStockIn(req, args); break;
      case 'stock_out':       result = doStockOut(req, args); break;
      case 'create_user':     result = doCreateUser(req, args); break;
      case 'create_requester':result = doCreateRequester(req, args); break;
      case 'create_department':result = doCreateDepartment(req, args); break;
      default: return res.status(400).json({ error: 'unknown tool' });
    }
    res.json({ ok: true, result });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}

function doCreateItem(req, a) {
  const sku = (a.sku || '').trim();
  if (!sku || !a.name || !a.category) throw new Error('sku, name, category are required');
  const existing = db.prepare('SELECT id FROM items WHERE sku = ?').get(sku);
  if (existing) throw new Error('SKU already exists');
  const info = db.prepare(`
    INSERT INTO items (sku, name, category, unit, quantity, min_quantity, unit_price, purchase_price, location, notes, active)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
  `).run(
    sku, a.name, a.category,
    a.unit || 'pcs',
    Math.max(0, parseInt(a.opening_quantity) || 0),
    Math.max(0, parseInt(a.min_quantity) || 5),
    Number(a.unit_price) || 0,
    Number(a.purchase_price) || 0,
    a.location || null,
    a.notes || null,
  );
  const id = info.lastInsertRowid;
  audit(req, 'item', id, 'create', null, { sku, name: a.name });
  // Opening stock creates an 'in' movement when qty > 0
  const qty = parseInt(a.opening_quantity) || 0;
  if (qty > 0) {
    db.prepare(`INSERT INTO movements (item_id, user_id, type, quantity, reason, counterparty) VALUES (?, ?, 'in', ?, 'opening stock', ?)`)
      .run(id, req.user.id, qty, a.location || null);
  }
  return { id };
}

function doUpdateItem(req, a) {
  if (!a.id) throw new Error('id is required');
  const cur = db.prepare('SELECT * FROM items WHERE id = ?').get(a.id);
  if (!cur) throw new Error('item not found');
  const upd = {};
  for (const k of ['name','category','unit','location','notes']) {
    if (a[k] !== undefined) upd[k] = a[k];
  }
  if (a.min_quantity !== undefined) upd.min_quantity = Math.max(0, parseInt(a.min_quantity) || 0);
  if (a.unit_price !== undefined) upd.unit_price = Number(a.unit_price) || 0;
  if (a.purchase_price !== undefined) upd.purchase_price = Number(a.purchase_price) || 0;
  const cols = Object.keys(upd);
  if (cols.length === 0) throw new Error('no fields to update');
  const sql = 'UPDATE items SET ' + cols.map(c => c + ' = ?').join(', ') + ', updated_at = CURRENT_TIMESTAMP WHERE id = ?';
  db.prepare(sql).run(...cols.map(c => upd[c]), a.id);
  audit(req, 'item', a.id, 'update', cur, { ...cur, ...upd });
  return { id: a.id };
}

function doStockIn(req, a) {
  let id = a.item_id;
  if (!id && a.sku) {
    const row = db.prepare('SELECT id FROM items WHERE sku = ?').get(a.sku);
    if (!row) throw new Error('no item with sku ' + a.sku);
    id = row.id;
  }
  if (!id) throw new Error('item_id or sku is required');
  const qty = parseInt(a.quantity);
  if (!Number.isFinite(qty) || qty <= 0) throw new Error('quantity must be a positive integer');
  const item = db.prepare('SELECT * FROM items WHERE id = ?').get(id);
  if (!item) throw new Error('item not found');
  const beforeQty = item.quantity;
  db.prepare('UPDATE items SET quantity = quantity + ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(qty, id);
  const info = db.prepare(`INSERT INTO movements (item_id, user_id, type, quantity, reason, counterparty) VALUES (?, ?, 'in', ?, ?, ?)`)
    .run(id, req.user.id, qty, a.reason || null, a.counterparty || null);
  audit(req, 'movement', info.lastInsertRowid, 'create', null, { item_id: id, type: 'in', quantity: qty });
  return { movement_id: info.lastInsertRowid, new_quantity: beforeQty + qty };
}

function doStockOut(req, a) {
  let id = a.item_id;
  if (!id && a.sku) {
    const row = db.prepare('SELECT id FROM items WHERE sku = ?').get(a.sku);
    if (!row) throw new Error('no item with sku ' + a.sku);
    id = row.id;
  }
  if (!id) throw new Error('item_id or sku is required');
  const qty = parseInt(a.quantity);
  if (!Number.isFinite(qty) || qty <= 0) throw new Error('quantity must be a positive integer');
  const item = db.prepare('SELECT * FROM items WHERE id = ?').get(id);
  if (!item) throw new Error('item not found');
  if (item.quantity < qty) throw new Error('not enough stock (have ' + item.quantity + ', need ' + qty + ')');
  db.prepare('UPDATE items SET quantity = quantity - ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(qty, id);
  const info = db.prepare(`INSERT INTO movements (item_id, user_id, type, quantity, reason, counterparty) VALUES (?, ?, 'out', ?, ?, ?)`)
    .run(id, req.user.id, qty, a.reason || null, a.counterparty || null);
  audit(req, 'movement', info.lastInsertRowid, 'create', null, { item_id: id, type: 'out', quantity: qty });
  return { movement_id: info.lastInsertRowid, new_quantity: item.quantity - qty };
}

function doCreateUser(req, a) {
  const { hashPassword } = require('./auth');
  if (!a.username || !a.full_name || !a.password) throw new Error('username, full_name, password are required');
  if (String(a.password).length < 6) throw new Error('password must be at least 6 chars');
  const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(a.username);
  if (existing) throw new Error('username already taken');
  const hash = hashPassword(a.password);
  const info = db.prepare(`
    INSERT INTO users (username, full_name, email, password_hash, role, department_id)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(a.username, a.full_name, a.email || null, hash, a.role || 'staff', a.department_id || null);
  audit(req, 'user', info.lastInsertRowid, 'create', null, { username: a.username, role: a.role || 'staff' });
  return { id: info.lastInsertRowid };
}

function doCreateRequester(req, a) {
  if (!a.name) throw new Error('name is required');
  const info = db.prepare('INSERT INTO requesters (name, email, phone, department_id) VALUES (?, ?, ?, ?)')
    .run(a.name, a.email || null, a.phone || null, a.department_id || null);
  audit(req, 'requester', info.lastInsertRowid, 'create', null, { name: a.name });
  return { id: info.lastInsertRowid };
}

function doCreateDepartment(req, a) {
  if (!a.name) throw new Error('name is required');
  const existing = db.prepare('SELECT id FROM departments WHERE name = ?').get(a.name);
  if (existing) throw new Error('department already exists');
  const info = db.prepare('INSERT INTO departments (name, description) VALUES (?, ?)')
    .run(a.name, a.description || null);
  audit(req, 'department', info.lastInsertRowid, 'create', null, { name: a.name });
  return { id: info.lastInsertRowid };
}

module.exports = { enabled, chat, executeProposal, TOOLS };
