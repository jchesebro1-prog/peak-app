/**
 * Task-plan pins (spec 2026-10-09 auto task calendar, Part 2 "Pins") — the
 * only thing the scheduler stores. The schedule-prefs.ts blob idiom: one blob
 * per person, `task_pins:<userId>`, ONE TOP-LEVEL KEY PER PIN
 * (`<itemKey>@<startMs>` → { endMs, kind }), so setBlob's atomic merge never
 * loses a concurrent add and a remove is one `data - key` statement. Pins sit
 * on the person's calendar, not on the record, so a hand-off leaves them
 * behind (and they are cleared). No table, no migration; blobs survive the
 * go-live demo wipe.
 *
 * Cap: PIN_MAX_PER_PERSON. addPins given the person's open items (the explicit
 * persist path; a plain add checks nothing) prunes only
 * past pins the plan no longer depends on (pinsToPrune in task-plan/pins.ts);
 * anything else stays and the overflow is logged. Never a current or future pin.
 */
import { eq, sql, type SQL } from "drizzle-orm";
import { getDb } from "@/db";
import { getBlob, setBlob } from "@/db/doc-store";
import { blobs } from "@/db/doc-tables";
import { sameName } from "@/lib/quote-approval-rules";
import { PIN_MAX_PER_PERSON, pinBlobKey, pinBlobValue, pinsFromBlob, pinsToPrune } from "@/lib/task-plan/pins";
import { planItemKey, type PlanItem, type PlanItemKind, type PlanPin } from "@/lib/task-plan/types";
import { activeUsers } from "@/lib/users";

export const pinsBlobId = (userId: string) => `task_pins:${userId}`;

export async function getPins(userId: string): Promise<PlanPin[]> {
  if (!userId) return [];
  return pinsFromBlob(await getBlob<Record<string, unknown>>(pinsBlobId(userId), {}));
}

/** What the cap needs to know which past pins the plan still depends on:
 *  the person's open items (key + size) as of `nowMs`. */
export type PinCapContext = { items: ReadonlyArray<Pick<PlanItem, "key" | "sizeMin">>; nowMs: number };

/** Where the store reports (console by default; the spec checks pass a silent one). */
export type PinLog = Pick<Console, "info" | "warn" | "error">;

/** Add pins. The cap is enforced only when `cap` (the person's open items) is
 *  given — i.e. from the explicit persist path — so a plain add never reads
 *  the whole blob back. */
export async function addPins(userId: string, pins: readonly PlanPin[], cap?: PinCapContext, log: PinLog = console): Promise<void> {
  if (!userId || !pins.length) return;
  const patch: Record<string, unknown> = {};
  for (const p of pins) patch[pinBlobKey(p)] = pinBlobValue(p);
  await setBlob(pinsBlobId(userId), patch);
  if (!cap) return;
  try {
    await enforcePinCap(userId, cap, log);
  } catch (err) {
    log.error("[task-plan] pin cap check failed:", userId, err);
  }
}

async function enforcePinCap(userId: string, cap: PinCapContext, log: PinLog): Promise<void> {
  const all = await getPins(userId);
  if (all.length <= PIN_MAX_PER_PERSON) return;
  const prune = pinsToPrune({ pins: all, items: cap.items, nowMs: cap.nowMs });
  if (prune.length) {
    await removePinKeys(userId, prune);
    log.info(`[task-plan] pin cap: pruned ${prune.length} past pin(s) the plan no longer needs for ${userId}`);
  }
  const left = all.length - prune.length;
  if (left > PIN_MAX_PER_PERSON) {
    log.warn(`[task-plan] pin cap: ${userId} keeps ${left} pins (cap ${PIN_MAX_PER_PERSON}) — the rest are current, future or still needed by the plan`);
  }
}

export async function removePinKeys(userId: string, keys: readonly string[]): Promise<void> {
  const list = [...new Set(keys.filter((k) => typeof k === "string" && k))];
  if (!userId || !list.length) return;
  let expr: SQL = sql`${blobs.data}`;
  for (const k of list) expr = sql`(${expr}) - ${k}::text`;
  const db = await getDb();
  await db.update(blobs).set({ data: expr, updatedAt: Date.now() }).where(eq(blobs.id, pinsBlobId(userId)));
}

export async function clearItemPins(userId: string | null | undefined, itemKey: string): Promise<number> {
  if (!userId) return 0;
  const keys = (await getPins(userId)).filter((p) => p.itemKey === itemKey).map(pinBlobKey);
  await removePinKeys(userId, keys);
  return keys.length;
}

/** Done / deleted / handed off (spec "Done or deleted → its future pins are
 *  cleared"). All of the item's pins go — its past ones no longer matter to
 *  any plan (the next compute would sweep them as stale anyway). Never
 *  throws: the record change has already landed, and a missed clear is swept
 *  as stale by the next plan compute. */
export async function clearPlanPinsFor(kind: PlanItemKind, id: string, userId: string | null | undefined): Promise<void> {
  try {
    await clearItemPins(userId, planItemKey(kind, id));
  } catch (err) {
    console.error("[task-plan] pin clear failed:", kind, id, err);
  }
}

/** clearPlanPinsFor for an assignment, which names its assignee instead of
 *  an id. Never throws, the name lookup included. */
export async function clearPlanPinsForName(kind: PlanItemKind, id: string, name: string | null | undefined): Promise<void> {
  try {
    await clearItemPins(await userIdForName(name || ""), planItemKey(kind, id));
  } catch (err) {
    console.error("[task-plan] pin clear failed:", kind, id, err);
  }
}

/** Assignments carry a name; pins are keyed by user id. */
export async function userIdForName(name: string): Promise<string | null> {
  if (!name) return null;
  return (await activeUsers()).find((u) => sameName(u.name, name))?.id ?? null;
}
