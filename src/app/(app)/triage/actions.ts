"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/session";
import { setTaskStatus } from "@/lib/stores/tasks";
import { getAssignment, setAssignmentDone } from "@/lib/stores/assignments";
import { assign as assignThread, setStatus as setThreadStatus } from "@/lib/stores/comms";
import { getRecording } from "@/lib/stores/recordings";
import { dismissActionItem } from "@/lib/krisp/write-back";
import { activeUsers } from "@/lib/users";
import { sameName } from "@/lib/quote-approval-rules";
import { parseTriageKey } from "@/lib/triage/keys";
import { donePlan } from "@/lib/triage/actions-plan";
import { slotAt, snapshotId } from "@/lib/triage/clock";
import { snoozeUntil } from "@/lib/triage/view";
import { setMark } from "@/lib/triage/store";

/**
 * Morning triage row actions (spec "Row actions"). Marks are always the
 * signed-in user's own; an admin viewing a teammate's list sees it
 * read-only, so nothing here takes a user id.
 */

type Result = { ok: true; open?: string } | { ok: false; error: string };

const GONE = "That item no longer exists.";

function currentSlot(userId: string) {
  const now = Date.now();
  const { day, slot } = slotAt(now);
  return { now, day, snapshotId: snapshotId(userId, day, slot) };
}

function refresh() {
  revalidatePath("/");
  revalidatePath("/triage");
}

export async function triageDoneAction(key: string): Promise<Result> {
  const user = await requireUser();
  const k = String(key || "");
  const plan = donePlan(k);
  if (!plan) return { ok: false, error: "That item isn't on your list." };
  if (plan.kind === "open") return { ok: true, open: plan.href };
  const cur = currentSlot(user.id);
  try {
    // A record deleted since the snapshot was built: say so, never record a done mark for it.
    if (plan.kind === "task") {
      if (!(await setTaskStatus(plan.id, "done"))) return { ok: false, error: GONE };
    } else if (plan.kind === "assignment") {
      if (!(await getAssignment(plan.id))) return { ok: false, error: GONE };
      await setAssignmentDone(plan.id, true, "app");
    } else if (plan.kind === "thread") {
      if (!(await setThreadStatus(plan.id, "closed"))) return { ok: false, error: GONE };
    }
    await setMark({ userId: user.id, key: k, kind: "done", at: cur.now, snapshotId: cur.snapshotId, until: null });
  } catch (error) {
    console.error("triageDoneAction failed", error);
    return { ok: false, error: "Couldn’t mark that done — please try again." };
  }
  refresh();
  return { ok: true };
}

export async function triageSnoozeAction(key: string): Promise<Result> {
  const user = await requireUser();
  const k = String(key || "");
  if (!parseTriageKey(k)) return { ok: false, error: "That item isn't on your list." };
  const cur = currentSlot(user.id);
  try {
    await setMark({ userId: user.id, key: k, kind: "snooze", at: cur.now, snapshotId: cur.snapshotId, until: snoozeUntil(cur.day) });
  } catch (error) {
    console.error("triageSnoozeAction failed", error);
    return { ok: false, error: "Couldn’t snooze that — please try again." };
  }
  refresh();
  return { ok: true };
}

export async function triageDismissAction(key: string): Promise<Result> {
  const user = await requireUser();
  const k = String(key || "");
  const parsed = parseTriageKey(k);
  if (!parsed) return { ok: false, error: "That item isn't on your list." };
  const cur = currentSlot(user.id);
  try {
    if (parsed.source === "call" && parsed.part) {
      const rec = await getRecording(parsed.id);
      if (rec) await dismissActionItem(rec, parsed.part);
    }
    await setMark({ userId: user.id, key: k, kind: "dismiss", at: cur.now, snapshotId: null, until: null });
  } catch (error) {
    console.error("triageDismissAction failed", error);
    return { ok: false, error: error instanceof Error && error.message ? error.message : "Couldn’t dismiss that — please try again." };
  }
  refresh();
  return { ok: true };
}

export async function triageReassignAction(key: string, assignee: string): Promise<Result> {
  const user = await requireUser();
  const k = String(key || "");
  const parsed = parseTriageKey(k);
  if (!parsed || parsed.source !== "email") return { ok: false, error: "Only an email can be reassigned." };
  const target = (await activeUsers()).find((u) => sameName(u.name, String(assignee || "")));
  if (!target) return { ok: false, error: "Pick a teammate." };
  const cur = currentSlot(user.id);
  try {
    await assignThread(parsed.id, target.name);
    await setMark({ userId: user.id, key: k, kind: "done", at: cur.now, snapshotId: cur.snapshotId, until: null });
  } catch (error) {
    console.error("triageReassignAction failed", error);
    return { ok: false, error: "Couldn’t reassign that — please try again." };
  }
  refresh();
  return { ok: true };
}
