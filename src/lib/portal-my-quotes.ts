/**
 * Portal "My quotes" + Home split (#288, spec §1.5–§1.6). Pure view models
 * over the quotes the page already loaded:
 *
 * - `myQuotesView` — the customer-built quotes (`isCustomerBuiltQuote`) this
 *   customer's portal lists (`portalListsQuote`), bucketed Open / Accepted /
 *   Closed, newest built first.
 * - `homePortalQuotes` — Home's list: everything else the portal lists (the
 *   Peak-sent estimates), newest activity first as before.
 */
import { isCustomerBuiltQuote, isPortalRenamable } from "@/lib/portal-quote-names";
import { portalListsQuote } from "@/lib/stores/quotes";

export type MyQuotesFilter = "open" | "accepted" | "closed";
export const MY_QUOTES_FILTERS: readonly MyQuotesFilter[] = ["open", "accepted", "closed"];

/** `?show=` → a filter; anything else is the default, Open. */
export function parseMyQuotesFilter(raw: string): MyQuotesFilter {
  return (MY_QUOTES_FILTERS as readonly string[]).includes(raw) ? (raw as MyQuotesFilter) : "open";
}

/** The fields the view model reads — a `Quote` satisfies it. */
export type MyQuoteFields = {
  id: string;
  customerId: string | null;
  status: string;
  source: string;
  quoteType?: string;
  createdAt?: number;
  updatedAt?: number;
  portalAcceptance?: unknown;
  portalFirm?: { validUntil: number } | null;
};

/** Accepted = won, or the customer accepted (`portalAcceptance`, awaiting
 *  Peak's confirmation). Closed = lost / declined. Open = everything else
 *  listed: the customer's review drafts, sent quotes, expired-but-refreshable. */
export function myQuoteBucket(q: { status: string; portalAcceptance?: unknown }): MyQuotesFilter {
  if (q.status === "lost") return "closed";
  if (q.status === "won" || q.portalAcceptance) return "accepted";
  return "open";
}

/** Catalog / Flame test / Inspection (legacy self-serve: Estimate). */
export function portalQuoteTypeLabel(q: { source?: string | null; quoteType?: string | null }): string {
  if (q.quoteType === "flame_test") return "Flame test";
  if (q.quoteType === "inspection") return "Inspection";
  if (q.source === "portal-self-serve") return "Estimate";
  return "Catalog";
}

export type MyQuoteRow<T> = { q: T; renamable: boolean };

/** The customer-built quotes this customer's portal lists. */
function listedCustomerBuilt<T extends MyQuoteFields>(quotes: readonly T[], cid: string): T[] {
  return quotes.filter((q) => !!cid && isCustomerBuiltQuote(q) && portalListsQuote(q as Parameters<typeof portalListsQuote>[0], cid));
}

function countBuckets(mine: readonly MyQuoteFields[]): Record<MyQuotesFilter, number> {
  const counts: Record<MyQuotesFilter, number> = { open: 0, accepted: 0, closed: 0 };
  for (const q of mine) counts[myQuoteBucket(q)]++;
  return counts;
}

/** Home's My quotes card: counts per filter, no rows built. */
export function myQuotesCounts(quotes: readonly MyQuoteFields[], cid: string): Record<MyQuotesFilter, number> {
  return countBuckets(listedCustomerBuilt(quotes, cid));
}

/** My quotes: the rows for one filter, newest built first, plus every
 *  filter's count. Expiry is the shared row's own call (canAcceptPortal). */
export function myQuotesView<T extends MyQuoteFields>(
  quotes: readonly T[],
  cid: string,
  filter: MyQuotesFilter
): { filter: MyQuotesFilter; rows: MyQuoteRow<T>[]; counts: Record<MyQuotesFilter, number> } {
  const mine = listedCustomerBuilt(quotes, cid);
  const rows = mine
    .filter((q) => myQuoteBucket(q) === filter)
    .sort((a, b) => (b.createdAt || b.updatedAt || 0) - (a.createdAt || a.updatedAt || 0))
    .map((q) => ({ q, renamable: isPortalRenamable(q) }));
  return { filter, rows, counts: countBuckets(mine) };
}

/** Home's quote list: what the portal lists for this customer minus the
 *  customer-built quotes (those live under My quotes). Newest activity first. */
export function homePortalQuotes<T extends MyQuoteFields>(quotes: readonly T[], cid: string): T[] {
  return quotes
    .filter((q) => !!cid && !isCustomerBuiltQuote(q) && portalListsQuote(q as Parameters<typeof portalListsQuote>[0], cid))
    .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
}
