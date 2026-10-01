/**
 * Customer-named portal quotes (#288, spec §1.1–§1.4). Pure and client-safe —
 * the cart and service forms pre-fill their "Name this quote" box from these,
 * and the server applies the same rules to whatever comes back.
 */

export const PORTAL_QUOTE_NAME_MAX = 120;

/** The sources a customer builds in the portal. The legacy
 *  `portal-self-serve` (the retired estimate builder) counts too. */
const CUSTOMER_BUILT_SOURCES = new Set(["portal-catalog", "portal-service", "portal-self-serve"]);

/** Invisible characters a name never needs: bidi embeddings / overrides
 *  (U+202A–202E) and isolates (U+2066–2069), the zero-width space (U+200B)
 *  and the BOM (U+FEFF), plus control characters. ZWNJ / ZWJ (U+200C/200D)
 *  stay — scripts and emoji sequences need them. */
const STRIP = /[\p{Cc}\u200B\u202A-\u202E\u2066-\u2069\uFEFF]/gu;

const GRAPHEMES: { segment(s: string): Iterable<{ segment: string }> } | null =
  typeof Intl !== "undefined" && typeof (Intl as { Segmenter?: unknown }).Segmenter === "function"
    ? new Intl.Segmenter("en", { granularity: "grapheme" })
    : null;

/** The longest prefix of `s` of at most `max` code points that never splits a
 *  grapheme cluster (an emoji family, a flag, a base + combining mark) — a
 *  cluster that doesn't fit whole is dropped. Falls back to code points where
 *  Intl.Segmenter is unavailable. */
function capGraphemes(s: string, max: number): string {
  if (!GRAPHEMES) return Array.from(s).slice(0, max).join("");
  let out = "";
  let used = 0;
  for (const { segment } of GRAPHEMES.segment(s)) {
    const n = Array.from(segment).length;
    if (used + n > max) break;
    out += segment;
    used += n;
  }
  return out;
}

/** Trimmed, control characters and invisible bidi / zero-width / BOM
 *  characters stripped (STRIP), inner whitespace collapsed, capped at 120
 *  characters (code points) without splitting a grapheme. Anything that
 *  isn't a string → "". */
export function cleanPortalQuoteName(raw: unknown): string {
  if (typeof raw !== "string") return "";
  const flat = raw
    .replace(/\s+/g, " ")
    .replace(STRIP, "")
    .replace(/\s+/g, " ")
    .trim();
  return capGraphemes(flat, PORTAL_QUOTE_NAME_MAX).trim();
}

const DATE_FORMAT = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
  timeZone: "America/Chicago",
});

/** "Oct 1, 2026" — the date part of a default name, in Peak's time zone. */
export function portalQuoteDate(at: number): string {
  return DATE_FORMAT.format(new Date(at));
}

/** "<label><suffix> — <date>", with only `label` cut to fit the 120 cap — the
 *  suffix (" + N more") and the date always survive whole. */
function withDate(label: string, at: number, suffix = ""): string {
  const tail = `${suffix} — ${portalQuoteDate(at)}`;
  const room = Math.max(1, PORTAL_QUOTE_NAME_MAX - Array.from(tail).length);
  const cut = capGraphemes(label, room).trim();
  return cleanPortalQuoteName(cut + tail);
}

/** Catalog cart: "<venue label> — <date>", or "<company> — <date>" with no venue. */
export function defaultCatalogQuoteName(venueLabel: string | null, companyName: string, at: number): string {
  const venue = cleanPortalQuoteName(venueLabel);
  return withDate(venue || cleanPortalQuoteName(companyName) || "Quote", at);
}

/** Service: "<first venue> — <date>", "<first venue> + N more — <date>", or
 *  the company name when no venue is picked. */
export function defaultServiceQuoteName(venueLabels: string[], companyName: string, at: number): string {
  const first = cleanPortalQuoteName(venueLabels[0]);
  if (!first) return withDate(cleanPortalQuoteName(companyName) || "Quote", at);
  const more = venueLabels.length - 1;
  return withDate(first, at, more > 0 ? ` + ${more} more` : "");
}

/** The ONE definition of a customer-built quote (spec §1.1). */
export function isCustomerBuiltQuote(q: { source?: string | null }): boolean {
  return !!q.source && CUSTOMER_BUILT_SOURCES.has(q.source);
}

/** A customer may rename a quote they built until it's accepted
 *  (`portalAcceptance` set) or decided (won / lost). Tenant scoping
 *  (`portalListsQuote`) and the session are the caller's checks. */
export function isPortalRenamable(q: { source?: string | null; status: string; portalAcceptance?: unknown }): boolean {
  return isCustomerBuiltQuote(q) && !q.portalAcceptance && q.status !== "won" && q.status !== "lost";
}
