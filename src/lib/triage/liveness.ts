import { getDocRows } from "@/db/doc-store";
import type { TaskRecord } from "@/lib/stores/tasks";
import type { Assignment } from "@/lib/stores/assignments";
import type { CommThread } from "@/lib/stores/comms";
import { normalizeRecording, type RecordingRecord } from "@/lib/stores/recordings";
import type { Quote } from "@/lib/stores/quotes";
import { quoteAwaitsApprovalBy, quoteBackFromReview, sameName } from "@/lib/quote-approval-rules";
import { portalBellGroups } from "@/lib/portal-bell";
import { parseTriageKey } from "./keys";
import type { SnapshotRow, TriageSource, TriageUser } from "./types";

/** The current state of the sources a frozen row points at. Missing = deleted. */
export type LiveDocs = {
  tasks: ReadonlyMap<string, Pick<TaskRecord, "status">>;
  assignments: ReadonlyMap<string, Pick<Assignment, "done">>;
  threads: ReadonlyMap<string, Pick<CommThread, "status" | "archived" | "assignedTo" | "deleted" | "gmailInboxed">>;
  recordings: ReadonlyMap<string, { actionItems: readonly { key: string; disposition: string }[] }>;
  quotes: ReadonlyMap<string, Quote>;
};

/**
 * Spec "Snapshots and refresh": between runs the list is frozen, except rows
 * whose source is now done — task/assignment done, thread no longer waiting
 * on us (or archived / disposed in Gmail / reassigned), call to-do decided, quote no longer
 * waiting on me — are hidden on render. Lead / visit / renewal rows stay
 * until their marks or the next snapshot. Pure.
 */
export function closedKeys(rows: readonly SnapshotRow[], docs: LiveDocs, me: TriageUser, now: number): Set<string> {
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
        if (!t || t.status !== "waiting_us" || t.archived || t.deleted || t.gmailInboxed === false || !sameName(t.assignedTo, me.name)) closed.add(r.key);
        break;
      }
      case "call": {
        const item = docs.recordings.get(k.id)?.actionItems.find((a) => a.key === k.part);
        if (!item || item.disposition !== "pending") closed.add(r.key);
        break;
      }
      case "quote": {
        const q = docs.quotes.get(k.id);
        const stillMine = !!q && (quoteAwaitsApprovalBy(q, me.name, me.canApprove) || quoteBackFromReview(q, me.name) === "changes" || portalReview.has(q.id));
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
export async function loadClosedKeys(rows: readonly SnapshotRow[], me: TriageUser, now: number): Promise<Set<string>> {
  const idsOf = (src: TriageSource) =>
    rows.flatMap((r) => {
      const k = parseTriageKey(r.key);
      return k && k.source === src ? [k.id] : [];
    });
  const liveMap = <T>(list: Array<{ id: string; deleted: boolean; doc: T }>) => new Map(list.filter((x) => !x.deleted).map((x) => [x.id, x.doc]));
  const [tasks, assignments, threads, recs, quotes] = await Promise.all([
    getDocRows<TaskRecord>("tasks", idsOf("task")),
    getDocRows<Assignment>("assignments", idsOf("assignment")),
    getDocRows<CommThread>("comms", idsOf("email")),
    getDocRows<RecordingRecord>("recordings", idsOf("call")),
    getDocRows<Quote>("quotes", idsOf("quote")),
  ]);
  const recordings = new Map([...liveMap(recs)].map(([id, d]) => [id, normalizeRecording(d)]));
  return closedKeys(rows, { tasks: liveMap(tasks), assignments: liveMap(assignments), threads: liveMap(threads), recordings, quotes: liveMap(quotes) }, me, now);
}
