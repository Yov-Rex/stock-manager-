// Database setup — better-sqlite3, synchronous, file-based, zero-config.
// Single file at data/stock.db. Schema is created on first run and seeded
// with a default admin user so the app is usable immediately.
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');

const DATA_DIR = path.join(__dirname, '..', 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new Database(path.join(DATA_DIR, 'stock.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE,
    full_name TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'staff',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sku TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    category TEXT NOT NULL,
    unit TEXT NOT NULL DEFAULT 'pcs',
    quantity INTEGER NOT NULL DEFAULT 0,
    min_quantity INTEGER NOT NULL DEFAULT 5,
    unit_price REAL NOT NULL DEFAULT 0,
    location TEXT,
    notes TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS movements (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    item_id INTEGER NOT NULL,
    user_id INTEGER,
    type TEXT NOT NULL CHECK(type IN ('in','out')),
    quantity INTEGER NOT NULL,
    reason TEXT,
    counterparty TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY(item_id) REFERENCES items(id) ON DELETE CASCADE,
    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE SET NULL
  );

  CREATE INDEX IF NOT EXISTS idx_movements_item ON movements(item_id);
  CREATE INDEX IF NOT EXISTS idx_movements_user ON movements(user_id);
  CREATE INDEX IF NOT EXISTS idx_movements_created ON movements(created_at);
`);

// ---- v2 add-ons (additive only: never destructive) ----
// Add new columns to items/movements if they don't already exist.
function ensureColumn(table, col, decl) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all().map(r => r.name);
  if (!cols.includes(col)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${decl}`);
  }
}
ensureColumn('items',     'active',          'INTEGER NOT NULL DEFAULT 1');
ensureColumn('items',     'purchase_price',  'REAL NOT NULL DEFAULT 0');
ensureColumn('movements', 'supplier',        'TEXT');
ensureColumn('movements', 'delivery_note',   'TEXT');
ensureColumn('movements', 'entry_type',      'TEXT');
ensureColumn('movements', 'requester_id',    'INTEGER');
ensureColumn('movements', 'department_id',   'INTEGER');
ensureColumn('movements', 'comment',         'TEXT');
// User enhancements (additive): email, department, role widened to allow 'manager'.
ensureColumn('users',      'email',           'TEXT');
ensureColumn('users',      'department_id',   'INTEGER');

db.exec(`
  CREATE TABLE IF NOT EXISTS requesters (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    email TEXT,
    phone TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS departments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    description TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS audit_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    actor_user_id INTEGER,
    entity TEXT NOT NULL,           -- 'item', 'user', 'movement', 'requester', 'department'
    entity_id INTEGER,
    action TEXT NOT NULL,           -- 'create', 'update', 'delete'
    before_json TEXT,
    after_json  TEXT,
    ip TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_movements_requester  ON movements(requester_id);
  CREATE INDEX IF NOT EXISTS idx_movements_department ON movements(department_id);
  CREATE INDEX IF NOT EXISTS idx_audit_log_entity     ON audit_log(entity, entity_id);
  CREATE INDEX IF NOT EXISTS idx_audit_log_created    ON audit_log(created_at);
  CREATE INDEX IF NOT EXISTS idx_audit_log_actor      ON audit_log(actor_user_id);
`);

// Seed requesters and departments only if empty (preserves user data on re-run).
const reqCount = db.prepare('SELECT COUNT(*) as c FROM requesters').get().c;
if (reqCount === 0) {
  const ins = db.prepare('INSERT INTO requesters (name, email, phone) VALUES (?, ?, ?)');
  ins.run('M. Dupont',   'dupont@bureau.com',   '06 12 34 56 78');
  ins.run('Mme Legrand', 'legrand@bureau.com',  '06 23 45 67 89');
  ins.run('M. Martin',   'martin@bureau.com',   '06 34 56 78 90');
  console.log('[db] seeded 3 requesters');
}
const depCount = db.prepare('SELECT COUNT(*) as c FROM departments').get().c;
if (depCount === 0) {
  const ins = db.prepare('INSERT INTO departments (name, description) VALUES (?, ?)');
  ins.run('Comptabilité',    'Service comptable et financier');
  ins.run('Ressources Humaines', 'Gestion du personnel');
  ins.run('Informatique',    'Support technique et réseaux');
  ins.run('Direction',       'Direction générale');
  ins.run('Logistique',      'Gestion des approvisionnements');
  console.log('[db] seeded 5 departments');
}

// Seed default admin if no users present
const userCount = db.prepare('SELECT COUNT(*) as c FROM users').get().c;
if (userCount === 0) {
  const hash = bcrypt.hashSync('admin123', 10);
  db.prepare(
    'INSERT INTO users (username, full_name, password_hash, role) VALUES (?, ?, ?, ?)'
  ).run('admin', 'Administrator', hash, 'admin');
  console.log('[db] seeded default user -> admin / admin123');
}

// Seed a few sample items so the dashboard isn't empty on first run
const itemCount = db.prepare('SELECT COUNT(*) as c FROM items').get().c;
if (itemCount === 0) {
  const insertItem = db.prepare(`
    INSERT INTO items (sku, name, category, unit, quantity, min_quantity, unit_price, location)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const samples = [
    ['PEN-001', 'Ballpoint Pen (Blue)', 'Stationery', 'pcs', 120, 30, 0.5,  'Cabinet A1'],
    ['PEN-002', 'Ballpoint Pen (Black)', 'Stationery', 'pcs', 95, 30, 0.5,  'Cabinet A1'],
    ['PPR-A4',  'A4 Copy Paper 80gsm', 'Paper',       'ream', 18, 10, 4.2, 'Storage Room'],
    ['PPR-A3',  'A3 Copy Paper 80gsm', 'Paper',       'ream', 6,  4,  6.8, 'Storage Room'],
    ['STK-NOTE','Sticky Notes 3x3',    'Stationery', 'pad',  40, 15, 1.1, 'Cabinet A2'],
    ['FOL-LTR', 'Letter File Folder', 'Filing',     'pcs',  60, 20, 0.9, 'Shelf B1'],
    ['CLP-PAP', 'Paper Clips (Box)',  'Stationery', 'box',  25, 10, 1.5, 'Cabinet A2'],
    ['TON-HP',  'HP Toner 26A Black', 'Printing',   'pcs',  3,  3,  62,  'IT Closet'],
    ['COF-100', 'Coffee Capsules',     'Pantry',     'box',  12, 6,  28,  'Kitchen'],
    ['SNT-FRS', 'Hand Sanitizer 500ml','Cleaning',   'btl',  9,  6,  3.4, 'Janitor Room'],
  ];
  const seedAll = db.transaction((rows) => {
    for (const r of rows) insertItem.run(...r);
  });
  seedAll(samples);
  console.log('[db] seeded 10 sample items');
}

module.exports = db;