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

/** Spec "Unfinished": an open item whose pins all ended on a day before
 *  today gets its remaining time (size − pinned so far, at least 30 min)
 *  pinned first thing on the next work day. */
export function unfinishedRemainders(args: {
  items: readonly PlanItem[];
  pins: readonly PlanPin[];
  nowMs: number;
  hours: WorkHours;
}): Array<{ item: PlanItem; minutes: number; earliestMs: number }> {
  const today = chicagoDayKey(args.nowMs);
  const out: Array<{ item: PlanItem; minutes: number; earliestMs: number }> = [];
  for (const item of args.items) {
    const ps = args.pins.filter((p) => p.itemKey === item.key);
    if (!ps.length || ps.some((p) => p.endMs > args.nowMs)) continue;
    const lastDay = chicagoDayKey(Math.max(...ps.map((p) => p.endMs)) - 1);
    if (lastDay >= today) continue;
    const pinned = ps.reduce((s, p) => s + (p.endMs - p.startMs) / 60_000, 0);
    const minutes = Math.max(MIN_CHUNK_MIN, Math.ceil(Math.max(0, item.sizeMin - pinned) / GRID_MIN) * GRID_MIN);
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

/** Pins this compute must persist: blocks that have begun, placed
 *  remainders, and the current block of each In-progress item with no live pin. */
export function newPinsFrom(args: {
  blocks: readonly PlanBlock[];
  items: readonly PlanItem[];
  pins: readonly PlanPin[];
  nowMs: number;
  remainderKeys: ReadonlySet<string>;
}): PlanPin[] {
  const persisted = new Set(args.pins.map(pinBlobKey));
  const out = new Map<string, PlanPin>();
  const add = (b: PlanBlock) => {
    const p: PlanPin = { itemKey: b.itemKey, startMs: b.startMs, endMs: b.endMs, kind: "started" };
    out.set(pinBlobKey(p), p);
  };
  const unpinned = args.blocks.filter((b) => !persisted.has(b.key));
  for (const b of unpinned) if (b.startMs <= args.nowMs || args.remainderKeys.has(b.itemKey)) add(b);
  const live = new Set(args.pins.filter((p) => p.endMs > args.nowMs).map((p) => p.itemKey));
  for (const item of args.items) {
    if (!item.inProgress || live.has(item.key)) continue;
    const first = unpinned.filter((b) => b.itemKey === item.key).sort((a, b) => a.startMs - b.startMs)[0];
    if (first) add(first);
  }
  return [...out.values()].sort((a, b) => a.startMs - b.startMs || (a.itemKey < b.itemKey ? -1 : 1));
}

/** Blob keys of pins whose item is no longer this person's open work. */
export function stalePinKeys(pins: readonly PlanPin[], openKeys: ReadonlySet<string>): string[] {
  return pins.filter((p) => !openKeys.has(p.itemKey)).map(pinBlobKey);
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
