/**
 * Auto task calendar (spec docs/superpowers/specs/2026-10-09-auto-task-calendar-design.md)
 * — shared shapes and constants. Pure and CLIENT-SAFE (type-only imports).
 */
import type { WorkHours } from "@/lib/visit-plan/settings";

export const TASK_TIERS = ["high", "normal", "low"] as const;
export type TaskTier = (typeof TASK_TIERS)[number];
export const TASK_SIZES = ["s", "m", "l"] as const;
export type TaskSize = (typeof TASK_SIZES)[number];

/** Blended urgency's tier factor (spec Part 2 "Ordering"). */
export const TIER_FACTOR: Record<TaskTier, number> = { high: 3, normal: 2, low: 1 };
export const SIZE_MIN: Record<TaskSize, number> = { s: 30, m: 60, l: 240 };
export const TIER_LABEL: Record<TaskTier, string> = { high: "High", normal: "Normal", low: "Low" };
export const SIZE_LABEL: Record<TaskSize, string> = { s: "S", m: "M", l: "L" };
export const SIZE_HINT: Record<TaskSize, string> = { s: "30 min", m: "1 h", l: "4 h" };
export const DEFAULT_TIER: TaskTier = "normal";
export const DEFAULT_SIZE: TaskSize = "m";

/** Horizon: until everything is placed, capped at 8 weeks. */
export const PLAN_HORIZON_DAYS = 56;
/** At most 80 % of each day's free minutes is filled. */
export const FILL_RATIO = 0.8;
export const GRID_MIN = 15;
export const MIN_CHUNK_MIN = 30;
export const QUARTER_MS = GRID_MIN * 60_000;

export function cleanTier(v: unknown): TaskTier | null {
  return v === "high" || v === "normal" || v === "low" ? v : null;
}
export function cleanSize(v: unknown): TaskSize | null {
  return v === "s" || v === "m" || v === "l" ? v : null;
}
export function tierOrDefault(v: unknown): TaskTier {
  return cleanTier(v) ?? DEFAULT_TIER;
}
export function sizeMinutes(v: unknown): number {
  return SIZE_MIN[cleanSize(v) ?? DEFAULT_SIZE];
}

/** What a pin write answers when the block it was asked to move is no longer where the caller saw it. */
export const BLOCK_MOVED_ERROR = "That block moved — refresh.";

export type PlanItemKind = "task" | "assignment";
export type PlanRef = { kind: PlanItemKind; id: string };

/** Same strings as triageKey.task / triageKey.assignment, so the triage hook can use them as-is. */
export function planItemKey(kind: PlanItemKind, id: string): string {
  return kind === "task" ? `task:${id}` : `asg:${id}`;
}
export function parsePlanItemKey(key: string): PlanRef | null {
  const m = /^(task|asg):(.+)$/.exec(key || "");
  return m ? { kind: m[1] === "task" ? "task" : "assignment", id: m[2] } : null;
}
const REF_ID_MAX = 160;
/** An untrusted { kind, id } from an action. */
export function parsePlanRef(kind: unknown, id: unknown): PlanRef | null {
  const k = kind === "task" || kind === "assignment" ? kind : null;
  const i = typeof id === "string" ? id.trim() : "";
  return k && i && i.length <= REF_ID_MAX ? { kind: k, id: i } : null;
}

export type PinKind = "started" | "hand";
/** The only thing the scheduler stores (spec Part 2 "Pins"). */
export type PlanPin = { itemKey: string; startMs: number; endMs: number; kind: PinKind };
export type BusyInterval = { startMs: number; endMs: number };

export type PlanItem = {
  key: string;
  kind: PlanItemKind;
  id: string;
  userId: string;
  title: string;
  href: string;
  tier: TaskTier;
  size: TaskSize;
  sizeMin: number;
  /** effective due (an undated item plans as due 7 days after it was created) */
  dueMs: number;
  dueVirtual: boolean;
  /** a template's startAt: the earliest the item may be placed */
  earliestMs: number | null;
  createdAt: number;
  inProgress: boolean;
};

export type PlanInput = {
  userId: string;
  nowMs: number;
  hours: WorkHours;
  /** visits, drive blocks, accepted timed Google events */
  busy: BusyInterval[];
  /** this person's pins (any item; pins of items not in `items` are stale) */
  pins: PlanPin[];
  items: PlanItem[];
  horizonDays?: number;
  fillRatio?: number;
};

export type PlanBlock = {
  /** `${itemKey}@${startMs}` — the same string as the pin blob key */
  key: string;
  itemKey: string;
  kind: PlanItemKind;
  id: string;
  userId: string;
  title: string;
  href: string;
  tier: TaskTier;
  size: TaskSize;
  startMs: number;
  endMs: number;
  pinned: PinKind | null;
  atRisk: boolean;
  dueMs: number;
  inProgress: boolean;
};

export type AtRiskItem = {
  itemKey: string;
  kind: PlanItemKind;
  id: string;
  userId: string;
  title: string;
  href: string;
  dueMs: number;
  /** when the plan finishes it; null = doesn't fit in the horizon */
  finishMs: number | null;
  label: string;
};

export type PlanResult = {
  userId: string;
  nowMs: number;
  blocks: PlanBlock[];
  atRisk: AtRiskItem[];
  /** pins this compute must persist (blocks that began, in-progress, remainders) */
  newPins: PlanPin[];
  /** pin blob keys whose item is no longer this person's open work */
  staleKeys: string[];
  /** pins that haven't begun (what Unpin can offer) */
  futurePins: PlanPin[];
  /** when each item's last block ends; null = doesn't fit in the horizon.
   *  An item with nothing left to place has NO key (never a bare null). */
  finishMs: Record<string, number | null>;
};
