"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/session";
import {
  getProject,
  addNote,
  addTime,
} from "@/lib/stores/projects";
import { createTask, setTaskStatus } from "@/lib/stores/tasks";

/**
 * Field Work mutations — the ProjectStore calls the prototype's Field Work
 * screen makes (project.js toggleTask / addTask / addNote / addTime). Tasks
 * (#17) now live in the tasks collection rather than embedded on the project
 * doc. FormData-shaped so the on-site forms work without client JS; invalid
 * input is a silent no-op (the UI only renders legal actions). The signed-in
 * user is the field actor (`me` in the prototype: window.Team.CURRENT).
 */

/** Check / uncheck an install task. */
export async function toggleFieldTask(formData: FormData): Promise<void> {
  await requireUser();
  const taskId = String(formData.get("taskId") || "");
  const done = String(formData.get("done") || "") === "1";
  if (!taskId) return;
  try {
    await setTaskStatus(taskId, done ? "done" : "open");
  } catch (error) {
    console.error("toggleFieldTask failed", error);
    redirectFieldError("Couldn’t update that task — please try again.", formData);
  }
  revalidatePath("/", "layout");
}

/** Add a punch-list task (Install section, assigned to the signed-in user). */
export async function addFieldTask(formData: FormData): Promise<{ ok: true } | { ok: false; error: string }> {
  const me = await requireUser();
  const projectId = String(formData.get("id") || "");
  const title = String(formData.get("title") || "").trim();
  const clientId = String(formData.get("taskId") || "");
  if (!projectId || !title) return { ok: false, error: "A task title is required." };
  try {
    await createTask(
      { id: clientId || undefined, title, section: "Install", projectId,
        assigneeUserId: me.id, assigneeName: me.name },
      me,
    );
  } catch (error) {
    console.error("addFieldTask: task mint failed", error);
    return { ok: false, error: "Couldn’t add that task — please try again." };
  }
  revalidatePath("/", "layout");
  return { ok: true };
}

/** Log a field note (text only in this build — photo upload deferred). */
export async function postFieldNote(formData: FormData): Promise<void> {
  const me = await requireUser();
  const id = String(formData.get("id") || "");
  const text = String(formData.get("text") || "").trim();
  if (!id || !text) return;
  const p = await getProject(id);
  if (!p) return;
  try {
    await addNote(id, me.name, text, null);
  } catch (error) {
    console.error("postFieldNote failed", error);
    redirectFieldError("Couldn’t save that note — please try again.", formData);
  }
  revalidatePath("/", "layout");
}

/** Log hours worked today against the job. */
export async function logFieldTime(formData: FormData): Promise<void> {
  const me = await requireUser();
  const id = String(formData.get("id") || "");
  const hours = parseFloat(String(formData.get("hours") || ""));
  const note = String(formData.get("note") || "").trim();
  if (!id || !(hours > 0)) return;
  const p = await getProject(id);
  if (!p) return;
  try {
    await addTime(id, me.name, hours, note);
  } catch (error) {
    console.error("logFieldTime failed", error);
    redirectFieldError("Couldn’t save that time entry — please try again.", formData);
  }
  revalidatePath("/", "layout");
}

function redirectFieldError(message: string, formData: FormData): never {
  const id = String(formData.get("id") || "");
  redirect(`/field-work${id ? `?id=${encodeURIComponent(id)}&` : "?"}err=${encodeURIComponent(message)}`);
}
