import { waitingSince, type CommThread } from "@/lib/stores/comms";
import { isOpen as leadIsOpen } from "@/lib/stores/leads";
import { sameName } from "@/lib/quote-approval-rules";
import { money } from "@/lib/format";
import { businessMsBetween } from "../clock";
import { triageKey } from "../keys";
import type { TriageCandidate, TriageFact } from "../types";
import type { FeedCtx, TriageFeed } from "./context";

const HOUR = 3_600_000;
const DAY = 86_400_000;

/** Open quotes / leads by id, for "+10 linked to an open quote or lead". */
export type DealIndex = {
  quotes: ReadonlyMap<string, { status: string; value: number }>;
  leads: ReadonlyMap<string, { open: boolean; value: number }>;
};

export function linkedDealLabel(t: Pick<CommThread, "link">, deals: DealIndex): string | null {
  const l = t.link;
  if (!l?.id) return null;
  if (l.type === "quote") {
    const q = deals.quotes.get(l.id);
    if (q && (q.status === "draft" || q.status === "sent")) return `open quote ${money(q.value)}`;
  }
  if (l.type === "lead") {
    const d = deals.leads.get(l.id);
    if (d?.open) return `open lead ${money(d.value)}`;
  }
  return null;
}

/**
 * Threads assigned to me that are waiting on us — the bell's own rule
 * (nav-counts.ts "Customers waiting on a reply"): status waiting_us,
 * assignedTo me, not archived (Peak or Gmail side), not in Deleted.
 * ≥ 1 business day → "customer waiting"; younger → "customer message".
 */
export function selectEmail(threads: readonly CommThread[], deals: DealIndex, ctx: Pick<FeedCtx, "me" | "now">): TriageCandidate[] {
  const out: TriageCandidate[] = [];
  for (const t of threads) {
    if (t.status !== "waiting_us" || !sameName(t.assignedTo, ctx.me.name)) continue;
    if (t.archived || t.deleted || t.gmailInboxed === false) continue;
    const since = waitingSince(t) ?? t.updatedAt ?? 0;
    const biz = since ? businessMsBetween(since, ctx.now) : 0;
    const days = Math.floor(biz / DAY);
    const facts: TriageFact[] = [
      days >= 1 ? { kind: "customer_waiting", businessDays: days } : { kind: "customer_message_new", hours: Math.floor(biz / HOUR) },
    ];
    const deal = linkedDealLabel(t, deals);
    if (deal) facts.push({ kind: "linked_open_deal", label: deal });
    out.push({
      key: triageKey.email(t.id),
      source: "email",
      title: t.customer || t.contactName || t.contactEmail || t.subject || "Customer",
      sub: t.subject || "(no subject)",
      href: `/inbox?thread=${encodeURIComponent(t.id)}`,
      since,
      facts,
    });
  }
  return out;
}

export const emailFeed: TriageFeed = {
  source: "email",
  async load(ctx) {
    const [threads, quotes, leads] = await Promise.all([ctx.data.threads(), ctx.data.quotes(), ctx.data.leads()]);
    const deals: DealIndex = {
      quotes: new Map(quotes.map((q) => [q.id, { status: q.status, value: Number(q.value) || 0 }])),
      leads: new Map(leads.map((l) => [l.id, { open: leadIsOpen(l), value: Number(l.value) || 0 }])),
    };
    return { candidates: selectEmail(threads, deals, ctx) };
  },
};
