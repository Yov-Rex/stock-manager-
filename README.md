# Stockroom — Office Furnishings Manager

A self-contained web app for tracking every item in the office: stock
levels, who took what, when, and why.

## Features

- **Dashboard** — at-a-glance KPIs (item count, inventory value, low/out-of-stock counts, 7-day in/out trend, most-consumed items).
- **Items** — add, edit, delete office supplies; search, filter by category, "low stock only" toggle; per-item stock-level bar.
- **Stock in / out** — record every movement with quantity, person, supplier/destination, and reason. Each movement is timestamped and linked to the user who made it.
- **Inventory audit** — count each item against the system; saving records the difference as a stock movement (`reason: Inventory audit`) so the audit trail is preserved.
- **Movements history** — full audit trail across all items, filterable by item/user/type.
- **People** (admin only) — create staff accounts, assign admin role.
- **Auth** — JWT in httpOnly cookie + Bearer header support; role-based admin gating on the server.
- **Persistent** — SQLite file at `data/stock.db` (created on first run, auto-seeded with a default admin and 10 sample items).

## Run

```bash
cd "C:/Users/yovre/stock-manager"
npm install
npm start
```

Open http://localhost:3000

**Default login:** `admin` / `admin123`

Change the default password from the People page after first sign-in (or by deleting and re-creating the admin user).

## API

All routes are JSON, mounted under `/api`. Authenticate with `Authorization: Bearer <jwt>` (the SPA handles this automatically).

| Method | Path | Description | Role |
|--------|------|-------------|------|
| POST | `/auth/login` | Sign in, returns `{ token, user }` and sets cookie | any |
| POST | `/auth/logout` | Clears cookie | any |
| GET  | `/auth/me` | Current user | auth |
| GET  | `/items` | List items (`?q=`, `?category=`, `?low=1`) | auth |
| GET  | `/items/:id` | Item + last 100 movements | auth |
| POST | `/items` | Create item | admin |
| PATCH| `/items/:id` | Update editable fields | admin |
| DELETE| `/items/:id` | Delete item + its movements | admin |
| POST | `/items/:id/in`  | Stock in  `{ quantity, reason, counterparty }` | auth |
| POST | `/items/:id/out` | Stock out `{ quantity, reason, counterparty }` | auth |
| GET  | `/movements` | List movements (`?item_id=`, `?user_id=`, `?type=in|out`, `?limit=`) | auth |
| GET  | `/stats/summary` | Dashboard numbers | auth |
| GET  | `/users` | List users | admin |
| POST | `/users` | Create user `{ username, full_name, password, role }` | admin |
| DELETE| `/users/:id` | Remove user | admin |

## Project layout

```
stock-manager/
├── server/
│   ├── index.js      # Express entry, serves /api + /public
│   ├── routes.js     # All HTTP routes
│   ├── auth.js       # JWT + bcrypt
│   └── db.js         # better-sqlite3 schema + seed
├── public/
│   ├── index.html    # SPA shell, inline SVG icon sprite
│   ├── styles.css    # Design system
│   └── app.js        # Vanilla JS SPA
├── data/             # SQLite DB lives here (created on first run)
└── test/e2e.js       # JSDOM end-to-end test
```

## Tests

```bash
node test/e2e.js
```

Boots the SPA inside JSDOM, drives it through the real `/api` HTTP endpoints, and asserts: login, dashboard KPIs, items list, full create → stock-in → stock-out → verify flow, low-stock overdraw 409, modal open/close, movements/people pages.

## Security notes

- JWT secret defaults to a placeholder; set `JWT_SECRET` env var in production.
- Cookie is `httpOnly` and `SameSite=Lax`; enable `secure: true` behind HTTPS in `server/auth.js`.
- Passwords hashed with bcrypt (10 rounds).
- All write endpoints validate role server-side — non-admins get 403 even if they bypass the UI.
- Stack trace is not leaked on errors.

## Design choices

- **No emoji icons.** Every glyph is a hand-built inline SVG. The full sprite lives at the top of `public/index.html` and is referenced via `<use href="#icon-…"/>`.
- **No build step.** Pure HTML/CSS/JS — open in any browser, edit and refresh.
- **No frontend framework.** Vanilla JS with a small `h()` helper keeps the bundle ~28 KB and the entire UI readable in one file.
- **SQLite** — zero-config, file-based, single source of truth. `better-sqlite3` is synchronous and fast for this size.
- **Generation counter** on the SPA router prevents a slow render from clobbering the next page when users navigate quickly.
