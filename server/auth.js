// JWT auth helpers. Tokens are signed with HS256 and stored in an httpOnly
// cookie. `requireAuth` protects every endpoint below; `requireAdmin`
// additionally blocks non-admin callers.
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const db = require('./db');

// JWT_SECRET must be set in production. When the env var is missing AND
// we're not in an explicit dev mode, refuse to boot and print a one-time
// generated secret the operator can paste into their env file. Falling
// back to a hard-coded string in production is exactly the kind of bug
// that lets anyone forge tokens.
const isDev = process.env.NODE_ENV === 'development' || process.env.SM_ALLOW_INSECURE_SECRET === '1';
let JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  if (isDev) {
    JWT_SECRET = crypto.randomBytes(32).toString('hex');
    console.warn('[auth] WARNING: JWT_SECRET not set — generated an ephemeral one for this run.');
    console.warn('         All existing tokens are invalidated on restart.');
    console.warn('         Set JWT_SECRET in your env for stable sessions.');
  } else {
    const fresh = crypto.randomBytes(32).toString('hex');
    console.error('=================================================================');
    console.error('[auth] FATAL: JWT_SECRET is not set.');
    console.error('        Refusing to start with a hard-coded signing key.');
    console.error('        Set this in your environment, then restart:');
    console.error('');
    console.error('        JWT_SECRET=' + fresh);
    console.error('');
    console.error('        (A random 32-byte secret was generated above; copy it.');
    console.error('        The same value must be set on every replica, otherwise');
    console.error('        users will be logged out whenever the server restarts.)');
    console.error('=================================================================');
    process.exit(1);
  }
}
const TOKEN_NAME = 'sm_token';
// Token lifetime. 12h was the original; we shorten to 8h for online use
// so a stolen token has a finite blast radius.
const TOKEN_TTL = process.env.JWT_TTL || '8h';

function sign(user) {
  return jwt.sign(
    { id: user.id, username: user.username, role: user.role, full_name: user.full_name },
    JWT_SECRET,
    { expiresIn: TOKEN_TTL }
  );
}

function setAuthCookie(res, token) {
  // `secure: true` whenever the request came in over HTTPS (directly or via
  // a trusted proxy like Cloudflare Tunnel). The cookie is also SameSite=Lax
  // so it isn't sent on cross-site form posts.
  const isHttps = req => req.secure || (req.headers['x-forwarded-proto'] || '').includes('https');
  res.cookie(TOKEN_NAME, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: isHttps(res.req),
    maxAge: 8 * 60 * 60 * 1000,
  });
}

function clearAuthCookie(res) {
  const isHttps = req => req.secure || (req.headers['x-forwarded-proto'] || '').includes('https');
  res.clearCookie(TOKEN_NAME, { secure: isHttps(res.req) });
}

function requireAuth(req, res, next) {
  const header = req.headers.authorization;
  let token = null;
  if (header && header.startsWith('Bearer ')) token = header.slice(7);
  if (!token && req.cookies) token = req.cookies[TOKEN_NAME];
  if (!token) return res.status(401).json({ error: 'Not authenticated' });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

function requireAdmin(req, res, next) {
  if (!req.user || req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Admin role required' });
  }
  next();
}

function hashPassword(plain) {
  return bcrypt.hashSync(plain, 10);
}
function verifyPassword(plain, hash) {
  return bcrypt.compareSync(plain, hash);
}

// Verify credentials and return the user row (without hash) or null.
function authenticate(username, password) {
  const row = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  if (!row) return null;
  if (!verifyPassword(password, row.password_hash)) return null;
  const { password_hash, ...safe } = row;
  return safe;
}

module.exports = {
  sign, setAuthCookie, clearAuthCookie,
  requireAuth, requireAdmin,
  hashPassword, verifyPassword, authenticate,
};