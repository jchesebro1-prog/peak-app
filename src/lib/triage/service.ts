import { activeUsers, userCan } from "@/lib/users";
import { can } from "@/lib/team";
import { buildRows } from "./build";
import { dayKey, slotAt, snapshotId } from "./clock";
import { FEEDS } from "./feeds";
import type { FeedCtx, TriageFeed } from "./feeds/context";
import { TRIAGE_HOOKS } from "./hooks";
import { loadClosedKeys } from "./liveness";
import { getSnapshot, marksFor, saveSnapshot } from "./store";
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
  opts: { feeds?: readonly TriageFeed[]; users?: Roster } = {}
): Promise<TriageSnapshot> {
  const ctx: FeedCtx = { me, now, users: opts.users ?? (await rosterNow()), hooks: TRIAGE_HOOKS };
  const { rows, errors } = await buildRows(ctx, opts.feeds ?? FEEDS);
  return { id: snapshotId(me.id, at.day, at.slot), userId: me.id, userName: me.name, day: at.day, slot: at.slot, builtAt: now, builtBy, rows, errors };
}

/** Cron: (re)build `slot` for today (Chicago) for every active user — or `opts.users`. One user failing never stops the rest. */
export async function buildSlotForAll(
  slot: Slot,
  now: number,
  opts: { users?: TriageUser[]; feeds?: readonly TriageFeed[] } = {}
): Promise<{ built: number; failed: string[] }> {
  const day = dayKey(now);
  const rows = await activeUsers();
  const users = opts.users ?? rows.map((u) => ({ id: u.id, name: u.name, canApprove: userCan(u, "approve") }));
  const roster: Roster = rows.map((u) => ({ id: u.id, name: u.name }));
  let built = 0;
  const failed: string[] = [];
  for (const u of users) {
    try {
      await saveSnapshot(await computeSnapshot(u, { day, slot }, now, "cron", { feeds: opts.feeds, users: roster }));
      built++;
    } catch (err) {
      console.error(`[triage] ${slot} build failed for ${u.name}`, err);
      failed.push(u.name);
    }
  }
  return { built, failed };
}

export type TriageView = { snapshot: TriageSnapshot; rows: SnapshotRow[]; note: string | null };

export async function loadTriageView(
  me: TriageUser,
  now: number,
  opts: { feeds?: readonly TriageFeed[]; save?: (s: TriageSnapshot) => Promise<void> } = {}
): Promise<TriageView> {
  const { day, slot } = slotAt(now);
  const id = snapshotId(me.id, day, slot);
  let snapshot = await getSnapshot(id).catch(() => null);
  let note: string | null = null;
  if (!snapshot) {
    snapshot = await computeSnapshot(me, { day, slot }, now, "lazy", { feeds: opts.feeds });
    try {
      await (opts.save ?? saveSnapshot)(snapshot);
    } catch (err) {
      console.error("[triage] lazy snapshot save failed", err);
      snapshot = { ...snapshot, builtBy: "live" };
      note = LIVE_NOTE;
    }
  }
  const [marks, closed] = await Promise.all([
    marksFor(me.id).catch(() => []),
    loadClosedKeys(snapshot.rows, me, now).catch(() => new Set<string>()),
  ]);
  return { snapshot, rows: visibleRows(snapshot.rows, marks, closed, { snapshotId: id, day, slot }), note };
}
