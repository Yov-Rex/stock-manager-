# Add-on Plan — what gets added without changing existing functionality

## Backwards-compat rules
1. All existing routes (`/api/auth/*`, `/api/items`, `/api/items/:id/stock-in|out`, `/api/movements`, `/api/stats/summary`, `/api/users`) keep their current behavior. New params are OPTIONAL.
2. New tables added with `IF NOT EXISTS`; new columns added with `ALTER TABLE ... ADD COLUMN` (no destructive rebuild).
3. Existing items keep all current fields. The 10 seed items still appear; their data is unchanged.
4. Existing dark theme is kept as the base. The header/tab look gets a small visual upgrade (gradient header bar matching the reference image) but the palette stays the same.
5. Existing e2e tests still pass; we add new e2e checks for the new features.

## New tables (db.js)
- `requesters`  (id, name, email, phone, created_at)         -- seed 3
- `departments` (id, name, description, created_at)         -- seed 5
- `movements` ALTER ADD:
    supplier TEXT
    delivery_note TEXT
    entry_type TEXT      -- 'stock_initial' | 'purchase_order' | 'contract' | NULL
    requester_id INTEGER  -- FK requesters
    department_id INTEGER -- FK departments
    comment TEXT         -- (alias for existing note column; nullable)
- `items` ALTER ADD:
    active INTEGER NOT NULL DEFAULT 1
    purchase_price REAL DEFAULT 0

## New API routes (routes.js)
- GET  /api/requesters         (any auth)
- POST /api/requesters         (admin)
- PUT  /api/requesters/:id     (admin)
- DELETE /api/requesters/:id   (admin)
- GET  /api/departments        (any auth)
- POST /api/departments        (admin)
- PUT  /api/departments/:id    (admin)
- DELETE /api/departments/:id  (admin)
- GET  /api/alerts             (low-stock items, with last movement date)
- GET  /api/export/items       (CSV, auth)
- GET  /api/export/movements   (CSV, auth)
- POST /api/import/items       (CSV upload, admin, multipart or raw text)
- POST /api/scan              (lookup item by SKU/codebar, returns the item)

## New auth
- Session timeout: 30 minutes idle → auto-logout on the client + JWT `exp` claim set to 30m (was 8h). Existing tokens still work but refresh window shortens. The `me` endpoint returns 401 → client shows login.

## i18n
- New file `public/i18n.js` with 3 language packs: fr (default from reference), en, ar (RTL).
- Header has a language switcher; choice persisted in localStorage. Switching between FR/EN/AR does not refetch data, just re-renders strings.
- AR flips the layout to RTL via `<html dir="rtl">` + a small CSS tweak.

## New UI pages
1. **Alerts** (`#alerts`) — list of items with quantity <= min_quantity, with "Reorder" button that opens stock-in modal pre-filled for that item.
2. **Requesters** (`#requesters`) — admin CRUD list.
3. **Departments** (`#departments`) — admin CRUD list.
4. **Import / Export** buttons on the Items page and Movements page (toolbar).
5. **Language switcher** in the header.
6. **Session timer** in the header showing time until auto-logout.

## Modal additions
- Stock-in modal: add fields for supplier, delivery note, entry type, comment. (Existing quantity field kept.)
- Stock-out modal: add requester (dropdown) + department (dropdown) + comment. (Existing quantity + reason kept.)
- Item modal: add `active` toggle + purchase price. (Existing fields kept.)

## Scan
- Items page has a "Scan" button that opens a small modal with a text input. In a real browser with a barcode-scanner keyboard wedge, the SKU is typed and Enter submits. Here we accept the typed code and POST to `/api/scan` which returns the item.
- Stock-in and stock-out modals also have a Scan button that fills the SKU/codebar field.

## Files added / modified
NEW:
- public/i18n.js
- public/alerts.js        (renderer)
- public/requesters.js    (renderer + admin form)
- public/departments.js   (renderer + admin form)
- public/import-export.js (CSV helpers, scan modal)
- test/e2e-addons.js      (extra e2e for the new features)

MODIFIED (only addition, no destructive change):
- server/db.js            (adds new tables + ALTERs)
- server/routes.js        (adds new endpoints, extends stock-in/out with optional fields)
- server/auth.js          (shortens JWT exp; adds `requireAnyAuth` (same as requireAuth but clearer name))
- public/index.html       (adds #alerts, #requesters, #departments, #modal-stockin/supplier-area, #modal-stockout/requester-dept-area, #modal-scan, #modal-import, language switcher, session timer, alerts/requesters/departments nav items)
- public/app.js           (mounts the new renderers, language switcher, scan, import/export, session timer, idle-timeout; everything existing kept)
- public/styles.css       (RTL flip, language switcher, scan modal, alerts/requesters/departments styles, session timer chip)
- test/e2e.js             (no changes; addons e2e is a separate file)
- README.md               (add a "v2 features" section)
