import { activeUsers, userCan } from "@/lib/users";
import { can } from "@/lib/team";
import { buildRows } from "./build";
import { dayKey, slotAt, snapshotId } from "./clock";
import { FEEDS } from "./feeds";
import type { FeedCtx, FeedData, TriageFeed } from "./feeds/context";
import { createFeedData } from "./feeds/data";
import { TRIAGE_HOOKS, type TriageHooks } from "./hooks";
import { loadClosedKeys } from "./liveness";
import { getSnapshot, insertSnapshotIfAbsent, marksFor } from "./store";
import type { SnapshotRow, Slot, TriageSnapshot, TriageUser } from "./types";
import { visibleRows } from "./view";

/**
 * The triage list's server entry points (spec "Snapshots and refresh",
 * "Failures"): the cron builds every active user's slot; the first view of a
 * slot with no snapshot builds it lazily; if that can't be saved, the list is
 * computed live with a note. Rendering applies liveness + marks to the
 * frozen rows.
 */
export const LIVE_NOTE = "Showing a live list — today's saved list couldn't be built.";

/** One clock read outside component render (the queueNow() precedent). */
export function triageNow(): number {
  return Date.now();
}

export function triageUserFromSession(u: { id: string; name: string; roles: string[] }): TriageUser {
  return { id: u.id, name: u.name, canApprove: can("approve", u.roles) };
}

type Roster = readonly { id: string; name: string }[];

async function rosterNow(): Promise<Roster> {
  return (await activeUsers()).map((u) => ({ id: u.id, name: u.name }));
}

export async function computeSnapshot(
  me: TriageUser,
  at: { day: string; slot: Slot },
  now: number,
  builtBy: TriageSnapshot["builtBy"],
  opts: { feeds?: readonly TriageFeed[]; users?: Roster; data?: FeedData; planUsers?: Roster; deadlineMs?: number; hooks?: TriageHooks } = {}
): Promise<TriageSnapshot> {
  // No shared loader (the lazy / live single-user path) → this snapshot gets its own.
  const ctx: FeedCtx = {
    me,
    now,
    users: opts.users ?? (await rosterNow()),
    hooks: opts.hooks ?? TRIAGE_HOOKS,
    data: opts.data ?? createFeedData(),
    planUsers: opts.planUsers,
    deadlineMs: opts.deadlineMs,
  };
  const { rows, errors } = await buildRows(ctx, opts.feeds ?? FEEDS);
  return { id: snapshotId(me.id, at.day, at.slot), userId: me.id, userName: me.name, day: at.day, slot: at.slot, builtAt: now, builtBy, rows, errors };
}

/**
 * Cron: build `slot` for today (Chicago) for every active user — or `opts.users`.
 * One user failing never stops the rest. Every user shares one memoized
 * loader, so each collection is scanned once for the whole run (the at-risk
 * planner included: it plans every user once, on the first user's tasks feed,
 * its Google reads bounded by the deadline). A user whose
 * slot already has a snapshot (someone's lazy view got there first) is kept
 * as is — the cron never reorders a list a person may already be working
 * (D709). Once `Date.now() >= opts.deadlineMs` it stops before starting the
 * next user: those ids come back in `skipped` and build lazily on first view.
 */
export async function buildSlotForAll(
  slot: Slot,
  now: number,
  opts: { users?: TriageUser[]; feeds?: readonly TriageFeed[]; deadlineMs?: number; data?: FeedData; hooks?: TriageHooks } = {}
): Promise<{ built: number; kept: number; failed: string[]; skipped: string[] }> {
  const day = dayKey(now);
  const rows = await activeUsers();
  const users = opts.users ?? rows.map((u) => ({ id: u.id, name: u.name, canApprove: userCan(u, "approve") }));
  const roster: Roster = rows.map((u) => ({ id: u.id, name: u.name }));
  const data = opts.data ?? createFeedData();
  let built = 0;
  let kept = 0;
  const failed: string[] = [];
  const skipped: string[] = [];
  for (const u of users) {
    if (opts.deadlineMs !== undefined && Date.now() >= opts.deadlineMs) {
      skipped.push(u.id);
      continue;
    }
    try {
      if (await getSnapshot(snapshotId(u.id, day, slot))) {
        kept++;
        continue;
      }
      const snap = await computeSnapshot(u, { day, slot }, now, "cron", {
        feeds: opts.feeds,
        users: roster,
        data,
        // The at-risk planner plans every user of the build once, bounded by the deadline.
        planUsers: users,
        deadlineMs: opts.deadlineMs,
        hooks: opts.hooks,
      });
      // Insert-if-absent: a lazy view that landed during the compute wins.
      if (await insertSnapshotIfAbsent(snap)) built++;
      else kept++;
    } catch (err) {
      console.error(`[triage] ${slot} build failed for ${u.name}`, err);
      failed.push(u.name);
    }
  }
  return { built, kept, failed, skipped };
}

export type TriageView = { snapshot: TriageSnapshot; rows: SnapshotRow[]; note: string | null };

export async function loadTriageView(
  me: TriageUser,
  now: number,
  opts: {
    feeds?: readonly TriageFeed[];
    /** Insert-if-absent writer for the lazy build (test seam). */
    save?: (s: TriageSnapshot) => Promise<unknown>;
    /** Snapshot reader (test seam). */
    read?: (id: string) => Promise<TriageSnapshot | null>;
  } = {}
): Promise<TriageView> {
  const { day, slot } = slotAt(now);
  const id = snapshotId(me.id, day, slot);
  const read = opts.read ?? getSnapshot;
  const live = async (): Promise<TriageSnapshot> => ({ ...(await computeSnapshot(me, { day, slot }, now, "lazy", { feeds: opts.feeds })), builtBy: "live" });
  let snapshot: TriageSnapshot | null = null;
  let note: string | null = null;
  let readFailed = false;
  try {
    snapshot = await read(id);
  } catch (err) {
    // A failed READ is not a miss: never rebuild-and-save over a possibly good snapshot.
    console.error("[triage] snapshot read failed", err);
    readFailed = true;
  }
  if (readFailed) {
    snapshot = await live();
    note = LIVE_NOTE;
  } else if (!snapshot) {
    const built = await computeSnapshot(me, { day, slot }, now, "lazy", { feeds: opts.feeds });
    try {
      // Insert only if absent, then use whatever is stored: concurrent first
      // views converge and a lazy build never clobbers a cron snapshot.
      await (opts.save ?? insertSnapshotIfAbsent)(built);
      try {
        snapshot = (await read(id)) ?? built;
      } catch (err) {
        console.error("[triage] snapshot re-read failed", err);
        snapshot = built;
      }
    } catch (err) {
      console.error("[triage] lazy snapshot save failed", err);
      snapshot = { ...built, builtBy: "live" };
      note = LIVE_NOTE;
    }
  }
  const rows = snapshot.rows;
  const [marks, closed] = await Promise.all([
    marksFor(me.id).catch((err) => {
      console.error("[triage] marks load failed", err);
      return [];
    }),
    loadClosedKeys(rows, me, now).catch((err) => {
      console.error("[triage] liveness check failed", err);
      return new Set<string>();
    }),
  ]);
  return { snapshot, rows: visibleRows(rows, marks, closed, { snapshotId: id, day, slot }), note };
}
