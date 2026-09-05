// Server entry point. Serves API routes under /api and the static SPA from /public.
const path = require('path');
const express = require('express');
const cookieParser = require('cookie-parser');
const routes = require('./routes');

const app = express();

// Trust the first proxy hop — Cloudflare Tunnel terminates TLS and
// forwards the original client IP in X-Forwarded-For. Without this,
// every request looks like it's coming from the tunnel's IP and our
// rate limiter (and req.ip) become useless.
app.set('trust proxy', 1);

// Security headers. Lightweight inline middleware instead of pulling
// in `helmet` — fewer dependencies, fewer supply-chain surprises.
// CSP is restrictive: the SPA only needs its own origin (for /api and
// /public assets). Inline styles are allowed because the existing UI
// uses them heavily; we don't allow inline scripts except for the
// /xlsx.full.min.js loader (which is a same-origin <script src>).
app.use((req, res, next) => {
  // Don't cache API responses that depend on the user/session.
  if (req.path.startsWith('/api/')) {
    res.setHeader('Cache-Control', 'no-store');
  }
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'same-origin');
  // HSTS only when reached over HTTPS, so local HTTP dev still works.
  if (req.secure || (req.headers['x-forwarded-proto'] || '').includes('https')) {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }
  res.setHeader('Content-Security-Policy',
    "default-src 'self'; " +
    "img-src 'self' data:; " +
    "style-src 'self' 'unsafe-inline'; " +
    "script-src 'self'; " +
    "connect-src 'self'; " +
    "frame-ancestors 'none'; " +
    "base-uri 'self';"
  );
  next();
});

app.use(express.json({ limit: '256kb' }));
// Raw text body for CSV import endpoint
app.use(express.text({ type: ['text/csv','text/plain'], limit: '2mb' }));
// Raw binary body for the restore endpoint (SQLite file upload)
app.use(express.raw({ type: ['application/octet-stream','application/x-sqlite3'], limit: '50mb' }));
app.use(cookieParser());

// Basic hardening — note: this is an internal office tool, not internet-facing.
app.disable('x-powered-by');

// Request log (compact)
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    console.log(`${req.method} ${req.originalUrl} -> ${res.statusCode} (${Date.now()-start}ms)`);
  });
  next();
});

app.use('/api', routes);
app.use(express.static(path.join(__dirname, '..', 'public')));

// SPA fallback — every non-API GET serves index.html
app.get(/^\/(?!api).*/, (_req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

app.use((err, _req, res, _next) => {
  console.error('[err]', err);
  res.status(500).json({ error: 'internal server error' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`[ok] stock-manager listening on http://localhost:${PORT}`);
  console.log(`[ok] default login -> admin / admin123`);
});