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
import { chicagoDayKey } from "@/lib/drive-plan/day";
import { deadlineOf, effectiveDue } from "./due";
import { ceilQuarter, chunkFor, floorQuarter, freeDays, type FreeDay } from "./free";
import { atRiskLabel } from "./labels";
import { newPinsFrom, pinBlobKey, stalePinKeys, unfinishedRemainders } from "./pins";
import { sortByUrgency } from "./urgency";
import {
  FILL_RATIO,
  GRID_MIN,
  MIN_CHUNK_MIN,
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
/** What's left to place: on the grid, and never a piece under 30 min (a 1–29
 *  min leftover — e.g. a size cut below a partial pin — places as 30). */
const placeable = (min: number): number => (min > 0 ? Math.max(MIN_CHUNK_MIN, toGrid(min)) : 0);
/** horizonDays is capped at 8 weeks (spec "Horizon"). */
const horizonOf = (days: number | undefined): number => {
  const d = Math.floor(Number(days ?? PLAN_HORIZON_DAYS));
  return Number.isFinite(d) ? Math.max(0, Math.min(PLAN_HORIZON_DAYS, d)) : PLAN_HORIZON_DAYS;
};

/** The urgency comparator takes dated items only (a dueMs of 0 would sort as
 *  maximally overdue), so an undated item (no stored due, or `dueVirtual`)
 *  plans by its ROLLING effective due — today + 7 days (D801), exactly as
 *  `effectiveDue` defines it — and is never At risk until it gets a real date. */
function dated(item: PlanItem, nowMs: number): PlanItem {
  if (!item.dueVirtual && Number.isFinite(item.dueMs) && item.dueMs > 0) return item;
  return { ...item, dueMs: effectiveDue(null, nowMs).dueMs, dueVirtual: true };
}

/** D796: an item whose PAST pins already cover its size, with nothing current
 *  or ahead, is still open after its whole size. It is never pinned ahead
 *  again; it plans like unstarted work — one fresh, movable 30-minute chunk
 *  (or its size if smaller), urgency-ordered — at most once a day: once a
 *  chunk has begun today (and so locked as `started` on the owner's view),
 *  nothing more is placed until tomorrow. null = not in that state. */
function freshChunkMin(item: PlanItem, pins: readonly BusyInterval[], nowMs: number): number | null {
  if (!pins.length || pins.some((p) => p.endMs > nowMs)) return null;
  if (pins.reduce((s, p) => s + (p.endMs - p.startMs) / MIN_MS, 0) < item.sizeMin) return null;
  const today = chicagoDayKey(nowMs);
  return pins.some((p) => chicagoDayKey(p.startMs) === today) ? 0 : Math.min(MIN_CHUNK_MIN, placeable(item.sizeMin));
}

export function blockOf(item: PlanItem, s: BusyInterval, pinned: PinKind | null): PlanBlock {
  return {
    key: pinBlobKey({ itemKey: item.key, startMs: s.startMs }),
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
  const ordered = sortByUrgency(input.items.map((i) => dated(i, now)), now);
  const released = new Set(input.released ?? []);
  const byKey = new Map(ordered.map((i) => [i.key, i] as const));
  const pins = input.pins
    .filter((p) => byKey.has(p.itemKey) && p.endMs > p.startMs)
    .sort((a, b) => a.startMs - b.startMs || (a.itemKey < b.itemKey ? -1 : a.itemKey > b.itemKey ? 1 : 0));
  const days = freeDays({
    startMs: start,
    days: horizonOf(input.horizonDays),
    hours: input.hours,
    busy: [...input.busy, ...pins],
    fillRatio: input.fillRatio ?? FILL_RATIO,
  });

  const blocks: PlanBlock[] = pins.map((p) => blockOf(byKey.get(p.itemKey)!, p, p.kind));
  const pinnedMin = new Map<string, number>();
  const pinsOf = new Map<string, BusyInterval[]>();
  for (const p of pins) {
    pinnedMin.set(p.itemKey, (pinnedMin.get(p.itemKey) ?? 0) + (p.endMs - p.startMs) / MIN_MS);
    pinsOf.set(p.itemKey, [...(pinsOf.get(p.itemKey) ?? []), p]);
  }

  // Unfinished started work goes first and is pinned where it lands (spec "Unfinished").
  // Only while its pins so far are short of its size (D796); a released item never (D798).
  const remainders = unfinishedRemainders({ items: ordered, pins, nowMs: now, hours: input.hours, released });
  const remainderKeys = new Set(remainders.map((r) => r.item.key));
  const queue: QueueEntry[] = remainders.map((r) => ({ item: r.item, minutes: r.minutes, earliestMs: Math.max(start, r.earliestMs) }));
  for (const item of ordered) {
    if (remainderKeys.has(item.key)) continue;
    // Still open after its whole size: a fresh movable chunk, once a day (D796).
    const minutes = freshChunkMin(item, pinsOf.get(item.key) ?? [], now) ?? placeable(item.sizeMin - (pinnedMin.get(item.key) ?? 0));
    if (minutes > 0) queue.push({ item, minutes, earliestMs: Math.max(start, item.earliestMs ?? start) });
  }

  const unplaced = new Set<string>();
  for (const e of queue) {
    const { slots, remaining } = placeEntry(e, days);
    for (const s of slots) blocks.push(blockOf(e.item, s, null));
    if (remaining > 0) unplaced.add(e.item.key);
  }
  blocks.sort((a, b) => a.startMs - b.startMs || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));

  // finishMs: a key only for items with work on the plan (null = doesn't fit
  // in the horizon); an item with nothing left to place has no key at all.
  const finishMs: Record<string, number | null> = {};
  for (const b of blocks) finishMs[b.itemKey] = Math.max(finishMs[b.itemKey] ?? 0, b.endMs);
  for (const k of unplaced) finishMs[k] = null;
  const atRisk: AtRiskItem[] = [];
  for (const item of ordered) {
    if (item.dueVirtual) continue; // undated: never At risk until it gets a real date (D801)
    const f = finishMs[item.key];
    if (!unplaced.has(item.key) && (f == null || f <= deadlineOf(item.dueMs))) continue; // no key here = nothing to place
    atRisk.push({ itemKey: item.key, kind: item.kind, id: item.id, userId: item.userId, title: item.title, href: item.href, dueMs: item.dueMs, finishMs: f ?? null, label: atRiskLabel(item.dueMs, now) });
  }
  const risky = new Set(atRisk.map((a) => a.itemKey));
  for (const b of blocks) b.atRisk = risky.has(b.itemKey);

  const newPins = newPinsFrom({ blocks, items: ordered, pins, nowMs: now, remainderKeys, released });
  const fresh = new Set(newPins.map(pinBlobKey));
  for (const b of blocks) if (!b.pinned && fresh.has(b.key)) b.pinned = "started";

  return {
    userId: input.userId,
    nowMs: now,
    blocks,
    atRisk,
    newPins,
    staleKeys: stalePinKeys(input.pins, new Set(byKey.keys()), input.released),
    // pins that haven't begun, this compute's new ones included (what Unpin can offer)
    futurePins: [...pins, ...newPins]
      .filter((p) => p.startMs > now)
      .sort((a, b) => a.startMs - b.startMs || (a.itemKey < b.itemKey ? -1 : a.itemKey > b.itemKey ? 1 : 0)),
    finishMs,
  };
}
