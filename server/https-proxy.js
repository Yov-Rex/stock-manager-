// Local HTTPS preview proxy.
//
// This is the "easiest and safest" way to see the Stockroom app over
// HTTPS without involving the public internet: a tiny reverse proxy
// in front of the regular Node server.
//
//   browser ──HTTPS──▶ https-proxy.js (port 3443) ──HTTP──▶ server/index.js (port 3000)
//
// Listens on https://localhost:3443 only — never on 0.0.0.0, never
// reachable from another machine. Uses a self-signed cert that's
// generated once via `openssl` (see LOCAL_HTTPS.md). The browser
// will warn about the untrusted CA on first visit; one click to
// accept is all you need.
//
// The proxy sets `X-Forwarded-Proto: https` so the app's existing
// security code (cookie `secure`, HSTS, CSP) activates correctly.

const https  = require('https');
const http   = require('http');
const fs     = require('fs');
const path   = require('path');

const HTTPS_PORT = parseInt(process.env.SM_HTTPS_PORT || '3443', 10);
const HTTP_TARGET = process.env.SM_HTTP_TARGET || 'http://127.0.0.1:3000';
const CRT = path.join(__dirname, '..', 'data', 'localhost.crt');
const KEY = path.join(__dirname, '..', 'data', 'localhost.key');

if (!fs.existsSync(CRT) || !fs.existsSync(KEY)) {
  console.error('=================================================================');
  console.error('[proxy] FATAL: self-signed cert not found.');
  console.error('        Expected:');
  console.error('          ' + CRT);
  console.error('          ' + KEY);
  console.error('');
  console.error('        Generate them once with:');
  console.error('');
  console.error('          openssl req -x509 -newkey rsa:2048 -nodes -sha256 \\');
  console.error('            -days 3650 -keyout data/localhost.key \\');
  console.error('            -out data/localhost.crt \\');
  console.error('            -subj "/CN=localhost" \\');
  console.error('            -addext "subjectAltName=DNS:localhost,IP:127.0.0.1"');
  console.error('=================================================================');
  process.exit(1);
}

// Don't bind to 0.0.0.0 — this proxy is intentionally local-only.
// "localhost" / "127.0.0.1" / "::1" only; anything else will refuse.
const server = https.createServer({
  cert: fs.readFileSync(CRT),
  key: fs.readFileSync(KEY),
  // Modern defaults — TLS 1.2+ only, no legacy ciphers.
  minVersion: 'TLSv1.2',
}, (req, res) => {
  // Strip the Host header so the upstream sees `localhost:3000`,
  // not `localhost:3443` (avoids any port-mismatch redirects).
  const headers = Object.assign({}, req.headers, {
    host: 'localhost:3000',
    // The app's trust-proxy + secure-cookie logic depends on this.
    'x-forwarded-proto': 'https',
    'x-forwarded-host':  'localhost:3443',
  });

  const proxyReq = http.request({
    method: req.method,
    hostname: '127.0.0.1',
    port: 3000,
    path: req.url,
    headers,
  }, (proxyRes) => {
    res.writeHead(proxyRes.statusCode, proxyRes.headers);
    proxyRes.pipe(res);
  });
  proxyReq.on('error', (err) => {
    if (!res.headersSent) {
      res.writeHead(502, { 'content-type': 'text/plain' });
    }
    res.end('Bad gateway: ' + err.message + '\n');
  });
  req.pipe(proxyReq);
});

// Bind explicitly to 127.0.0.1 (IPv4 localhost) — refuses external
// connections even if a firewall rule is missing.
server.listen(HTTPS_PORT, '127.0.0.1', () => {
  console.log('=================================================================');
  console.log('[proxy] HTTPS preview listening on https://localhost:' + HTTPS_PORT);
  console.log('        Forwarding plaintext to ' + HTTP_TARGET);
  console.log('');
  console.log('        Open:  https://localhost:' + HTTPS_PORT + '/');
  console.log('        Note: browser will show a cert warning (self-signed).');
  console.log('        Click "Advanced" → "Proceed to localhost" to continue.');
  console.log('');
  console.log('        Stop with Ctrl-C.');
  console.log('=================================================================');
});

// Refuse to listen on any other interface, even if asked.
server.on('connection', (socket) => {
  const remote = socket.remoteAddress || '';
  if (remote !== '127.0.0.1' && remote !== '::1' && remote !== '::ffff:127.0.0.1') {
    socket.destroy();
    console.warn('[proxy] refused non-local connection from ' + remote);
  }
});
