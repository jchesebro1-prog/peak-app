/**
 * The task plan as /calendar draws it (spec Part 3 "Calendar", "At risk").
 * Pure and CLIENT-SAFE (type-only store imports). Day keys for drawing are
 * the browser's local day (calendar-client's convention for timed items);
 * the plan itself is computed in Chicago days.
 */
import { dayKeyDiff, localDayKey, placeTasks, type CalendarTaskItem, type PlacedTask } from "@/lib/calendar-tasks";
import { chicagoDayKey } from "@/lib/drive-plan/day";
import { finishText } from "./labels";
import { parsePlanItemKey, planItemKey, type PinKind, type PlanItemKind, type PlanResult, type TaskSize, type TaskTier } from "./types";

export type PlanForView = { userId: string; name: string; note: string | null; result: PlanResult };

export type CalendarPlanBlock = {
  key: string;
  itemKey: string;
  kind: PlanItemKind;
  id: string;
  title: string;
  href: string;
  startMs: number;
  endMs: number;
  pinned: PinKind | null;
  canUnpin: boolean;
  draggable: boolean;
  atRiskLabel: string | null;
  userId: string;
  ownerName: string;
  initials: string;
  tier: TaskTier;
  size: TaskSize;
  inProgress: boolean;
};

export type CalendarAtRisk = {
  itemKey: string;
  kind: PlanItemKind;
  id: string;
  title: string;
  href: string;
  userId: string;
  ownerName: string;
  label: string;
  finishDayKey: string | null;
  finishText: string;
};

export type CalendarFuturePin = { userId: string; itemKey: string; kind: PlanItemKind; id: string; title: string; startMs: number; endMs: number; pinKind: PinKind };

export type CalendarPlanView = { blocks: CalendarPlanBlock[]; atRisk: CalendarAtRisk[]; futurePins: CalendarFuturePin[]; notes: string[]; plannedKeys: string[] };

export const EMPTY_PLAN_VIEW: CalendarPlanView = { blocks: [], atRisk: [], futurePins: [], notes: [], plannedKeys: [] };

/** Shown when the plan couldn't be loaded at all; the old due-day chips stay. */
export const PLAN_FAILED_NOTE = "Couldn't load the task plan right now — tasks show on their due days. Refresh to try again.";

/**
 * `viewer` (the signed-in user): pin controls (Unpin, drag) are only for the
 * plan's owner or an admin — the server refuses anyone else too. Left out,
 * every viewer is treated as allowed (pure-logic callers/tests).
 */
export function calendarPlanView(
  plans: readonly PlanForView[],
  opts: { minMs: number; maxMs: number; initials: (userId: string, name: string) => string; viewer?: { id: string; admin: boolean } }
): CalendarPlanView {
  const view: CalendarPlanView = { blocks: [], atRisk: [], futurePins: [], notes: [], plannedKeys: [] };
  const planned = new Set<string>();
  for (const p of plans) {
    const now = p.result.nowMs;
    if (p.note && !view.notes.includes(p.note)) view.notes.push(p.note);
    const mayPin = !opts.viewer || opts.viewer.admin || opts.viewer.id === p.userId;
    const riskLabel = new Map(p.result.atRisk.map((a) => [a.itemKey, a.label] as const));
    const titleOf = new Map(p.result.blocks.map((b) => [b.itemKey, b.title] as const));
    const initials = opts.initials(p.userId, p.name);
    for (const b of p.result.blocks) {
      planned.add(b.itemKey);
      if (b.endMs < opts.minMs || b.startMs > opts.maxMs) continue;
      // A pin that has begun, or is an in-progress remainder ("started"), stays put (the server refuses both).
      const canUnpin = mayPin && b.pinned === "hand" && b.startMs > now;
      view.blocks.push({
        key: b.key, itemKey: b.itemKey, kind: b.kind, id: b.id, title: b.title, href: b.href,
        startMs: b.startMs, endMs: b.endMs, pinned: b.pinned, canUnpin, draggable: mayPin && (!b.pinned || canUnpin),
        atRiskLabel: b.atRisk ? (riskLabel.get(b.itemKey) ?? null) : null,
        userId: p.userId, ownerName: p.name, initials, tier: b.tier, size: b.size, inProgress: b.inProgress,
      });
    }
    for (const a of p.result.atRisk) {
      view.atRisk.push({
        itemKey: a.itemKey, kind: a.kind, id: a.id, title: a.title, href: a.href, userId: p.userId, ownerName: p.name, label: a.label,
        finishDayKey: a.finishMs == null ? null : chicagoDayKey(a.finishMs - 1), finishText: finishText(a.finishMs),
      });
    }
    for (const f of p.result.futurePins) {
      const ref = parsePlanItemKey(f.itemKey);
      if (ref) view.futurePins.push({ userId: p.userId, itemKey: f.itemKey, kind: ref.kind, id: ref.id, title: titleOf.get(f.itemKey) ?? ref.id, startMs: f.startMs, endMs: f.endMs, pinKind: f.kind });
    }
  }
  view.blocks.sort((a, b) => a.startMs - b.startMs || (a.key < b.key ? -1 : 1));
  view.futurePins.sort((a, b) => a.startMs - b.startMs || (a.itemKey < b.itemKey ? -1 : 1));
  view.plannedKeys = [...planned].sort();
  return view;
}

/** Month view: one chip per (item, day it is planned on); items with no
 *  plan (blocked, or not placed) keep the #215 due-day/carried chip. */
export function monthChips(
  tasks: readonly CalendarTaskItem[],
  view: Pick<CalendarPlanView, "blocks" | "plannedKeys">,
  opts: { today: string; rangeStart: string; rangeEnd: string }
): PlacedTask[] {
  const planned = new Set(view.plannedKeys);
  const byKey = new Map(tasks.map((t) => [planItemKey(t.kind, t.id), t] as const));
  const out: PlacedTask[] = [];
  const seen = new Set<string>();
  for (const b of view.blocks) {
    const item = byKey.get(b.itemKey);
    if (!item) continue;
    const day = localDayKey(b.startMs);
    if (day < opts.rangeStart || day > opts.rangeEnd || seen.has(b.itemKey + "|" + day)) continue;
    seen.add(b.itemKey + "|" + day);
    const dueKey = item.dueAt ? localDayKey(item.dueAt) : null;
    out.push({ dayKey: day, item, carried: false, overdueDays: dueKey && dueKey < day ? dayKeyDiff(dueKey, day) : 0 });
  }
  const rest = placeTasks(tasks.filter((t) => !planned.has(planItemKey(t.kind, t.id))), opts);
  return [...out, ...rest].sort(
    (a, b) => a.dayKey.localeCompare(b.dayKey) || b.overdueDays - a.overdueDays || a.item.title.localeCompare(b.item.title) || a.item.id.localeCompare(b.item.id)
  );
}

/** Week/Day task strip: only items the plan didn't place. */
export function stripTasks(tasks: readonly CalendarTaskItem[], view: Pick<CalendarPlanView, "plannedKeys">): CalendarTaskItem[] {
  const planned = new Set(view.plannedKeys);
  return tasks.filter((t) => !planned.has(planItemKey(t.kind, t.id)));
}

/** Greedy side-by-side columns for overlapping blocks (Everyone view). */
export function layoutIntervals<T extends { startMs: number; endMs: number }>(items: readonly T[]): Array<{ it: T; col: number; cols: number }> {
  const sorted = [...items].sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs);
  const out: Array<{ it: T; col: number; cols: number }> = [];
  let i = 0;
  while (i < sorted.length) {
    let end = sorted[i].endMs;
    let j = i + 1;
    while (j < sorted.length && sorted[j].startMs < end) {
      end = Math.max(end, sorted[j].endMs);
      j++;
    }
    const active: Array<{ endMs: number; col: number }> = [];
    const cluster: Array<{ it: T; col: number }> = [];
    let cols = 0;
    for (const it of sorted.slice(i, j)) {
      for (let a = active.length - 1; a >= 0; a--) if (active[a].endMs <= it.startMs) active.splice(a, 1);
      const used = new Set(active.map((a) => a.col));
      let col = 0;
      while (used.has(col)) col++;
      active.push({ endMs: it.endMs, col });
      cluster.push({ it, col });
      cols = Math.max(cols, col + 1);
    }
    for (const c of cluster) out.push({ it: c.it, col: c.col, cols });
    i = j;
  }
  return out;
}

/** Where a dragged block lands: 15-minute steps vertically, whole days
 *  sideways (Week view only), in the browser's local time like the grid. */
export function dragStartMs(args: { startMs: number; dyPx: number; dxPx: number; hourPx: number; colPx: number; dayCount: number }): number {
  const minutes = args.hourPx > 0 ? Math.round(((args.dyPx / args.hourPx) * 60) / 15) * 15 : 0;
  const days = args.dayCount > 1 && args.colPx > 0 ? Math.round(args.dxPx / args.colPx) : 0;
  const d = new Date(args.startMs);
  d.setDate(d.getDate() + days);
  return d.getTime() + minutes * 60_000;
}
