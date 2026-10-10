/**
 * Pins (spec Part 2 "Pins — only unstarted work moves"). Pure, client-safe.
 * Storage shape (src/lib/stores/task-pins.ts): blob `task_pins:<userId>`,
 * one top-level key per pin `<itemKey>@<startMs>` → { endMs, kind }.
 */
import { addDays, chicagoDayKey } from "@/lib/drive-plan/day";
import { workWindow } from "@/lib/visit-plan/hours";
import type { WorkHours } from "@/lib/visit-plan/settings";
import { floorQuarter } from "./free";
import {
  GRID_MIN,
  MIN_CHUNK_MIN,
  PLAN_HORIZON_DAYS,
  QUARTER_MS,
  parsePlanItemKey,
  parsePlanRef,
  type PinKind,
  type PlanBlock,
  type PlanItem,
  type PlanItemKind,
  type PlanPin,
} from "./types";

export const PIN_MAX_MIN = 8 * 60;
export const PIN_MAX_PER_PERSON = 500;
const DAY_MS = 86_400_000;

export function pinBlobKey(p: { itemKey: string; startMs: number }): string {
  return `${p.itemKey}@${p.startMs}`;
}
export function pinBlobValue(p: PlanPin): { endMs: number; kind: PinKind } {
  return { endMs: p.endMs, kind: p.kind };
}

export function pinsFromBlob(raw: Record<string, unknown>): PlanPin[] {
  const out: PlanPin[] = [];
  for (const [k, v] of Object.entries(raw || {})) {
    const at = k.lastIndexOf("@");
    if (at <= 0) continue;
    const itemKey = k.slice(0, at);
    const startMs = Number(k.slice(at + 1));
    if (!parsePlanItemKey(itemKey) || !Number.isInteger(startMs)) continue;
    const o = v && typeof v === "object" ? (v as Record<string, unknown>) : null;
    const endMs = o && typeof o.endMs === "number" ? o.endMs : NaN;
    const kind = o?.kind === "started" || o?.kind === "hand" ? o.kind : null;
    if (!kind || !Number.isFinite(endMs) || endMs <= startMs || endMs - startMs > DAY_MS) continue;
    out.push({ itemKey, startMs, endMs, kind });
  }
  return out.sort((a, b) => a.startMs - b.startMs || (a.itemKey < b.itemKey ? -1 : a.itemKey > b.itemKey ? 1 : 0));
}

/** Spec "Unfinished" (bounded, D796): an open item whose pins all ended on a
 *  day before today, and whose pins so far are still SHORT of its size, gets
 *  the rest (size − pinned so far, on the grid, at least 30 min) pinned first
 *  thing on the next work day. Once its whole size has been pinned it is never
 *  pinned ahead again — the planner places it like any unstarted work, a
 *  movable 30-minute chunk (`exhaustedItem`). An item whose remainder the
 *  owner released (Unpin, D798) gets none either. */
export function unfinishedRemainders(args: {
  items: readonly PlanItem[];
  pins: readonly PlanPin[];
  nowMs: number;
  hours: WorkHours;
  released?: ReadonlySet<string>;
}): Array<{ item: PlanItem; minutes: number; earliestMs: number }> {
  const today = chicagoDayKey(args.nowMs);
  const out: Array<{ item: PlanItem; minutes: number; earliestMs: number }> = [];
  for (const item of args.items) {
    if (args.released?.has(item.key)) continue;
    const ps = args.pins.filter((p) => p.itemKey === item.key);
    if (!ps.length || ps.some((p) => p.endMs > args.nowMs)) continue;
    const lastDay = chicagoDayKey(Math.max(...ps.map((p) => p.endMs)) - 1);
    if (lastDay >= today) continue;
    const left = item.sizeMin - ps.reduce((s, p) => s + (p.endMs - p.startMs) / 60_000, 0);
    if (left <= 0) continue; // its whole size is pinned: never locked ahead again
    const minutes = Math.max(MIN_CHUNK_MIN, Math.ceil(left / GRID_MIN) * GRID_MIN);
    let k = addDays(lastDay, 1);
    if (k < today) k = today;
    let win = workWindow(k, args.hours);
    for (let i = 0; i < 14 && !win; i++) {
      k = addDays(k, 1);
      win = workWindow(k, args.hours);
    }
    if (win) out.push({ item, minutes, earliestMs: win.startMs });
  }
  return out.sort((a, b) => a.earliestMs - b.earliestMs || (a.item.key < b.item.key ? -1 : 1));
}

/** Pins this compute must persist:
 *  - every block that has begun (startMs ≤ now);
 *  - a placed remainder's chunks on its FIRST placed day only (the Chicago
 *    day of its first chunk) — later chunks stay movable, and the next
 *    morning recomputes the remainder from the pins;
 *  - an In-progress item's current block: its earliest block that hasn't
 *    ended, when that block isn't already a pin. A pin covering now is that
 *    block, so it suppresses; a far-future hand pin isn't, so it doesn't;
 *    and once the current block is pinned the rest stay movable (no ratchet
 *    pinning one more chunk per compute). Not once the owner released the
 *    item (Unpin of its held block, D798) — then only a block that has begun
 *    is pinned.
 *  Only the owner's own views SAVE these (savePlanPins, D797). */
export function newPinsFrom(args: {
  blocks: readonly PlanBlock[];
  items: readonly PlanItem[];
  pins: readonly PlanPin[];
  nowMs: number;
  remainderKeys: ReadonlySet<string>;
  released?: ReadonlySet<string>;
}): PlanPin[] {
  const persisted = new Set(args.pins.map(pinBlobKey));
  const out = new Map<string, PlanPin>();
  const add = (b: PlanBlock) => {
    const p: PlanPin = { itemKey: b.itemKey, startMs: b.startMs, endMs: b.endMs, kind: "started" };
    out.set(pinBlobKey(p), p);
  };
  const byStart = (a: PlanBlock, b: PlanBlock) => a.startMs - b.startMs;
  const unpinned = args.blocks.filter((b) => !persisted.has(b.key)).sort(byStart);
  const remainderDay = new Map<string, string>();
  for (const b of unpinned) {
    if (args.remainderKeys.has(b.itemKey) && !remainderDay.has(b.itemKey)) remainderDay.set(b.itemKey, chicagoDayKey(b.startMs));
  }
  for (const b of unpinned) {
    if (b.startMs <= args.nowMs || remainderDay.get(b.itemKey) === chicagoDayKey(b.startMs)) add(b);
  }
  for (const item of args.items) {
    if (!item.inProgress || args.released?.has(item.key)) continue;
    const current = args.blocks.filter((b) => b.itemKey === item.key && b.endMs > args.nowMs).sort(byStart)[0];
    if (current && !persisted.has(current.key)) add(current);
  }
  return [...out.values()].sort((a, b) => a.startMs - b.startMs || (a.itemKey < b.itemKey ? -1 : 1));
}

/** Blob keys of pins (and release markers) whose item is no longer this person's open work. */
export function stalePinKeys(pins: readonly PlanPin[], openKeys: ReadonlySet<string>, released: readonly string[] = []): string[] {
  return [...pins.filter((p) => !openKeys.has(p.itemKey)).map(pinBlobKey), ...released.filter((k) => !openKeys.has(k)).map(releaseBlobKey)];
}

/* ---- Release markers (D798) ----
 * Unpin of a held `started` pin (a remainder, or an In-progress block that
 * hasn't begun) stores `<itemKey>@released` → { kind: "released", atMs } in
 * the same blob, so the next compute doesn't pin it straight back. pinsFromBlob
 * already skips the key (its start isn't a number); the item is then planned
 * like unstarted work until it's done, handed off or marked In progress again. */
export const RELEASED_SUFFIX = "released";
export function releaseBlobKey(itemKey: string): string {
  return `${itemKey}@${RELEASED_SUFFIX}`;
}
export function releasedFromBlob(raw: Record<string, unknown>): string[] {
  const out: string[] = [];
  for (const [k, v] of Object.entries(raw || {})) {
    if (!k.endsWith("@" + RELEASED_SUFFIX)) continue;
    const itemKey = k.slice(0, -(RELEASED_SUFFIX.length + 1));
    const o = v && typeof v === "object" ? (v as Record<string, unknown>) : null;
    if (parsePlanItemKey(itemKey) && o?.kind === RELEASED_SUFFIX) out.push(itemKey);
  }
  return out.sort();
}

export type PinMove = { kind: PlanItemKind; id: string; fromStartMs: number | null; startMs: number; minutes: number };

/** A drag drop from the client (untrusted). */
export function cleanPinMove(input: unknown, nowMs: number): { ok: true; value: PinMove } | { ok: false; error: string } {
  const o = input && typeof input === "object" ? (input as Record<string, unknown>) : {};
  const ref = parsePlanRef(o.kind, o.id);
  if (!ref) return { ok: false, error: "Unknown task." };
  const raw = Number(o.startMs);
  if (!Number.isFinite(raw)) return { ok: false, error: "Pick a time." };
  const startMs = Math.round(raw / QUARTER_MS) * QUARTER_MS;
  const minutes = Number(o.minutes);
  if (!Number.isInteger(minutes) || minutes < GRID_MIN || minutes > PIN_MAX_MIN || minutes % GRID_MIN !== 0)
    return { ok: false, error: "A block is 15 minutes to 8 hours." };
  if (startMs < floorQuarter(nowMs)) return { ok: false, error: "Pick a time from now on." };
  if (startMs > nowMs + PLAN_HORIZON_DAYS * DAY_MS) return { ok: false, error: "Pick a time in the next 8 weeks." };
  const fromRaw = o.fromStartMs;
  const fromStartMs = fromRaw == null || fromRaw === "" ? null : Number(fromRaw);
  if (fromStartMs != null && !Number.isFinite(fromStartMs)) return { ok: false, error: "Unknown block." };
  return { ok: true, value: { ...ref, fromStartMs, startMs, minutes } };
}

/** PIN_MAX_PER_PERSON, enforced by the pin store (src/lib/stores/task-pins.ts).
 *  Over the cap, prune — oldest first, and only until the count is back at
 *  the cap — PAST pins (ended at or before now) that the plan from now on no
 *  longer depends on:
 *   1. past pins of items that aren't this person's open work any more (the
 *      planner already ignores them and sweeps them as staleKeys);
 *   2. past pins of an open item that would still have at least its size
 *      pinned (by its past pins alone) without them, never that item's latest-ending pin. Its
 *      remainder is then "nothing left" (still-open work plans as a movable
 *      30-minute chunk, D796) and its last pinned day stays put, so planPerson returns the
 *      same blocks, new pins, At risk and finish times from now on; only
 *      that old day's block stops showing.
 *  Never a current or future pin, never a pin an item's remaining time still
 *  depends on. Still over the cap → the rest is kept (the store logs it). */
export function pinsToPrune(args: {
  pins: readonly PlanPin[];
  items: ReadonlyArray<Pick<PlanItem, "key" | "sizeMin">>;
  nowMs: number;
  max?: number;
}): string[] {
  const max = args.max ?? PIN_MAX_PER_PERSON;
  let over = args.pins.length - max;
  if (over <= 0) return [];
  const size = new Map(args.items.map((i) => [i.key, i.sizeMin] as const));
  const oldest = [...args.pins].sort((a, b) => a.startMs - b.startMs || (a.itemKey < b.itemKey ? -1 : a.itemKey > b.itemKey ? 1 : 0));
  const past = oldest.filter((p) => p.endMs <= args.nowMs);
  const out: string[] = [];
  for (const p of past) {
    if (over <= 0) return out;
    if (size.has(p.itemKey)) continue;
    out.push(pinBlobKey(p));
    over--;
  }
  const pinned = new Map<string, number>();
  const latest = new Map<string, PlanPin>();
  // Past pins only: a future pin can still be unpinned or dragged, so it can't
  // be what makes an old pin redundant.
  for (const p of args.pins) {
    if (p.startMs > args.nowMs || !size.has(p.itemKey)) continue;
    pinned.set(p.itemKey, (pinned.get(p.itemKey) ?? 0) + (p.endMs - p.startMs) / 60_000);
    const l = latest.get(p.itemKey);
    if (!l || p.endMs > l.endMs) latest.set(p.itemKey, p);
  }
  for (const p of past) {
    if (over <= 0) break;
    const sizeMin = size.get(p.itemKey);
    if (sizeMin == null || latest.get(p.itemKey) === p) continue;
    const left = (pinned.get(p.itemKey) ?? 0) - (p.endMs - p.startMs) / 60_000;
    if (left < sizeMin) continue;
    pinned.set(p.itemKey, left);
    out.push(pinBlobKey(p));
    over--;
  }
  return out;
}
