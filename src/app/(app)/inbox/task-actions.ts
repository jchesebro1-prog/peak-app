"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/session";
import { setTaskStatus } from "@/lib/stores/tasks";
import { createTaskFromThread } from "@/lib/inbox-task-write";
import type { ThreadTaskRequest } from "@/lib/inbox-task";

/** #215 — "Create task" from an email, and the sidebar's complete checkbox. */

type Result = { ok: true } | { ok: false; error: string };

export async function createTaskFromThreadAction(req: ThreadTaskRequest): Promise<Result> {
  const me = await requireUser();
  try {
    const r = await createTaskFromThread(req, { id: me.id, name: me.name });
    if (!r.ok) return r;
  } catch (error) {
    console.error("createTaskFromThreadAction: task create failed", error);
    return { ok: false, error: "Couldn’t create the task — please try again." };
  }
  revalidatePath("/", "layout");
  return { ok: true };
}

export async function completeThreadTaskAction(taskId: string): Promise<Result> {
  await requireUser();
  const id = typeof taskId === "string" ? taskId.trim() : "";
  if (!id) return { ok: false, error: "Unknown task." };
  try {
    if (!(await setTaskStatus(id, "done"))) return { ok: false, error: "That task no longer exists." };
  } catch (error) {
    console.error("completeThreadTaskAction: task update failed", error);
    return { ok: false, error: "Couldn’t complete the task — please try again." };
  }
  revalidatePath("/", "layout");
  return { ok: true };
}
