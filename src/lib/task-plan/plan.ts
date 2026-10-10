/**
 * planPerson — one person's task plan (spec Part 2). Pure, deterministic,
 * no IO, client-safe: same input → same plan. Highest urgency first, each
 * into the earliest free time at or after max(its earliest start, the
 * current quarter-hour); 15-minute grid; chunks ≥ 30 min; at most 80 % of a
 * day's free time. Work that can't finish by its due date is still placed —
 * late — and flagged At risk.
 *
 * The plan starts at the CURRENT quarter-hour (now rounded down), not the
 * next one: that is what lets "a block that has already begun" exist at
 * compute time and be pinned as started (Task 5).
 */
import { deadlineOf, effectiveDue } from "./due";
import { ceilQuarter, chunkFor, floorQuarter, freeDays, type FreeDay } from "./free";
import { atRiskLabel } from "./labels";
import { sortByUrgency } from "./urgency";
import {
  FILL_RATIO,
  GRID_MIN,
  PLAN_HORIZON_DAYS,
  type AtRiskItem,
  type BusyInterval,
  type PinKind,
  type PlanBlock,
  type PlanInput,
  type PlanItem,
  type PlanResult,
} from "./types";

const MIN_MS = 60_000;

export type QueueEntry = { item: PlanItem; minutes: number; earliestMs: number };

const toGrid = (min: number): number => Math.ceil(Math.max(0, min) / GRID_MIN) * GRID_MIN;

/** The urgency comparator takes dated items only (a dueMs of 0 would sort as
 *  maximally overdue), so an item without a usable due plans by its effective
 *  due — 7 days after it was created — exactly as `effectiveDue` defines it. */
function dated(item: PlanItem): PlanItem {
  if (Number.isFinite(item.dueMs) && item.dueMs > 0) return item;
  return { ...item, dueMs: effectiveDue(null, item.createdAt).dueMs, dueVirtual: true };
}

export function blockOf(item: PlanItem, s: BusyInterval, pinned: PinKind | null): PlanBlock {
  return {
    key: `${item.key}@${s.startMs}`,
    itemKey: item.key,
    kind: item.kind,
    id: item.id,
    userId: item.userId,
    title: item.title,
    href: item.href,
    tier: item.tier,
    size: item.size,
    startMs: s.startMs,
    endMs: s.endMs,
    pinned,
    atRisk: false,
    dueMs: item.dueMs,
    inProgress: item.inProgress,
  };
}

/** Earliest free time at/after the entry's start; consumes `days`. */
export function placeEntry(e: QueueEntry, days: FreeDay[]): { slots: BusyInterval[]; remaining: number } {
  let remaining = e.minutes;
  const slots: BusyInterval[] = [];
  const from = ceilQuarter(e.earliestMs);
  for (const d of days) {
    if (remaining <= 0) break;
    for (let gi = 0; gi < d.free.length && remaining > 0 && d.capMin > 0; gi++) {
      const g = d.free[gi];
      if (g.endMs <= from) continue;
      const s = Math.max(g.startMs, from);
      const c = chunkFor(remaining, Math.min((g.endMs - s) / MIN_MS, d.capMin));
      if (c <= 0) continue;
      const end = s + c * MIN_MS;
      slots.push({ startMs: s, endMs: end });
      const parts: BusyInterval[] = [];
      if (s > g.startMs) parts.push({ startMs: g.startMs, endMs: s });
      if (end < g.endMs) parts.push({ startMs: end, endMs: g.endMs });
      d.free.splice(gi, 1, ...parts);
      // next pass looks at what's left after this chunk (the loop's gi++ lands on it)
      gi += (s > g.startMs ? 1 : 0) - 1;
      d.capMin -= c;
      remaining -= c;
    }
  }
  return { slots, remaining };
}

export function planPerson(input: PlanInput): PlanResult {
  const now = input.nowMs;
  const start = floorQuarter(now);
  const ordered = sortByUrgency(input.items.map(dated), now);
  const byKey = new Map(ordered.map((i) => [i.key, i] as const));
  const pins = input.pins
    .filter((p) => byKey.has(p.itemKey) && p.endMs > p.startMs)
    .sort((a, b) => a.startMs - b.startMs || (a.itemKey < b.itemKey ? -1 : a.itemKey > b.itemKey ? 1 : 0));
  const days = freeDays({
    startMs: start,
    days: input.horizonDays ?? PLAN_HORIZON_DAYS,
    hours: input.hours,
    busy: [...input.busy, ...pins],
    fillRatio: input.fillRatio ?? FILL_RATIO,
  });

  const blocks: PlanBlock[] = pins.map((p) => blockOf(byKey.get(p.itemKey)!, p, p.kind));
  const pinnedMin = new Map<string, number>();
  for (const p of pins) pinnedMin.set(p.itemKey, (pinnedMin.get(p.itemKey) ?? 0) + (p.endMs - p.startMs) / MIN_MS);

  // QUEUE
  const queue: QueueEntry[] = [];
  for (const item of ordered) {
    const minutes = toGrid(item.sizeMin - (pinnedMin.get(item.key) ?? 0));
    if (minutes > 0) queue.push({ item, minutes, earliestMs: Math.max(start, item.earliestMs ?? start) });
  }
  // END QUEUE

  const unplaced = new Set<string>();
  for (const e of queue) {
    const { slots, remaining } = placeEntry(e, days);
    for (const s of slots) blocks.push(blockOf(e.item, s, null));
    if (remaining > 0) unplaced.add(e.item.key);
  }
  blocks.sort((a, b) => a.startMs - b.startMs || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));

  const finishMs: Record<string, number | null> = {};
  for (const item of ordered) finishMs[item.key] = null;
  for (const b of blocks) finishMs[b.itemKey] = Math.max(finishMs[b.itemKey] ?? 0, b.endMs);
  const atRisk: AtRiskItem[] = [];
  for (const item of ordered) {
    if (unplaced.has(item.key)) finishMs[item.key] = null;
    const f = finishMs[item.key];
    if (!unplaced.has(item.key) && (f == null || f <= deadlineOf(item.dueMs))) continue; // f null here = nothing to place
    atRisk.push({ itemKey: item.key, kind: item.kind, id: item.id, userId: item.userId, title: item.title, href: item.href, dueMs: item.dueMs, finishMs: f, label: atRiskLabel(item.dueMs, now) });
  }
  const risky = new Set(atRisk.map((a) => a.itemKey));
  for (const b of blocks) b.atRisk = risky.has(b.itemKey);

  return {
    userId: input.userId,
    nowMs: now,
    blocks,
    atRisk,
    newPins: [],
    staleKeys: [],
    futurePins: pins.filter((p) => p.startMs > now),
    finishMs,
  };
}
