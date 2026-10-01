/**
 * Customer-named portal quotes (#288, spec §1.1–§1.4). Pure and client-safe —
 * the cart and service forms pre-fill their "Name this quote" box from these,
 * and the server applies the same rules to whatever comes back.
 */

export const PORTAL_QUOTE_NAME_MAX = 120;

/** The sources a customer builds in the portal. The legacy
 *  `portal-self-serve` (the retired estimate builder) counts too. */
const CUSTOMER_BUILT_SOURCES = new Set(["portal-catalog", "portal-service", "portal-self-serve"]);

/** Trimmed, control characters stripped, inner whitespace collapsed, capped
 *  at 120 characters (code points). Anything that isn't a string → "". */
export function cleanPortalQuoteName(raw: unknown): string {
  if (typeof raw !== "string") return "";
  const flat = raw
    .replace(/\s+/g, " ")
    .replace(/\p{Cc}/gu, "")
    .replace(/\s+/g, " ")
    .trim();
  return Array.from(flat).slice(0, PORTAL_QUOTE_NAME_MAX).join("").trim();
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

function withDate(label: string, at: number): string {
  return cleanPortalQuoteName(`${label} — ${portalQuoteDate(at)}`);
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
  return withDate(more > 0 ? `${first} + ${more} more` : first, at);
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
