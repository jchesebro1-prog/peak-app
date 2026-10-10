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
import { addPins, getPins, removePinKeys, userIdForName } from "@/lib/stores/task-pins";
import { getTask, setTaskStatus, updateTask } from "@/lib/stores/tasks";
import { activeUsers } from "@/lib/users";
import { dueStampForDay } from "./due";
import { tierSizeOf } from "./fields";
import { isPlannedTask } from "./people";
import { cleanPinMove, pinBlobKey, PIN_MAX_PER_PERSON } from "./pins";
import { parsePlanRef, planItemKey, type PlanRef } from "./types";

export type WriteResult = { ok: true } | { ok: false; error: string };
export const STARTED_ERROR = "This block has started — it stays put.";
const GONE: WriteResult = { ok: false, error: "That item no longer exists." };
const DUE_MAX_DAYS = 400;

const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" ? (v as Record<string, unknown>) : {});

type Target = { key: string; ownerId: string | null; open: boolean };

/** The stored item, its pin key and whose calendar it sits on. */
async function target(ref: PlanRef): Promise<Target | null> {
  const key = planItemKey(ref.kind, ref.id);
  if (ref.kind === "task") {
    const t = await getTask(ref.id);
    if (!t) return null;
    return { key, ownerId: t.assigneeUserId ?? (await userIdForName(t.assigneeName)), open: isPlannedTask(t) };
  }
  const a = await getAssignment(ref.id);
  if (!a) return null;
  return { key, ownerId: await userIdForName(a.assignee), open: !a.done };
}

export async function pinBlock(input: unknown, nowMs: number = Date.now()): Promise<WriteResult> {
  const c = cleanPinMove(input, nowMs);
  if (!c.ok) return c;
  const t = await target(c.value);
  if (!t) return GONE;
  if (!t.open) return { ok: false, error: "That item is already done." };
  if (!t.ownerId) return { ok: false, error: "Assign it to someone first." };
  const pins = await getPins(t.ownerId);
  const from = c.value.fromStartMs == null ? undefined : pins.find((p) => p.itemKey === t.key && p.startMs === c.value.fromStartMs);
  if (from && from.startMs <= nowMs) return { ok: false, error: STARTED_ERROR };
  if (!from && pins.length >= PIN_MAX_PER_PERSON) return { ok: false, error: "Too many pinned blocks — unpin some first." };
  const next = { itemKey: t.key, startMs: c.value.startMs, endMs: c.value.startMs + c.value.minutes * 60_000, kind: "hand" as const };
  // Add first, then drop the old key: a failure in between leaves two pins, never none.
  await addPins(t.ownerId, [next]);
  if (from && pinBlobKey(from) !== pinBlobKey(next)) await removePinKeys(t.ownerId, [pinBlobKey(from)]);
  return { ok: true };
}

export async function unpinBlock(input: unknown, nowMs: number = Date.now()): Promise<WriteResult> {
  const o = obj(input);
  const ref = parsePlanRef(o.kind, o.id);
  const startMs = Number(o.startMs);
  if (!ref || !Number.isFinite(startMs)) return { ok: false, error: "Unknown block." };
  const t = await target(ref);
  if (!t) return GONE;
  if (!t.ownerId) return { ok: true };
  const pin = (await getPins(t.ownerId)).find((p) => p.itemKey === t.key && p.startMs === startMs);
  if (!pin) return { ok: true };
  if (pin.startMs <= nowMs) return { ok: false, error: STARTED_ERROR };
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
  if (!patch.priority && !patch.size) return { ok: false, error: "Nothing to change." };
  if (ref.kind === "task") return (await updateTask(ref.id, patch)) ? { ok: true } : GONE;
  if (!(await getAssignment(ref.id))) return GONE;
  await updateAssignment(ref.id, patch);
  return { ok: true };
}

/** Sets the task's status. Its current block is pinned by the next plan
 *  compute (newPinsFrom in task-plan/pins.ts: an In-progress item's earliest
 *  unended block), which the action's revalidation triggers. */
export async function markInProgress(input: unknown): Promise<WriteResult> {
  const o = obj(input);
  const ref = parsePlanRef(o.kind, o.id);
  if (!ref) return { ok: false, error: "Unknown task." };
  if (ref.kind !== "task") return { ok: false, error: "Queue items don't have an In progress state." };
  const t = await getTask(ref.id);
  if (!t) return GONE;
  if (t.status === "done") return { ok: false, error: "That item is already done." };
  return (await setTaskStatus(ref.id, "in_progress")) ? { ok: true } : GONE;
}
