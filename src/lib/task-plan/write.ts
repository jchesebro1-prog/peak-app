/**
 * The plan's writes (spec Part 3 "Calendar", "At risk"). Kept out of the
 * "use server" file — every export there is POST-reachable — so the actions
 * are requireUser() + delegate and the harness can drive the real writes.
 * Every input is untrusted.
 *
 * Who may act: the same rule as the app's existing task edits (mark done,
 * delete, reassign — any signed-in user, see calendar/task-actions.ts and
 * queue/actions.ts). A pin lands on the calendar of whoever the RECORD says
 * owns the item, derived here from the stored task/assignment, never from
 * the request, and only for an open item that has an owner.
 */
import { addDays, chicagoDayKey, isDayKey } from "@/lib/drive-plan/day";
import { getAssignment, updateAssignment } from "@/lib/stores/assignments";
import { addPins, getPins, movePin, releasePin, removePinKeys, userIdForName } from "@/lib/stores/task-pins";
import { getTask, setTaskStatus, updateTask } from "@/lib/stores/tasks";
import { activeUsers } from "@/lib/users";
import { dueStampForDay } from "./due";
import { tierSizeOf } from "./fields";
import { isPlannedTask } from "./people";
import { cleanPinMove, pinBlobKey, PIN_MAX_PER_PERSON, releaseBlobKey } from "./pins";
import { floorQuarter } from "./free";
import { BLOCK_MOVED_ERROR, GRID_MIN, MIN_CHUNK_MIN, parsePlanRef, planItemKey, QUARTER_MS, sizeMinutes, type PlanRef } from "./types";

export type WriteResult = { ok: true } | { ok: false; error: string };
export const STARTED_ERROR = "This block has started — it stays put.";
const GONE: WriteResult = { ok: false, error: "That item no longer exists." };
const DUE_MAX_DAYS = 400;

const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" ? (v as Record<string, unknown>) : {});

type Target = { key: string; ownerId: string | null; open: boolean; sizeMin: number };

/** The stored item, its pin key, size and whose calendar it sits on. */
async function target(ref: PlanRef): Promise<Target | null> {
  const key = planItemKey(ref.kind, ref.id);
  if (ref.kind === "task") {
    const t = await getTask(ref.id);
    if (!t) return null;
    return { key, ownerId: t.assigneeUserId ?? (await userIdForName(t.assigneeName)), open: isPlannedTask(t), sizeMin: sizeMinutes(t.size) };
  }
  const a = await getAssignment(ref.id);
  if (!a) return null;
  return { key, ownerId: await userIdForName(a.assignee), open: !a.done, sizeMin: sizeMinutes(a.size) };
}

/** Who is asking (from the session, never the request). */
export type Actor = { id: string; admin: boolean };
export const OWNER_ERROR = "Only the owner or an admin can change this plan.";
/** Dragging a held `started` pin (a remainder or an In-progress block that hasn't begun). It can be Unpinned (D798). */
export const IN_PROGRESS_PIN_ERROR = "This block holds started work — Unpin it to free the time.";
const STALE_ERROR = BLOCK_MOVED_ERROR;
const NOT_OPEN: WriteResult = { ok: false, error: "That item isn't open." };

const mayChange = (t: Target, actor: Actor) => actor.admin || (!!t.ownerId && t.ownerId === actor.id);

/** Drag / drop a block. Only the plan's owner or an admin. A fresh drop's
 *  length comes from the client (the block it dragged), bounded 30 minutes to
 *  8 hours and capped at the item's remaining minutes — its size less what is
 *  already pinned, on the grid, at least 30 (D799); a move keeps the stored
 *  pin's own length (never the client's); a drop at or before now lands at the
 *  next quarter so the pin is never born "started". */
export async function pinBlock(input: unknown, actor: Actor, nowMs: number = Date.now()): Promise<WriteResult> {
  const c = cleanPinMove(input, nowMs);
  if (!c.ok) return c;
  const t = await target(c.value);
  if (!t) return GONE;
  if (!mayChange(t, actor)) return { ok: false, error: OWNER_ERROR };
  if (!t.open) return NOT_OPEN;
  if (!t.ownerId) return { ok: false, error: "Assign it to someone first." };
  const startMs = c.value.startMs <= nowMs ? floorQuarter(nowMs) + QUARTER_MS : c.value.startMs;
  const pins = await getPins(t.ownerId);
  if (c.value.fromStartMs != null) {
    const from = pins.find((p) => p.itemKey === t.key && p.startMs === c.value.fromStartMs);
    if (!from) return { ok: false, error: STALE_ERROR };
    if (from.startMs <= nowMs) return { ok: false, error: STARTED_ERROR };
    if (from.kind === "started") return { ok: false, error: IN_PROGRESS_PIN_ERROR };
    const next = { itemKey: t.key, startMs, endMs: startMs + (from.endMs - from.startMs), kind: "hand" as const };
    // One statement: only if the old pin is still there, so a double or concurrent drag moves it once.
    return (await movePin(t.ownerId, pinBlobKey(from), next)) ? { ok: true } : { ok: false, error: STALE_ERROR };
  }
  if (c.value.minutes < MIN_CHUNK_MIN) return { ok: false, error: "A block is 30 minutes to 8 hours." };
  if (pins.length >= PIN_MAX_PER_PERSON) return { ok: false, error: "Too many pinned blocks — unpin some first." };
  const pinnedMin = pins.filter((p) => p.itemKey === t.key).reduce((s, p) => s + (p.endMs - p.startMs) / 60_000, 0);
  const remaining = Math.max(MIN_CHUNK_MIN, Math.ceil(Math.max(0, t.sizeMin - pinnedMin) / GRID_MIN) * GRID_MIN);
  const minutes = Math.min(c.value.minutes, remaining);
  await addPins(t.ownerId, [{ itemKey: t.key, startMs, endMs: startMs + minutes * 60_000, kind: "hand" }]);
  return { ok: true };
}

export async function unpinBlock(input: unknown, actor: Actor, nowMs: number = Date.now()): Promise<WriteResult> {
  const o = obj(input);
  const ref = parsePlanRef(o.kind, o.id);
  const startMs = Number(o.startMs);
  if (!ref || !Number.isFinite(startMs)) return { ok: false, error: "Unknown block." };
  const t = await target(ref);
  if (!t) return GONE;
  if (!mayChange(t, actor)) return { ok: false, error: OWNER_ERROR };
  if (!t.ownerId) return { ok: true };
  const pin = (await getPins(t.ownerId)).find((p) => p.itemKey === t.key && p.startMs === startMs);
  if (!pin) return { ok: true };
  // A pin covering now (or past) stays locked; anything that hasn't begun can go.
  if (pin.startMs <= nowMs) return { ok: false, error: STARTED_ERROR };
  // A held `started` pin (a remainder, or an In-progress block) is the escape hatch (D798): drop it AND mark the item
  // released in one statement, so the next compute plans it as movable work instead of pinning it straight back.
  if (pin.kind === "started") {
    await releasePin(t.ownerId, pin, nowMs);
    return { ok: true };
  }
  await removePinKeys(t.ownerId, [pinBlobKey(pin)]);
  return { ok: true };
}

export async function pushDueDate(input: unknown, nowMs: number = Date.now()): Promise<WriteResult> {
  const o = obj(input);
  const ref = parsePlanRef(o.kind, o.id);
  if (!ref) return { ok: false, error: "Unknown task." };
  const today = chicagoDayKey(nowMs);
  const day = o.dayKey;
  if (!isDayKey(day) || day < today || day > addDays(today, DUE_MAX_DAYS)) return { ok: false, error: "Pick a day from today on." };
  const dueAt = dueStampForDay(day);
  if (ref.kind === "task") return (await updateTask(ref.id, { dueAt })) ? { ok: true } : GONE;
  if (!(await getAssignment(ref.id))) return GONE;
  await updateAssignment(ref.id, { dueDate: dueAt });
  return { ok: true };
}

/** Reassign through the existing update paths, which clear the old assignee's pins. */
export async function handOff(input: unknown): Promise<WriteResult> {
  const o = obj(input);
  const ref = parsePlanRef(o.kind, o.id);
  if (!ref) return { ok: false, error: "Unknown task." };
  const who = typeof o.userId === "string" ? (await activeUsers()).find((u) => u.id === o.userId) : undefined;
  if (!who) return { ok: false, error: "Pick someone on the team." };
  if (ref.kind === "task") return (await updateTask(ref.id, { assigneeUserId: who.id, assigneeName: who.name })) ? { ok: true } : GONE;
  if (!(await getAssignment(ref.id))) return GONE;
  await updateAssignment(ref.id, { assignee: who.name });
  return { ok: true };
}

export async function setTierSize(input: unknown): Promise<WriteResult> {
  const o = obj(input);
  const ref = parsePlanRef(o.kind, o.id);
  if (!ref) return { ok: false, error: "Unknown task." };
  const patch = tierSizeOf(o); // only a valid tier / size survives
  const given = (v: unknown) => v !== undefined && v !== null;
  if (given(o.priority) && !patch.priority) return { ok: false, error: "Pick a valid tier." };
  if (given(o.size) && !patch.size) return { ok: false, error: "Pick a valid size." };
  if (!patch.priority && !patch.size) return { ok: false, error: "Nothing to change." };
  if (ref.kind === "task") return (await updateTask(ref.id, patch)) ? { ok: true } : GONE;
  if (!(await getAssignment(ref.id))) return GONE;
  await updateAssignment(ref.id, patch);
  return { ok: true };
}

/** Sets the task's status. Its current block is pinned by the next plan
 *  compute on the owner's own view (newPinsFrom in task-plan/pins.ts: an
 *  In-progress item's earliest unended block), which the action's
 *  revalidation triggers. Marking it In progress again lifts an earlier
 *  release (D798). */
export async function markInProgress(input: unknown): Promise<WriteResult> {
  const o = obj(input);
  const ref = parsePlanRef(o.kind, o.id);
  if (!ref) return { ok: false, error: "Unknown task." };
  if (ref.kind !== "task") return { ok: false, error: "Queue items don't have an In progress state." };
  const t = await getTask(ref.id);
  if (!t) return GONE;
  if (t.status === "done") return { ok: false, error: "That item is already done." };
  if (!(await setTaskStatus(ref.id, "in_progress"))) return GONE;
  const owner = t.assigneeUserId ?? (await userIdForName(t.assigneeName));
  if (owner) await removePinKeys(owner, [releaseBlobKey(planItemKey("task", ref.id))]);
  return { ok: true };
}
