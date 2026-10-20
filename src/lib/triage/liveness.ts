import { getDocRows } from "@/db/doc-store";
import type { TaskRecord } from "@/lib/stores/tasks";
import type { Assignment } from "@/lib/stores/assignments";
import { isAssignedTo, type CommThread, type MailboxViewer } from "@/lib/stores/comms";
import { mailboxViewer } from "@/lib/mailbox-viewer";
import { normalizeRecording, type RecordingRecord } from "@/lib/stores/recordings";
import type { Quote } from "@/lib/stores/quotes";
import { quoteAwaitsApprovalBy, quoteBackFromReview } from "@/lib/quote-approval-rules";
import { portalBellGroups } from "@/lib/portal-bell";
import type { BidderState } from "@/lib/parties/rules";
import { bidDueFact } from "./feeds/quotes";
import { parseTriageKey } from "./keys";
import type { SnapshotRow, TriageSource, TriageUser } from "./types";

/** The current state of the sources a frozen row points at. Missing = deleted. */
export type LiveDocs = {
  tasks: ReadonlyMap<string, Pick<TaskRecord, "status">>;
  assignments: ReadonlyMap<string, Pick<Assignment, "done">>;
  threads: ReadonlyMap<string, Pick<CommThread, "status" | "archived" | "assignedTo" | "deleted" | "gmailInboxed">>;
  recordings: ReadonlyMap<string, { actionItems: readonly { key: string; disposition: string }[] }>;
  quotes: ReadonlyMap<string, Quote>;
  /** #348 — bidder rows for the quotes that could still carry a bid-due fact (absent = none loaded). */
  bidders?: ReadonlyMap<string, ReadonlyArray<{ bid: BidderState | null }>>;
};

/** #348 — the cheap pre-check before any bidder read: mine, open, with a due date and no award. Pure. */
export function maybeBidDue(q: Quote, me: Pick<TriageUser, "name">): boolean {
  return !!q.owner && q.owner === me.name && (q.status === "draft" || q.status === "sent") && !!q.bid?.dueAt && !q.bid.awardedPartyId;
}

/**
 * Spec "Snapshots and refresh": between runs the list is frozen, except rows
 * whose source is now done — task/assignment done, thread no longer waiting
 * on us (or archived / disposed in Gmail / reassigned), call to-do decided, quote no longer
 * waiting on me — are hidden on render. Lead / visit / renewal rows stay
 * until their marks or the next snapshot. Pure.
 */
export function closedKeys(rows: readonly SnapshotRow[], docs: LiveDocs, me: TriageUser, now: number, viewer: MailboxViewer): Set<string> {
  const closed = new Set<string>();
  const portalReview = new Set(portalBellGroups([...docs.quotes.values()], me.name, now).review.map((i) => i.id));
  for (const r of rows) {
    const k = parseTriageKey(r.key);
    if (!k) continue;
    switch (k.source) {
      case "task": {
        const t = docs.tasks.get(k.id);
        if (!t || t.status === "done") closed.add(r.key);
        break;
      }
      case "assignment": {
        const a = docs.assignments.get(k.id);
        if (!a || a.done) closed.add(r.key);
        break;
      }
      case "email": {
        const t = docs.threads.get(k.id);
        if (!t || t.status !== "waiting_us" || t.archived || t.deleted || t.gmailInboxed === false || !isAssignedTo(t, viewer)) closed.add(r.key); // #349 — by identity
        break;
      }
      case "call": {
        const item = docs.recordings.get(k.id)?.actionItems.find((a) => a.key === k.part);
        if (!item || item.disposition !== "pending") closed.add(r.key);
        break;
      }
      case "quote": {
        const q = docs.quotes.get(k.id);
        const stillMine =
          !!q &&
          (quoteAwaitsApprovalBy(q, me.name, me.canApprove) ||
            quoteBackFromReview(q, me.name) === "changes" ||
            portalReview.has(q.id) ||
            // #348 — a bid I own, still due and still missing a bidder's current revision (the feed's own rule).
            (maybeBidDue(q, me) && !!bidDueFact(q, docs.bidders?.get(q.id) ?? [], { me, now })));
        if (!stillMine) closed.add(r.key);
        break;
      }
      default:
        break;
    }
  }
  return closed;
}

/** One batched read per collection for just the ids on the list. */
export async function loadClosedKeys(rows: readonly SnapshotRow[], me: TriageUser, now: number, viewerIn?: MailboxViewer): Promise<Set<string>> {
  const idsOf = (src: TriageSource) =>
    rows.flatMap((r) => {
      const k = parseTriageKey(r.key);
      return k && k.source === src ? [k.id] : [];
    });
  const liveMap = <T>(list: Array<{ id: string; deleted: boolean; doc: T }>) => new Map(list.filter((x) => !x.deleted).map((x) => [x.id, x.doc]));
  const [tasks, assignments, threads, recs, quotes, viewer] = await Promise.all([
    getDocRows<TaskRecord>("tasks", idsOf("task")),
    getDocRows<Assignment>("assignments", idsOf("assignment")),
    getDocRows<CommThread>("comms", idsOf("email")),
    getDocRows<RecordingRecord>("recordings", idsOf("call")),
    getDocRows<Quote>("quotes", idsOf("quote")),
    viewerIn ?? mailboxViewer(me),
  ]);
  const recordings = new Map([...liveMap(recs)].map(([id, d]) => [id, normalizeRecording(d)]));
  const liveQuotes = liveMap(quotes);
  // #348 — bidder rows only for quotes that pass the cheap checks (one batched read; parties store loaded lazily).
  const bidIds = [...liveQuotes.values()].filter((q) => maybeBidDue(q, me)).map((q) => q.id);
  let bidders: Map<string, Array<{ bid: BidderState | null }>> | undefined;
  if (bidIds.length) {
    const { listForRecords } = await import("@/lib/stores/parties");
    bidders = await listForRecords("quote", bidIds);
  }
  return closedKeys(rows, { tasks: liveMap(tasks), assignments: liveMap(assignments), threads: liveMap(threads), recordings, quotes: liveQuotes, bidders }, me, now, viewer);
}

/** The sources whose rows liveness can hide (a done task, a thread no longer
 *  waiting on me, a decided call to-do, a quote no longer mine). */
export const LIVENESS_SOURCES: ReadonlySet<TriageSource> = new Set<TriageSource>(["email", "task", "assignment", "call", "quote"]);

/**
 * #350 review — fail closed: when the liveness check itself fails, every row
 * it could have hidden is treated as closed (dropped), never as still open.
 * Lead / visit / renewal rows stay (liveness never hides them). Pure.
 */
export function failClosedKeys(rows: ReadonlyArray<Pick<SnapshotRow, "key">>): Set<string> {
  const out = new Set<string>();
  for (const r of rows) {
    const k = parseTriageKey(r.key);
    if (k && LIVENESS_SOURCES.has(k.source)) out.add(r.key);
  }
  return out;
}
