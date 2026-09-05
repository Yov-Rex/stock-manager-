// Tiny in-process rate limiter for /api/auth/login and other
// sensitive endpoints. Uses a sliding-window counter keyed by IP.
//
// This is intentionally simple — no external dependency, no Redis.
// If you ever run multiple server replicas behind a load balancer,
// swap this for a shared store (Redis, Cloudflare KV, etc.).

function createLimiter({ windowMs, max, name }) {
  // buckets: Map<ip, number[]>  (each entry = timestamp ms)
  const buckets = new Map();

  // Sweep old entries every windowMs so the map doesn't grow forever
  // even when nobody is hitting the endpoint.
  setInterval(() => {
    const cutoff = Date.now() - windowMs;
    for (const [ip, hits] of buckets) {
      const fresh = hits.filter(t => t > cutoff);
      if (fresh.length === 0) buckets.delete(ip);
      else if (fresh.length !== hits.length) buckets.set(ip, fresh);
    }
  }, Math.max(windowMs, 30_000)).unref();

  return function rateLimit(req, res, next) {
    const ip = req.ip || req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown';
    const now = Date.now();
    const cutoff = now - windowMs;
    const hits = (buckets.get(ip) || []).filter(t => t > cutoff);
    if (hits.length >= max) {
      const retryAfter = Math.ceil((hits[0] + windowMs - now) / 1000);
      res.setHeader('Retry-After', String(retryAfter));
      return res.status(429).json({
        error: `Too many attempts. Try again in ${retryAfter}s.`,
      });
    }
    hits.push(now);
    buckets.set(ip, hits);
    next();
  };
}

module.exports = { createLimiter };
