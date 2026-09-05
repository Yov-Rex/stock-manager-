# Stockroom on Cloudflare — operator guide

This document explains how to expose the local Stockroom server at
`http://localhost:3000` to the internet through a Cloudflare Tunnel,
with Cloudflare Access sitting in front so only authorized users
(your office team) can reach the login screen.

The Tunnel connector (`cloudflared`) runs on this machine, makes an
**outbound** connection to Cloudflare's edge — there is no port
forwarding on the router, no public IP exposed, and the database
never leaves the host.

```
  Browser ──HTTPS──▶ Cloudflare edge ──Access auth──▶ cloudflared (localhost) ──▶ node server/index.js (port 3000)
                                                                  │
                                                                  └── SQLite at data/stock.db
```

## 0. Server hardening (already done in this commit)

- `JWT_SECRET` is now mandatory outside dev mode. Set it in the env
  before starting the server; the server prints a one-time generated
  secret in its FATAL message if missing.
- Cookie `secure: true` is set automatically whenever the request
  came in over HTTPS (directly or via the tunnel).
- Rate limiting on `/api/auth/login` (10 / minute / IP),
  `/api/backup.sqlite` (5 / minute / IP) and
  `/api/restore.sqlite` (5 / 5 minutes / IP). Returns `429` with a
  `Retry-After` header.
- Security headers on every response: `Content-Security-Policy`
  (strict — only `'self'`, inline styles allowed, inline scripts
  forbidden), `Strict-Transport-Security` (1 year, only when behind
  HTTPS), `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`,
  `Referrer-Policy: same-origin`. API responses get
  `Cache-Control: no-store`.
- Express `trust proxy` set to 1 hop, so `req.ip` reflects the real
  client IP from Cloudflare's `X-Forwarded-For` (needed for rate
  limiting and audit logging).
- Every login attempt — success or failure — is recorded in the
  `audit_log` table with the username, IP, and outcome. Brute-force
  attempts are visible on the Admin page.

## 1. Generate a strong JWT_SECRET and start the server

Open PowerShell or git-bash on the host machine and run:

```bash
# 64 random hex chars (32 bytes); you only need this once.
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Copy the output (e.g. `a1b2c3...`) and start the server with it:

```bash
cd C:/Users/yovre/stock-manager
JWT_SECRET="<paste your secret here>" node server/index.js
```

You should see:

```
[ok] stock-manager listening on http://localhost:3000
[ok] default login -> admin / admin123
```

**Important:** save that JWT_SECRET in a secure place (a password
manager, a `.env` file outside the repo, etc.). Every time the server
restarts with the same secret, existing sessions stay valid; with a
different secret, everyone gets logged out.

## 2. Change the default admin password

Before exposing the app to anyone else, change the seeded `admin` /
`admin123` login. The fastest way:

1. Sign in as `admin / admin123` at `http://localhost:3000`.
2. Go to **People** → click the new **edit** icon on the admin row.
3. Set a new password (and ideally a real email address).

If you can't sign in, run this SQL via `sqlite3 data/stock.db`:

```sql
-- Replace 'NEW_PASSWORD_HERE' with your new password.
UPDATE users SET password_hash = '$2a$10$...'  -- generate with:
WHERE username = 'admin';
-- In Node:
--   require('bcryptjs').hashSync('NEW_PASSWORD_HERE', 10)
```

## 3. Set up a Cloudflare account and add your domain

If you don't already have one:

1. Sign up at https://dash.cloudflare.com/.
2. Add the domain you want to use (e.g. `stock.example.com`). Cloudflare
   will scan and import your existing DNS records; you then point
   your domain's nameservers to the Cloudflare nameservers they give
   you.

If you don't have a domain and just want to test:

- Use Cloudflare's free `trycloudflare.com` quick-tunnel mode (see
  step 5 below) — no DNS changes required, but the URL changes every
  time you restart the tunnel. Good for development, not for daily
  use.

## 4. Create a Tunnel

In the Cloudflare Zero Trust dashboard:

1. Go to **Networks → Tunnels** → **Create a tunnel** → pick
   **Cloudflared**.
2. Name it `stockroom` (or whatever you prefer).
3. **Copy the tunnel token** — it's a long base64 string. You'll paste
   it into `cloudflared` in step 5.
4. In the **Public hostname** tab, add a route:
   - Subdomain: `stock` (or `@` for the apex)
   - Domain: your domain
   - Service: `http://localhost:3000`

(If you want to use the same tunnel for multiple apps later, add
more routes here.)

## 5. Install and run cloudflared

Download `cloudflared` for Windows from
https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/
(or `winget install Cloudflare.cloudflared`).

Then install it as a Windows service so it auto-starts with the host:

```powershell
# Run as Administrator
cloudflared service install <paste tunnel token here>
```

That registers `cloudflared` as a Windows service. Start it:

```powershell
Start-Service cloudflared
# Or, if you prefer, just run the foreground command for testing:
cloudflared tunnel --no-autoupdate run stockroom
```

Within a few seconds, the URL you set in step 4 should route to
`http://localhost:3000`. Visit it from any device NOT on your LAN to
confirm (e.g. from your phone's cellular connection).

## 6. Lock it down with Cloudflare Access

The tunnel by itself is reachable to anyone who knows the URL. Add an
extra login screen in front:

1. In the Cloudflare Zero Trust dashboard, go to **Access →
   Applications** → **Add an application** → **Self-hosted**.
2. Name it `Stockroom`, set the application domain to the hostname
   you chose in step 4 (e.g. `stock.example.com`).
3. On the **Policies** tab, add a policy named `Office team`. Under
   **Configure rules**, pick whatever identity providers you've
   enabled (the simplest is **One-time PIN** — Cloudflare sends a code
   to your email address; you don't need a separate auth provider).
4. Save and apply.

Now when anyone hits `https://stock.example.com/`, they first see a
Cloudflare "Verify your email" screen; once they pass it, they're
let through to your Stockroom login page.

If you'd rather only allow specific email addresses (e.g.
`you@example.com`, your colleagues), pick **Email** under "Allowed
email addresses" and list them. Use **Email** with a wildcard
domain (`*@example.com`) for the whole office.

## 7. Verify everything works

After the tunnel + Access are up:

1. Hit `https://stock.example.com/` from your phone (cellular, not
   WiFi — to make sure it's really going through Cloudflare).
2. You should see Cloudflare Access → enter your email → get the PIN →
   enter it.
3. Then you should see the Stockroom login screen.
4. Sign in with the new admin password you set in step 2.
5. Go to Admin → Audit log: you should see an entry showing your
   login with the real client IP (not `127.0.0.1`).
6. Trigger a backup: Admin → Download backup. Confirm the file has
   the `SQLite format 3` header.

If any of those steps fail, the most common culprits are:

- **Access not applying** — you didn't add the route for the
  subdomain in step 4. Visit `https://<your-domain>/cdn-cgi/access/ping`
  to test the tunnel.
- **`secure` cookie missing** — the cookie is only set when the
  request comes in over HTTPS. If you visit `http://`, logins will
  appear to succeed but subsequent requests won't carry the cookie.
- **Rate limiter blocking your real IP** — if you reload too fast
  during testing, the limiter might 429 you. Wait a minute and try
  again, or temporarily raise the limit in
  `server/routes.js`.

## 8. Operational notes

- **Logs**: the server logs every request to stdout. With
  `cloudflared service install`, the cloudflared logs go to the
  Windows Event Log (Applications and Services Log → Cloudflare).
- **Restart loop**: if you restart `node server/index.js`, existing
  Cloudflare Access sessions stay valid (they're cookies on the
  user's browser pointing to Cloudflare's edge). The Stockroom JWT
  cookie will be invalidated UNLESS you restart with the same
  `JWT_SECRET`.
- **Backups**: use the in-app backup button (Admin → Download
  backup). It calls `db.backup()` which is a safe online snapshot —
  readers don't block, the file is a consistent point-in-time copy.
- **Restore**: Admin → Restore from file. The new file replaces
  `data/stock.db` and the server exits. **Restart the server**
  afterwards to load the new database.
- **Updating the app**: stop the server, `git pull` (or however you
  update), `npm install` if `package.json` changed, then restart the
  server. The Tunnel keeps running throughout.
