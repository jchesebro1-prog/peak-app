"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/session";
import {
  getProject,
  setProjectStage,
  setLineStatus,
  setDeliveryStatus,
  addCrew,
  removeCrew,
  addTask,
  toggleTask,
  addNote,
  addTime,
  setSignoff,
  createProjectFromQuote,
  stagesFor,
  type ProjectStage,
  type LineStatus,
  type DeliveryStatus,
} from "@/lib/stores/projects";

/**
 * Project & sales-order mutations — the ProjectStore calls the prototype makes
 * from the Projects screen (project.js setStage / setLineStatus /
 * setDeliveryStatus / addCrew / removeCrew / setSignoff / createFromQuote, plus
 * the field-side addTask / toggleTask / addNote / addTime). FormData-shaped so
 * the forms submit without client JS; invalid input is a silent no-op (the UI
 * only renders legal actions, mirroring the prototype's gates). Every mutation
 * revalidates the layout so the list + detail re-render.
 */

const LINE_STATUSES: LineStatus[] = ["pending", "ordered", "shipped", "received"];
const DELIVERY_STATUSES: DeliveryStatus[] = ["scheduled", "in_transit", "received"];

function str(fd: FormData, k: string): string {
  return String(fd.get(k) || "");
}

/** Jump/advance a project to a stage (stage tracker node + Advance button). */
export async function setStageAction(formData: FormData): Promise<void> {
  await requireUser();
  const id = str(formData, "id");
  const stage = str(formData, "stage") as ProjectStage;
  if (!id || !stage) return;
  const p = await getProject(id);
  if (!p) return;
  if (!stagesFor(p.kind).some((s) => s.key === stage)) return; // illegal for kind
  await setProjectStage(id, stage);
  revalidatePath("/", "layout");
}

/** Advance a pending → ordered → shipped → received procurement line (chip tap). */
export async function cycleLineAction(formData: FormData): Promise<void> {
  await requireUser();
  const id = str(formData, "id");
  const lineId = str(formData, "lineId");
  const status = str(formData, "status") as LineStatus;
  if (!id || !lineId || !LINE_STATUSES.includes(status)) return;
  await setLineStatus(id, lineId, status);
  revalidatePath("/", "layout");
}

/** Advance a scheduled → in_transit → received delivery (chip tap). */
export async function cycleDeliveryAction(formData: FormData): Promise<void> {
  await requireUser();
  const id = str(formData, "id");
  const deliveryId = str(formData, "deliveryId");
  const status = str(formData, "status") as DeliveryStatus;
  if (!id || !deliveryId || !DELIVERY_STATUSES.includes(status)) return;
  await setDeliveryStatus(id, deliveryId, status);
  revalidatePath("/", "layout");
}

/** Assign a roster member to the install crew. */
export async function addCrewAction(formData: FormData): Promise<void> {
  await requireUser();
  const id = str(formData, "id");
  const person = str(formData, "person").trim();
  if (!id || !person) return;
  const p = await getProject(id);
  if (!p || p.kind === "order") return; // orders have no crew
  await addCrew(id, person);
  revalidatePath("/", "layout");
}

/** Remove a crew assignment. */
export async function removeCrewAction(formData: FormData): Promise<void> {
  await requireUser();
  const id = str(formData, "id");
  const crewId = str(formData, "crewId");
  if (!id || !crewId) return;
  await removeCrew(id, crewId);
  revalidatePath("/", "layout");
}

/** Record customer sign-off at hand-off, then close the job out (→ complete). */
export async function signoffAction(formData: FormData): Promise<void> {
  await requireUser();
  const id = str(formData, "id");
  const name = str(formData, "name").trim();
  if (!id || !name) return;
  const p = await getProject(id);
  if (!p) return;
  const role = str(formData, "role").trim() || "Customer";
  const note = str(formData, "note").trim();
  await setSignoff(id, { name, role, note });
  await setProjectStage(id, "complete");
  revalidatePath("/", "layout");
}

/** Convert a won quote into a project/order and open it. */
export async function startConversionAction(formData: FormData): Promise<void> {
  await requireUser();
  const quoteId = str(formData, "quoteId");
  if (!quoteId) return;
  const p = await createProjectFromQuote(quoteId);
  revalidatePath("/", "layout");
  if (p) redirect("/projects/" + encodeURIComponent(p.id));
}

/* ---- field-side mutations (Field Work reuses these; provided per contract) ---- */

export async function addTaskAction(formData: FormData): Promise<void> {
  await requireUser();
  const id = str(formData, "id");
  if (!id) return;
  const title = str(formData, "title").trim();
  const section = str(formData, "section").trim();
  const assignee = str(formData, "assignee").trim();
  await addTask(id, title || undefined, section || undefined, assignee || undefined);
  revalidatePath("/", "layout");
}

export async function toggleTaskAction(formData: FormData): Promise<void> {
  await requireUser();
  const id = str(formData, "id");
  const taskId = str(formData, "taskId");
  if (!id || !taskId) return;
  await toggleTask(id, taskId);
  revalidatePath("/", "layout");
}

export async function addNoteAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const id = str(formData, "id");
  const text = str(formData, "text").trim();
  if (!id || !text) return;
  await addNote(id, user.name || undefined, text);
  revalidatePath("/", "layout");
}

export async function addTimeAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const id = str(formData, "id");
  const hours = str(formData, "hours");
  if (!id || !hours) return;
  await addTime(id, user.name || undefined, hours, str(formData, "note").trim());
  revalidatePath("/", "layout");
}
