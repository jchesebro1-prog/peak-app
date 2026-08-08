/**
 * Tiny in-memory sliding-window rate limiter. Deliberately dependency-free:
 * Peak runs as a single Node process (embedded PGlite), so a per-process Map
 * is the right tool — no Redis to stand up. Counters are best-effort and
 * reset on restart, which is fine for abuse-dampening (spam/DoS) rather than
 * hard quota enforcement. If Peak ever runs multiple instances, swap this for
 * a shared store.
 *
 * Dev-mode caveat (verified 2026-08-08, while building #88): `next dev` in
 * this Next version recompiles a route's module graph per request, so this
 * module's top-level `hits` Map does NOT persist across requests under
 * `npm run dev` — every request sees a fresh, empty map, and rate limiting
 * looks like a no-op locally. Confirmed real under `next build && next
 * start` (a production-shaped boot): the same two-request dedup sequence
 * that never triggers in dev correctly returns `duplicate: true` on the
 * second request. If this ever looks broken again, reproduce against a
 * production build before assuming the limiter itself is at fault.
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

/**
 * Undo the most recent successful `rateLimit(key, ...)` call — for callers
 * that consume a token up front to gate an expensive operation, then find
 * the operation itself failed. Without this, a token spent on a write that
 * never happened blocks a legitimate retry for the rest of the window (PUNCHLIST
 * #88): the caller sees a false "duplicate"/"already tried" response instead
 * of a chance to resubmit.
 *
 * Pops the single most recent timestamp rather than clearing the key, so a
 * caller that legitimately hit the limit for other reasons within the same
 * window isn't reset. Best-effort like the rest of this module — under a
 * race between two requests for the same key, the popped timestamp isn't
 * guaranteed to be the one the failing call itself pushed.
 */
export function rateLimitRefund(key: string): void {
  const recent = hits.get(key);
  if (!recent || recent.length === 0) return;
  recent.pop();
  if (recent.length === 0) hits.delete(key);
  else hits.set(key, recent);
}

/** Best-effort client IP from proxy headers (empty string if unknown). */
export function clientIp(req: Request): string {
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0]!.trim();
  return req.headers.get("x-real-ip")?.trim() || "";
}
