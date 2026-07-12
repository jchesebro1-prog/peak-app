"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/session";
import {
  getProject,
  toggleTask,
  addTask,
  addNote,
  addTime,
} from "@/lib/stores/projects";

/**
 * Field Work mutations — the ProjectStore calls the prototype's Field Work
 * screen makes (project.js toggleTask / addTask / addNote / addTime).
 * FormData-shaped so the on-site forms work without client JS; invalid input
 * is a silent no-op (the UI only renders legal actions). The signed-in user
 * is the field actor (`me` in the prototype: window.Team.CURRENT).
 */

/** Check / uncheck an install task. */
export async function toggleFieldTask(formData: FormData): Promise<void> {
  await requireUser();
  const id = String(formData.get("id") || "");
  const taskId = String(formData.get("taskId") || "");
  if (!id || !taskId) return;
  const p = await getProject(id);
  if (!p) return;
  await toggleTask(id, taskId);
  revalidatePath("/", "layout");
}

/** Add a punch-list task (Install section, assigned to the signed-in user). */
export async function addFieldTask(formData: FormData): Promise<void> {
  const me = await requireUser();
  const id = String(formData.get("id") || "");
  const title = String(formData.get("title") || "").trim();
  if (!id || !title) return;
  const p = await getProject(id);
  if (!p) return;
  await addTask(id, title, "Install", me.name);
  revalidatePath("/", "layout");
}

/** Log a field note (text only in this build — photo upload deferred). */
export async function postFieldNote(formData: FormData): Promise<void> {
  const me = await requireUser();
  const id = String(formData.get("id") || "");
  const text = String(formData.get("text") || "").trim();
  if (!id || !text) return;
  const p = await getProject(id);
  if (!p) return;
  await addNote(id, me.name, text, null);
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
  await addTime(id, me.name, hours, note);
  revalidatePath("/", "layout");
}
