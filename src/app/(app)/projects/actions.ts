"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/session";
import { activeUsers } from "@/lib/users";
import { createAssignment } from "@/lib/stores/assignments";
import {
  getProject,
  setProjectStage,
  setLineStatus,
  setLinePo,
  setDeliveryStatus,
  addCrew,
  removeCrew,
  addNote,
  addTime,
  setSignoff,
  signoffScopes,
  createProjectFromQuote,
  stagesFor,
  type ProjectStage,
  type LineStatus,
  type DeliveryStatus,
} from "@/lib/stores/projects";
import {
  createTask,
  setTaskStatus,
  updateTask,
  STATUSES,
  type TaskStatus,
} from "@/lib/stores/tasks";
import { applyTaskTemplate } from "@/lib/stores/task-templates";

/**
 * Project & sales-order mutations — the ProjectStore calls the prototype makes
 * from the Projects screen (project.js setStage / setLineStatus /
 * setDeliveryStatus / addCrew / removeCrew / setSignoff / createFromQuote, plus
 * the field-side addNote / addTime). FormData-shaped so the forms submit
 * without client JS; invalid input is a silent no-op (the UI only renders
 * legal actions, mirroring the prototype's gates). Every mutation revalidates
 * the layout so the list + detail re-render.
 */

const LINE_STATUSES: LineStatus[] = ["pending", "ordered", "shipped", "received"];
const DELIVERY_STATUSES: DeliveryStatus[] = ["scheduled", "in_transit", "received"];

function str(fd: FormData, k: string): string {
  return String(fd.get(k) || "");
}

/** Jump/advance a project to a stage (stage tracker node + Advance button). */
export async function setStageAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const id = str(formData, "id");
  const stage = str(formData, "stage") as ProjectStage;
  if (!id || !stage) return;
  const p = await getProject(id);
  if (!p) return;
  if (!stagesFor(p.kind).some((s) => s.key === stage)) return; // illegal for kind
  await setProjectStage(id, stage, user.name);
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

/** Save the PO number a human typed in for a procurement line (punch #67). Free text from an external system — trimmed, not validated or generated. */
export async function setLinePoAction(formData: FormData): Promise<void> {
  await requireUser();
  const id = str(formData, "id");
  const lineId = str(formData, "lineId");
  const po = str(formData, "po");
  if (!id || !lineId) return;
  await setLinePo(id, lineId, po);
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
  const user = await requireUser();
  const id = str(formData, "id");
  const name = str(formData, "name").trim();
  if (!id || !name) return;
  const p = await getProject(id);
  if (!p) return;
  const role = str(formData, "role").trim() || "Customer";
  const note = str(formData, "note").trim();
  const signature = str(formData, "signature").trim();
  if (!/^data:image\/png;base64,[A-Za-z0-9+/]+=*$/.test(signature) || signature.length > 350_000) return;
  const scopes = signoffScopes(p);
  const checked = new Set(formData.getAll("scope").map((value) => String(value).trim()).filter(Boolean));
  if (scopes.some((scope) => !checked.has(scope))) return;
  await setSignoff(id, {
    name,
    role,
    note,
    signature,
    scopeChecks: Object.fromEntries(scopes.map((scope) => [scope, true])),
  }, user.name);
  // Punch #16 (D14x): narrow idempotency guard — setProjectStage has no
  // "already at this stage" early return (recordStageChange() is a no-op
  // internally but doesn't stop the caller's side effects), so this checks
  // the stage we fetched BEFORE the transition rather than restructuring
  // setProjectStage itself. Only fires the very first time a project reaches
  // "complete", the one caller (signoffAction) reaching it through the
  // sign-off Jeff requires (decision D) for a real completion.
  const wasComplete = p.stage === "complete";
  await setProjectStage(id, "complete", user.name);
  if (!wasComplete) {
    try {
      await createAssignment({
        title: `Walk the completed site with the end user: ${p.name || p.customer || id}`,
        assignee: p.owner || "Jeff Chesebro",
        createdBy: user.name,
        link: { kind: "project", id, label: p.name || p.customer || id },
        source: "auto: project complete (#16)",
      });
    } catch (error) {
      console.error("signoffAction: follow-up mint failed", error);
      redirect(`/projects/${encodeURIComponent(id)}?tab=signoff&err=` + encodeURIComponent("Sign-off was recorded, but the follow-up task could not be created. Please try again."));
    }
  }
  revalidatePath("/", "layout");
}

/** Convert a won quote into a project/order and open it. */
export async function startConversionAction(formData: FormData): Promise<void> {
  await requireUser();
  const quoteId = str(formData, "quoteId");
  if (!quoteId) return;
  let p;
  try {
    p = await createProjectFromQuote(quoteId);
  } catch (error) {
    console.error("startConversionAction: project mint failed", error);
    redirect("/projects?err=" + encodeURIComponent("Couldn’t start the project — please try again."));
  }
  revalidatePath("/", "layout");
  if (p) redirect("/projects/" + encodeURIComponent(p.id));
}

/* ---- field-side mutations (Field Work reuses these; provided per contract) ---- */

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

/* ---- tasks (#17) — office-side create/status/edit for the detail tasks card ---- */

export async function addTaskAction(formData: FormData) {
  const me = await requireUser();
  const projectId = String(formData.get("id") || "");
  const title = String(formData.get("title") || "").trim();
  const section = String(formData.get("section") || "Install");
  const assigneeUserId = String(formData.get("assigneeUserId") || "") || null;
  const due = String(formData.get("dueAt") || "");
  if (!projectId || !title) return;
  const assigneeName = assigneeUserId
    ? (await activeUsers()).find((u) => u.id === assigneeUserId)?.name || ""
    : "";
  try {
    await createTask(
      { title, section, projectId, assigneeUserId, assigneeName,
        dueAt: due ? new Date(due + "T12:00:00").getTime() : null },
      me,
    );
  } catch (error) {
    console.error("addTaskAction: task mint failed", error);
    redirect(`/projects/${encodeURIComponent(projectId)}?tab=tasks&err=` + encodeURIComponent("Couldn’t add that task — please try again."));
  }
  revalidatePath("/", "layout");
}

export async function setTaskStatusAction(formData: FormData) {
  await requireUser();
  const taskId = String(formData.get("taskId") || "");
  const status = String(formData.get("status") || "");
  if (!taskId || !(STATUSES as readonly string[]).includes(status)) return;
  await setTaskStatus(taskId, status as TaskStatus);
  revalidatePath("/", "layout");
}

export async function updateTaskAction(formData: FormData) {
  await requireUser();
  const taskId = String(formData.get("taskId") || "");
  if (!taskId) return;
  const patch: Record<string, unknown> = {};
  if (formData.has("assigneeUserId")) {
    const uid = String(formData.get("assigneeUserId") || "") || null;
    patch.assigneeUserId = uid;
    patch.assigneeName = uid ? (await activeUsers()).find((u) => u.id === uid)?.name || "" : "";
  }
  if (formData.has("dueAt")) {
    const d = String(formData.get("dueAt") || "");
    patch.dueAt = d ? new Date(d + "T12:00:00").getTime() : null;
  }
  if (formData.has("notes")) patch.notes = String(formData.get("notes") || "");
  await updateTask(taskId, patch);
  revalidatePath("/", "layout");
}

/** Apply a reusable task-template set (D149, #118) to this project — thin
 *  FormData wrapper over task-templates.ts's applyTaskTemplate(), mirroring
 *  addTaskAction's own no-op-on-bad-input convention above. */
export async function applyProjectTemplateAction(formData: FormData) {
  const me = await requireUser();
  const projectId = String(formData.get("id") || "");
  const setId = String(formData.get("setId") || "");
  if (!projectId || !setId) return;
  await applyTaskTemplate(setId, { kind: "project", id: projectId }, me);
  revalidatePath("/", "layout");
}
