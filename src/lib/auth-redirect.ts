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
