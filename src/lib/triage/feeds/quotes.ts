import type { Quote } from "@/lib/stores/quotes";
import { quoteAwaitsApprovalBy, quoteBackFromReview } from "@/lib/quote-approval-rules";
import { portalBellGroups } from "@/lib/portal-bell";
import { quoteBuilderHref } from "@/lib/quote-links";
import { displayQuoteNumber } from "@/lib/estimate-number";
import { firstName } from "@/lib/team";
import { bidDueDays, bidDueText, currentRev, isOpenBid, needsRev } from "@/lib/parties/bids";
import type { BidderState } from "@/lib/parties/rules";
import { triageKey } from "../keys";
import type { TriageCandidate, TriageFact } from "../types";
import type { FeedCtx, TriageFeed } from "./context";

/**
 * The approval bell's own rules (#284 quote-approval-rules.ts) and the
 * portal bell's review group (#245 portal-bell.ts, mine or unassigned):
 * awaiting my approval, sent back to me as owner, portal quote to review.
 * One row per quote; a quote matching two rules carries both facts.
 */
export function selectQuotes(
  quotes: readonly Quote[],
  ctx: Pick<FeedCtx, "me" | "now">,
  biddersByQuote?: ReadonlyMap<string, ReadonlyArray<{ bid: BidderState | null }>>
): TriageCandidate[] {
  const me = ctx.me.name;
  const byKey = new Map<string, TriageCandidate>();
  const add = (q: Quote, fact: TriageFact, href: string, since: number, sub: string, escalatedAt?: number) => {
    const key = triageKey.quote(q.id);
    const cur = byKey.get(key);
    if (cur) {
      cur.facts.push(fact);
      if (escalatedAt && escalatedAt > (cur.escalatedAt ?? 0)) cur.escalatedAt = escalatedAt;
      return;
    }
    byKey.set(key, { key, source: "quote", title: q.name || displayQuoteNumber(q), sub, href, since, facts: [fact], ...(escalatedAt ? { escalatedAt } : {}) });
  };
  for (const q of quotes) {
    if (quoteAwaitsApprovalBy(q, me, ctx.me.canApprove)) {
      // #37 — a (re)submit for approval after a "Not mine" brings it back
      add(q, { kind: "quote_awaiting_approval" }, quoteBuilderHref(q), q.review?.submittedAt || q.updatedAt || 0,
        `${displayQuoteNumber(q)} · ${q.customer || ""} · from ${firstName(q.review?.submittedBy || q.owner || "")}`, q.review?.submittedAt || undefined);
    }
    if (quoteBackFromReview(q, me) === "changes") {
      add(q, { kind: "quote_sent_back" }, quoteBuilderHref(q), q.updatedAt || 0,
        `${displayQuoteNumber(q)} · sent back by ${firstName(q.review?.decidedBy || "")}`);
    }
  }
  // #348 — a bid I own that is due within a day (or past due) while a bidder still needs the current revision.
  if (biddersByQuote) {
    for (const q of quotes) {
      const fact = bidDueFact(q, biddersByQuote.get(q.id) ?? [], ctx);
      if (!fact) continue;
      add(q, fact, quoteBuilderHref(q), q.bid?.dueAt || q.updatedAt || 0,
        `${displayQuoteNumber(q)} · ${q.customer || ""} · bid due ${bidDueText(q.bid!.dueAt!)}`);
    }
  }
  const review = new Map(portalBellGroups([...quotes], me, ctx.now).review.map((i) => [i.id, i.href]));
  for (const q of quotes) {
    const href = review.get(q.id);
    if (href) add(q, { kind: "portal_quote_review" }, href, q.updatedAt || 0, `${q.customer || ""} · waiting on a Peak price`);
  }
  return [...byKey.values()];
}

/** The bid-due fact for one quote, or null: mine, still out to bid, due tomorrow or sooner (past due included,
 *  up to 14 Chicago days back — older dead bids drop off), and at least one pending bidder hasn't been sent the
 *  current revision. Pure. */
export function bidDueFact(
  q: Quote,
  bidders: ReadonlyArray<{ bid: BidderState | null }>,
  ctx: Pick<FeedCtx, "me" | "now">
): Extract<TriageFact, { kind: "bid_due" }> | null {
  if (!q.owner || q.owner !== ctx.me.name) return null;
  const dueAt = q.bid?.dueAt;
  if (!dueAt || !isOpenBid(q, bidders)) return null;
  const days = bidDueDays(dueAt, ctx.now);
  if (days > 1 || days < -14) return null;
  const rev = currentRev(q);
  const missing = bidders.filter((b) => needsRev(b.bid, rev)).length;
  return missing ? { kind: "bid_due", days, missing } : null;
}

export function selectBidDue(
  quotes: readonly Quote[],
  biddersByQuote: ReadonlyMap<string, ReadonlyArray<{ bid: BidderState | null }>>,
  ctx: Pick<FeedCtx, "me" | "now">
): TriageCandidate[] {
  return selectQuotes(quotes, ctx, biddersByQuote).filter((c) => c.facts.some((f) => f.kind === "bid_due"));
}

export const quotesFeed: TriageFeed = {
  source: "quote",
  async load(ctx) {
    const quotes = await ctx.data.quotes();
    // #348 — party rows only for my quotes that carry a due date (one batched read).
    const mine = quotes.filter((q) => q.bid?.dueAt && q.owner === ctx.me.name).map((q) => q.id);
    let biddersByQuote: Map<string, Array<{ bid: BidderState | null }>> | undefined;
    if (mine.length) {
      const { listForRecords } = await import("@/lib/stores/parties");
      biddersByQuote = await listForRecords("quote", mine);
    }
    return { candidates: selectQuotes(quotes, ctx, biddersByQuote) };
  },
};
