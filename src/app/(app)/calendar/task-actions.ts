"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/session";
import { getTask, removeTask, setTaskStatus } from "@/lib/stores/tasks";
import { getAssignment, removeAssignment, setAssignmentDone } from "@/lib/stores/assignments";

/**
 * #215 — the calendar chip's checkbox and ×. A chip is either a task
 * (tasks collection) or a My Queue assignment; both close the real record,
 * so the Queue, the bell and the owning record all agree.
 */

type Result = { ok: true } | { ok: false; error: string };
type Ref = { kind: "task" | "assignment"; id: string };

function parseRef(kind: unknown, id: unknown): Ref | null {
  const k = kind === "task" || kind === "assignment" ? kind : null;
  const i = typeof id === "string" ? id.trim() : "";
  return k && i ? { kind: k, id: i } : null;
}

async function exists(ref: Ref): Promise<boolean> {
  return ref.kind === "task" ? !!(await getTask(ref.id)) : !!(await getAssignment(ref.id));
}

export async function completeCalendarTaskAction(kind: "task" | "assignment", id: string): Promise<Result> {
  await requireUser();
  const ref = parseRef(kind, id);
  if (!ref) return { ok: false, error: "Unknown task." };
  try {
    if (!(await exists(ref))) return { ok: false, error: "That item no longer exists." };
    if (ref.kind === "task") await setTaskStatus(ref.id, "done");
    else await setAssignmentDone(ref.id, true, "app");
  } catch (error) {
    console.error("completeCalendarTaskAction: update failed", error);
    return { ok: false, error: "Couldn’t complete it — please try again." };
  }
  revalidatePath("/", "layout");
  return { ok: true };
}

export async function deleteCalendarTaskAction(kind: "task" | "assignment", id: string): Promise<Result> {
  await requireUser();
  const ref = parseRef(kind, id);
  if (!ref) return { ok: false, error: "Unknown task." };
  try {
    if (!(await exists(ref))) return { ok: false, error: "That item no longer exists." };
    if (ref.kind === "task") await removeTask(ref.id);
    else await removeAssignment(ref.id);
  } catch (error) {
    console.error("deleteCalendarTaskAction: delete failed", error);
    return { ok: false, error: "Couldn’t delete it — please try again." };
  }
  revalidatePath("/", "layout");
  return { ok: true };
}
