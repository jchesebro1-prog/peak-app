/**
 * Where to land after sign-in (#95). The OAuth callback routes bounce an
 * unauthenticated request to /login?callbackUrl=<their own URL>; honouring it
 * lets a Gmail connect that lost its cookie mid-hop still complete. Only a
 * same-origin path is ever returned — anything else is the app root — so this
 * cannot become an open redirect. /login itself is refused to avoid a loop.
 */
export function safeCallbackPath(raw: string | undefined, origin: string): string {
  if (!raw) return "/";
  let u: URL;
  try {
    u = new URL(raw, origin);
  } catch {
    return "/";
  }
  if (u.origin !== new URL(origin).origin) return "/";
  if (u.pathname.startsWith("//")) return "/";
  if (u.pathname === "/login") return "/";
  return u.pathname + u.search;
}

/** Is this hostname a local/private one — localhost, a LAN IP, or
 *  `<name>.local`? Anchored exact matches only: `/^10\./`-style unanchored
 *  prefix tests would pass `10.evil.example` (any public hostname that
 *  merely starts with "10." or "192.168.") as "local", which is an open
 *  redirect. */
export function isPrivateHost(h: string): boolean {
  return (
    h === "localhost" ||
    h === "127.0.0.1" ||
    h.endsWith(".local") ||
    /^10(\.\d{1,3}){3}$/.test(h) ||
    /^192\.168(\.\d{1,3}){2}$/.test(h) ||
    /^172\.(1[6-9]|2\d|3[01])(\.\d{1,3}){2}$/.test(h)
  );
}

/**
 * Auth.js `redirect` callback logic (#95). Honour a post-sign-in URL when it
 * is (a) on the same origin as the configured baseUrl — including the path
 * and query, so an OAuth hop like /api/gmail/callback?code=… completes — or
 * (b) a "local hop": both the configured baseUrl AND the requested URL are on
 * a local/private host (localhost, LAN IP, <name>.local). Local hosts are
 * honoured only when baseUrl itself is local (dev/LAN) — a production
 * baseUrl never hops to a LAN/localhost URL, since that URL's cookie
 * wouldn't apply there anyway and it would otherwise be an open redirect to
 * any host merely claiming to be private.
 * A bare "/"-prefixed path is resolved against baseUrl and returned
 * absolute, same-origin. Anything else → baseUrl, so this can never be an
 * open redirect. Every input goes through URL resolution — a bare-path fast
 * path was removed because `new URL("/\\evil.example/x", baseUrl)` resolves
 * to a foreign origin (backslashes are normalised to slashes by the URL
 * parser), so a naive `startsWith("/")` check let it slip past the
 * same-origin check below.
 */
export function resolveSignInRedirect(url: string, baseUrl: string): string {
  try {
    const u = new URL(url, baseUrl);
    const base = new URL(baseUrl);
    const sameOrigin = u.origin === base.origin;
    const localHop = isPrivateHost(base.hostname) && isPrivateHost(u.hostname);
    if (sameOrigin || localHop) return u.origin + u.pathname + u.search;
  } catch {
    /* fall through */
  }
  return baseUrl;
}
