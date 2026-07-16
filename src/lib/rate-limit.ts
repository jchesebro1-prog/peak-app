/**
 * Tiny in-memory sliding-window rate limiter. Deliberately dependency-free:
 * Peak runs as a single Node process (embedded PGlite), so a per-process Map
 * is the right tool — no Redis to stand up. Counters are best-effort and
 * reset on restart, which is fine for abuse-dampening (spam/DoS) rather than
 * hard quota enforcement. If Peak ever runs multiple instances, swap this for
 * a shared store.
 */

const hits = new Map<string, number[]>();

/**
 * Record an attempt for `key` and report whether it's within `limit` per
 * `windowMs`. Old timestamps are pruned on each call; empty keys are dropped
 * so the map can't grow without bound.
 */
export function rateLimit(
  key: string,
  limit: number,
  windowMs: number
): { ok: boolean; retryAfterMs: number } {
  const now = Date.now();
  const recent = (hits.get(key) || []).filter((t) => now - t < windowMs);

  if (recent.length >= limit) {
    hits.set(key, recent);
    return { ok: false, retryAfterMs: windowMs - (now - recent[0]) };
  }

  recent.push(now);
  hits.set(key, recent);
  return { ok: true, retryAfterMs: 0 };
}

/** Best-effort client IP from proxy headers (empty string if unknown). */
export function clientIp(req: Request): string {
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0]!.trim();
  return req.headers.get("x-real-ip")?.trim() || "";
}
