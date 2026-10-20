/**
 * The Quotes hub's filters, counts and order (Jeff 2026-10-15 #11), pure so the
 * harness can check them against a full set. The page reads every live quote
 * as a slim SQL projection (`listQuoteRows`), runs this over ALL of them, and
 * only then cuts the 50-row page — so the owner scope, search, type chips,
 * Out to bid, status counts and the stat tiles always describe every match,
 * never just the page on screen.
 */
import { quoteSearchRank } from "@/lib/estimate-number";
import { isOpenBid, type QuoteBid } from "@/lib/parties/bids";
import type { BidderState } from "@/lib/parties/rules";

export const HUB_TYPE_KEYS = ["system", "flame_test", "repair", "inspection", "consulting", "rental"] as const;
export const HUB_STATUSES = ["draft", "sent", "won", "lost"] as const;

export type HubQuote = {
  id: string;
  name?: string;
  customer?: string;
  owner?: string;
  status: string;
  quoteType?: string;
  value?: number;
  estNo?: number;
  estSuffix?: number;
  bid?: QuoteBid | null;
};

export type HubFilters = {
  /** "all" | "mine" | a teammate's name */
  scope: string;
  me: string;
  /** "all" or one of HUB_STATUSES */
  status: string;
  /** "all" or one of HUB_TYPE_KEYS */
  type: string;
  /** Out to bid only */
  bid: boolean;
  q: string;
};

export type HubView<Q extends HubQuote> = {
  /** After scope + search + type + Out to bid — what the stat tiles and status counts read. */
  scoped: Q[];
  /** `scoped` narrowed by the status chip — the rows the list pages through. */
  filtered: Q[];
  typeCounts: Record<string, number>;
  outToBidCount: number;
  statusCounts: Record<string, number>;
};

/** A quote with no quoteType is a system quote. */
export function hubTypeOf(q: { quoteType?: string }): string {
  return q.quoteType || "system";
}

/**
 * `rows` arrive newest first; a search keeps that order within a rank tier
 * (exact estimate-number hits first). `bidders(id)` is the quote's bidder
 * parties (gc/ec with bid state) and `bidderNames(id)` their company names,
 * which the search also reads.
 */
export function quotesHubView<Q extends HubQuote>(
  rows: readonly Q[],
  f: HubFilters,
  bidders: (id: string) => ReadonlyArray<{ bid: BidderState | null }>,
  bidderNames: (id: string) => readonly string[]
): HubView<Q> {
  let scoped: Q[] =
    f.scope === "all" ? rows.slice() : rows.filter((q) => q.owner === (f.scope === "mine" ? f.me : f.scope));
  const term = f.q.trim();
  if (term) {
    scoped = scoped
      .map((q, i) => ({ q, i, r: quoteSearchRank({ ...q, bidders: bidderNames(q.id) }, term) }))
      .filter((x): x is { q: Q; i: number; r: number } => x.r !== null)
      .sort((a, b) => a.r - b.r || a.i - b.i)
      .map((x) => x.q);
  }
  const typeCounts: Record<string, number> = { all: scoped.length };
  for (const k of HUB_TYPE_KEYS) typeCounts[k] = scoped.filter((q) => hubTypeOf(q) === k).length;
  if (f.type !== "all") scoped = scoped.filter((q) => hubTypeOf(q) === f.type);
  const outToBid = (q: Q) => isOpenBid(q, bidders(q.id));
  const outToBidCount = scoped.filter(outToBid).length;
  if (f.bid) scoped = scoped.filter(outToBid);
  const statusCounts: Record<string, number> = { all: scoped.length };
  for (const s of HUB_STATUSES) statusCounts[s] = scoped.filter((q) => q.status === s).length;
  const filtered = f.status === "all" ? scoped : scoped.filter((q) => q.status === f.status);
  return { scoped, filtered, typeCounts, outToBidCount, statusCounts };
}
