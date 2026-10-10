/**
 * Blended urgency (spec Part 2 "Ordering"). Pure and client-safe.
 *
 * weight = tier factor (High 3 · Normal 2 · Low 1) × 1 / (days left + 1),
 * days left in whole Chicago calendar days (0 = due today). The curve is
 * hyperbolic: from a week out to due today it rises 8×, so a Low task due
 * tomorrow (1/2) beats a High task due next week (3/8) or next month (3/31).
 * Overdue outranks everything, most overdue first; ties: earlier due → older
 * createdAt → item key. Weights are compared as integer cross-products, never
 * as floats, so the order is exact and deterministic.
 *
 * Callers pass DATED items only: `dueMs` must be a real due stamp. A dueMs of
 * 0 (or any missing date) reads as decades overdue and sorts first of all.
 * Undated work plans by its effective due (`effectiveDue` in ./due — a
 * rolling today + 7 days from the plan's own clock, D801); `planPerson`
 * applies that before it sorts.
 */
import { dayKeyDiff } from "@/lib/calendar-tasks";
import { chicagoDayKey } from "@/lib/drive-plan/day";
import { TIER_FACTOR, type TaskTier } from "./types";

export function daysLeft(dueMs: number, nowMs: number): number {
  return dayKeyDiff(chicagoDayKey(nowMs), chicagoDayKey(dueMs));
}

export function urgencyWeight(tier: TaskTier, d: number): number {
  return TIER_FACTOR[tier] / (Math.max(0, d) + 1);
}

export type UrgencyKey = { key: string; tier: TaskTier; dueMs: number; createdAt: number };

export function compareUrgency(a: UrgencyKey, b: UrgencyKey, nowMs: number): number {
  const da = daysLeft(a.dueMs, nowMs);
  const db = daysLeft(b.dueMs, nowMs);
  const ao = da < 0;
  const bo = db < 0;
  if (ao !== bo) return ao ? -1 : 1;
  if (ao) {
    if (da !== db) return da - db; // more overdue first
    const t = TIER_FACTOR[b.tier] - TIER_FACTOR[a.tier];
    if (t) return t;
  } else {
    // a first when tier(a)/(da+1) > tier(b)/(db+1)
    const lhs = TIER_FACTOR[a.tier] * (db + 1);
    const rhs = TIER_FACTOR[b.tier] * (da + 1);
    if (lhs !== rhs) return rhs - lhs;
  }
  if (a.dueMs !== b.dueMs) return a.dueMs - b.dueMs;
  if (a.createdAt !== b.createdAt) return a.createdAt - b.createdAt;
  return a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
}

export function sortByUrgency<T extends UrgencyKey>(items: readonly T[], nowMs: number): T[] {
  return [...items].sort((a, b) => compareUrgency(a, b, nowMs));
}
