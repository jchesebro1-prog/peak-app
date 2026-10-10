import { getAll as allQuotes, type Quote } from "@/lib/stores/quotes";
import { quoteAwaitsApprovalBy, quoteBackFromReview } from "@/lib/quote-approval-rules";
import { portalBellGroups } from "@/lib/portal-bell";
import { quoteBuilderHref } from "@/lib/quote-links";
import { displayQuoteNumber } from "@/lib/estimate-number";
import { firstName } from "@/lib/team";
import { triageKey } from "../keys";
import type { TriageCandidate, TriageFact } from "../types";
import type { FeedCtx, TriageFeed } from "./context";

/**
 * The approval bell's own rules (#284 quote-approval-rules.ts) and the
 * portal bell's review group (#245 portal-bell.ts, mine or unassigned):
 * awaiting my approval, sent back to me as owner, portal quote to review.
 * One row per quote; a quote matching two rules carries both facts.
 */
export function selectQuotes(quotes: readonly Quote[], ctx: Pick<FeedCtx, "me" | "now">): TriageCandidate[] {
  const me = ctx.me.name;
  const byKey = new Map<string, TriageCandidate>();
  const add = (q: Quote, fact: TriageFact, href: string, since: number, sub: string) => {
    const key = triageKey.quote(q.id);
    const cur = byKey.get(key);
    if (cur) {
      cur.facts.push(fact);
      return;
    }
    byKey.set(key, { key, source: "quote", title: q.name || displayQuoteNumber(q), sub, href, since, facts: [fact] });
  };
  for (const q of quotes) {
    if (quoteAwaitsApprovalBy(q, me, ctx.me.canApprove)) {
      add(q, { kind: "quote_awaiting_approval" }, quoteBuilderHref(q), q.review?.submittedAt || q.updatedAt || 0,
        `${displayQuoteNumber(q)} · ${q.customer || ""} · from ${firstName(q.review?.submittedBy || q.owner || "")}`);
    }
    if (quoteBackFromReview(q, me) === "changes") {
      add(q, { kind: "quote_sent_back" }, quoteBuilderHref(q), q.updatedAt || 0,
        `${displayQuoteNumber(q)} · sent back by ${firstName(q.review?.decidedBy || "")}`);
    }
  }
  const review = new Map(portalBellGroups([...quotes], me, ctx.now).review.map((i) => [i.id, i.href]));
  for (const q of quotes) {
    const href = review.get(q.id);
    if (href) add(q, { kind: "portal_quote_review" }, href, q.updatedAt || 0, `${q.customer || ""} · waiting on a Peak price`);
  }
  return [...byKey.values()];
}

export const quotesFeed: TriageFeed = {
  source: "quote",
  async load(ctx) {
    return { candidates: selectQuotes(await allQuotes(), ctx) };
  },
};
