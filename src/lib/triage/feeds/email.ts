import { isAssignedTo, lastInbound, waitingSince, type CommThread, type MailboxViewer } from "@/lib/stores/comms";
import { mailboxViewer } from "@/lib/mailbox-viewer";
import { courtIsCurrent } from "@/lib/inbox-org/court-current";
import { isPeakAddress } from "@/lib/inbox-org/internal";
import { inboxOrgDisabled } from "@/lib/inbox-org/kill-switch";
import { isOpen as leadIsOpen } from "@/lib/stores/leads";
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

/** #335 — the ball is in my court: status waiting_us AND (no court yet, or
 *  the court says "me"). Status stays the gate because in-app replies, Mark
 *  replied / Close and Gmail status labels change it without re-organizing
 *  the thread — a court can be stale, a status can't. A teammate's reply
 *  (court customer) no longer counts against me; noise never does. D901: a
 *  court not computed against the newest email message (organizing failed or
 *  INBOX_ORG_DISABLED is on) is ignored — status alone decides — and while
 *  the kill switch is on only the status counts (court and noise tag unread). */
export function onMyCourt(
  t: Pick<CommThread, "court" | "status" | "noise"> & { messages?: CommThread["messages"] },
  env?: Record<string, string | undefined>
): boolean {
  if (t.status !== "waiting_us") return false;
  if (inboxOrgDisabled(env)) return true; // status only — no court, no noise tag
  if (t.noise?.flagged) return false;
  if (!t.court || !courtIsCurrent(t)) return true;
  return t.court.owner === "me";
}

/** #351 review M3 — the newest message from an OUTSIDE sender (#335's
 *  internal check: the team's addresses and own domains), the escalation a
 *  "Not mine" yields to. A teammate's or my own mail never escalates. Pure. */
export function lastExternalInboundAt(t: Pick<CommThread, "messages" | "contactEmail">, isInternal: (email: string) => boolean): number | null {
  const m = t.messages || [];
  for (let i = m.length - 1; i >= 0; i--) {
    if (m[i].direction !== "in") continue;
    const from = (m[i].fromEmail || t.contactEmail || "").trim().toLowerCase();
    if (from && isInternal(from)) continue;
    return typeof m[i].at === "number" ? m[i].at : null;
  }
  return null;
}

/**
 * Threads assigned to me that are waiting on us — the bell's own rule
 * (nav-counts.ts "Customers waiting on a reply"): status waiting_us and in my
 * court (#335 onMyCourt; not flagged noise), assignedTo me, not archived (Peak or Gmail
 * side), not in Deleted.
 * ≥ 1 business day → "customer waiting"; younger → "customer message".
 */
export function selectEmail(
  threads: readonly CommThread[],
  deals: DealIndex,
  ctx: Pick<FeedCtx, "now"> & { viewer: MailboxViewer; isInternal?: (email: string) => boolean }
): TriageCandidate[] {
  const isInternal = ctx.isInternal ?? isPeakAddress;
  const out: TriageCandidate[] = [];
  for (const t of threads) {
    // #349 — assigned to me by identity (assignedToId, else a unique name)
    if (!onMyCourt(t) || !isAssignedTo(t, ctx.viewer)) continue;
    if (t.archived || t.deleted || t.gmailInboxed === false) continue;
    const since = waitingSince(t) ?? lastInbound(t)?.at ?? t.updatedAt ?? 0;
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
      // #37 — a new message from an outside sender brings back a "Not mine" (M3: never a teammate's)
      ...(() => {
        const at = lastExternalInboundAt(t, isInternal);
        return at ? { escalatedAt: at } : {};
      })(),
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
    // #335's internal-sender check (the team's addresses + own domains); Peak's own domain if it can't be read
    const org = await import("@/lib/inbox-org/pipeline").then((m) => m.loadOrgContext()).catch(() => null);
    return { candidates: selectEmail(threads, deals, { now: ctx.now, viewer: await mailboxViewer(ctx.me), isInternal: org?.isInternal ?? isPeakAddress }) };
  },
};
