/**
 * The origin the headless browser prints from (#222). QUOTE_PDF_ORIGIN pins it;
 * otherwise it is the request's own host (on Vercel the platform routed the
 * request by that host, so it is one of this project's domains). A host that
 * isn't a bare hostname[:port] is refused — the signed print URL is never sent
 * anywhere a request header made up.
 */
const HOST_RE = /^[A-Za-z0-9.-]+(:\d{1,5})?$/;
const FIXED_RE = /^https?:\/\/[A-Za-z0-9.-]+(:\d{1,5})?\/?$/;

export function originFrom(host: string | null, proto: string | null, fixed?: string | null): string | null {
  if (fixed) return FIXED_RE.test(fixed.trim()) ? fixed.trim().replace(/\/+$/, "") : null;
  const h = (host || "").trim();
  if (!h || !HOST_RE.test(h)) return null;
  const p = (proto || "").split(",")[0].trim().toLowerCase();
  const scheme = p === "http" || p === "https" ? p : /^(localhost|127\.0\.0\.1)(:\d+)?$/.test(h) ? "http" : "https";
  return `${scheme}://${h}`;
}

const ORIGIN_RE = /^https?:\/\/[A-Za-z0-9.-]+(:\d{1,5})?$/;

/** The shape originFrom returns — scheme + bare host[:port], no path, no
 *  trailing slash, no credentials. The generator refuses anything else, so a
 *  signed print URL is only ever built on an origin of this shape. */
export function isAppOrigin(origin: unknown): origin is string {
  return typeof origin === "string" && ORIGIN_RE.test(origin);
}
