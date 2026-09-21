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

/**
 * Auth.js `redirect` callback logic (#95). Honour a post-sign-in URL when it
 * is (a) on the same origin as the configured baseUrl — including the path
 * and query, so an OAuth hop like /api/gmail/callback?code=… completes — or
 * (b) on a local/private host (localhost, LAN IP, <name>.local), so a dev
 * session never bounces to a different origin whose cookie wouldn't apply.
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
    const h = u.hostname;
    const isLocal =
      h === "localhost" ||
      h === "127.0.0.1" ||
      h.endsWith(".local") ||
      /^10\./.test(h) ||
      /^192\.168\./.test(h) ||
      /^172\.(1[6-9]|2\d|3[01])\./.test(h);
    const sameOrigin = u.origin === new URL(baseUrl).origin;
    if (isLocal || sameOrigin) return u.origin + u.pathname + u.search;
  } catch {
    /* fall through */
  }
  return baseUrl;
}
