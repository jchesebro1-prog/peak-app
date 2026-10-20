/**
 * #350 review — one per-request load of what makes a frozen triage list live:
 * my marks, the closed keys (liveness) and my mailbox viewer. Home renders
 * the AI brief card and Start here in the same request over the same
 * snapshot, so React `cache()` (Next's documented way to dedupe ORM / DB
 * reads within one server render — node_modules/next/dist/docs/01-app/02-guides/
 * caching-without-cache-components.md) shares one load between them. Outside
 * a server render (crons, actions, the test harness) `cache()` is a plain
 * pass-through.
 *
 * The cache key is primitives only: the user, the row keys (the closed-key
 * check reads only `key`), and the minute — so both cards hit the same entry
 * for the same snapshot, and a different list never reuses another's result.
 *
 * Fail closed: a failed liveness check (or viewer read) drops every row it
 * could have hidden (`failClosedKeys`) instead of treating nothing as closed.
 * A failed marks read still shows the rows (marks only hide).
 */
import { cache } from "react";
import { mailboxViewer } from "@/lib/mailbox-viewer";
import type { MailboxViewer } from "@/lib/stores/comms";
import { failClosedKeys, loadClosedKeys } from "./liveness";
import { marksFor } from "./store";
import type { SnapshotRow, TriageMark, TriageUser } from "./types";

export type LiveState = {
  marks: TriageMark[];
  closed: Set<string>;
  /** null when the viewer read failed. */
  viewer: MailboxViewer | null;
  /** The liveness check failed — `closed` is the fail-closed set. */
  livenessFailed: boolean;
};

export type LiveStateDeps = {
  marks?: (userId: string) => Promise<TriageMark[]>;
  closedKeys?: (rows: readonly SnapshotRow[], me: TriageUser, now: number, viewer: MailboxViewer) => Promise<Set<string>>;
  viewer?: (me: { id: string; name: string }) => Promise<MailboxViewer>;
};

async function compute(rows: readonly SnapshotRow[], me: TriageUser, now: number, deps: LiveStateDeps): Promise<LiveState> {
  const [marks, viewer] = await Promise.all([
    (deps.marks ?? marksFor)(me.id).catch((err) => {
      console.error("[triage] marks load failed", err);
      return [] as TriageMark[];
    }),
    (deps.viewer ?? mailboxViewer)({ id: me.id, name: me.name }).catch((err) => {
      console.error("[triage] viewer load failed", err);
      return null;
    }),
  ]);
  let closed: Set<string>;
  let livenessFailed = false;
  try {
    if (!viewer) throw new Error("no viewer");
    closed = await (deps.closedKeys ?? loadClosedKeys)(rows, me, now, viewer);
  } catch (err) {
    console.error("[triage] liveness check failed — dropping the rows it could hide", err);
    closed = failClosedKeys(rows);
    livenessFailed = true;
  }
  return { marks, closed, viewer, livenessFailed };
}

const cachedCompute = cache(async (userId: string, userName: string, canApprove: boolean, keysJson: string, minute: number): Promise<LiveState> => {
  const rows = (JSON.parse(keysJson) as string[]).map((key) => ({ key }) as SnapshotRow);
  return compute(rows, { id: userId, name: userName, canApprove }, minute * 60_000, {});
});

/** The live state for `rows` (only their keys matter). `deps` (test seams) bypass the cache. */
export function loadLiveState(rows: readonly Pick<SnapshotRow, "key">[], me: TriageUser, now: number, deps?: LiveStateDeps): Promise<LiveState> {
  const keys = rows.map((r) => r?.key).filter((k): k is string => typeof k === "string");
  if (deps) return compute(keys.map((key) => ({ key }) as SnapshotRow), me, now, deps);
  return cachedCompute(me.id, me.name, me.canApprove, JSON.stringify(keys), Math.floor(now / 60_000));
}
