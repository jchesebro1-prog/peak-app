"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/session";
import { activeUsers } from "@/lib/users";
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
  removeNote,
  removeTime,
  setSignoff,
  setProjectValue,
  signoffScopes,
  createProjectFromQuote,
  removeProject,
  type ProjectStage,
  type LineStatus,
  type DeliveryStatus,
} from "@/lib/stores/projects";
import {
  createTask,
  getTask,
  setTaskStatus,
  updateTask,
  removeTask,
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

/** Keep failed mutations on the project detail where ActionError is rendered.
 * A form may supply its current tab; each action has a safe relevant fallback. */
function projectErrorPath(id: string, tab: string, message: string): never {
  const params = new URLSearchParams();
  if (id) {
    if (tab) params.set("tab", tab);
    params.set("err", message);
    redirect(`/projects/${encodeURIComponent(id)}?${params}`);
  }
  params.set("err", message);
  redirect(`/projects?${params}`);
}

function formTab(formData: FormData, fallback: string): string {
  return str(formData, "tab") || fallback;
}

/** Jump/advance a project to a stage (stage tracker node + Advance button). */
export async function setStageAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const id = str(formData, "id");
  const stage = str(formData, "stage") as ProjectStage;
  if (!id || !stage) return;
  const p = await getProject(id);
  if (!p) return;
  try {
    // setProjectStage refuses (null) a stage id outside the record's pipeline.
    if (!await setProjectStage(id, stage, user.name)) {
      projectErrorPath(id, formTab(formData, "overview"), "That project could not be updated — please refresh and try again.");
    }
  } catch (error) {
    console.error("setStageAction failed", error);
    projectErrorPath(id, formTab(formData, "overview"), "Couldn’t update the project stage — please try again.");
  }
  revalidatePath("/", "layout");
}

/** Advance a pending → ordered → shipped → received procurement line (chip tap). */
export async function cycleLineAction(formData: FormData): Promise<void> {
  await requireUser();
  const id = str(formData, "id");
  const lineId = str(formData, "lineId");
  const status = str(formData, "status") as LineStatus;
  if (!id || !lineId || !LINE_STATUSES.includes(status)) return;
  try {
    if (!await setLineStatus(id, lineId, status)) {
      projectErrorPath(id, formTab(formData, "procurement"), "That procurement line could not be updated — please refresh and try again.");
    }
  } catch (error) {
    console.error("cycleLineAction failed", error);
    projectErrorPath(id, formTab(formData, "procurement"), "Couldn’t update that procurement line — please try again.");
  }
  revalidatePath("/", "layout");
}

/** Save the PO number a human typed in for a procurement line (punch #67). Free text from an external system — trimmed, not validated or generated. */
export async function setLinePoAction(formData: FormData): Promise<void> {
  await requireUser();
  const id = str(formData, "id");
  const lineId = str(formData, "lineId");
  const po = str(formData, "po");
  if (!id || !lineId) return;
  try {
    if (!await setLinePo(id, lineId, po)) {
      projectErrorPath(id, formTab(formData, "procurement"), "That procurement line could not be updated — please refresh and try again.");
    }
  } catch (error) {
    console.error("setLinePoAction failed", error);
    projectErrorPath(id, formTab(formData, "procurement"), "Couldn’t save that PO number — please try again.");
  }
  revalidatePath("/", "layout");
}

/** Set a project's contract value by hand — the "fill it in later" path for
 *  a Daylite-imported record that landed with no known value (Task 9
 *  follow-up). Accepts currency-ish input ("$86,400", "86400") from the
 *  overview's inline editor; empty or unparseable input is refused like the
 *  file's other guarded writes. Saving always clears valueUnknown
 *  (setProjectValue's job), even when re-editing an already-known value. */
export async function setProjectValueAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const id = str(formData, "id");
  if (!id) return;
  const cleaned = str(formData, "value").replace(/[^0-9.-]/g, "");
  const value = cleaned === "" ? NaN : Number(cleaned);
  if (!Number.isFinite(value) || value < 0) {
    projectErrorPath(id, formTab(formData, "overview"), "Enter a valid contract value.");
  }
  try {
    if (!await setProjectValue(id, value, user.name)) {
      projectErrorPath(id, formTab(formData, "overview"), "That project could not be updated — please refresh and try again.");
    }
  } catch (error) {
    console.error("setProjectValueAction failed", error);
    projectErrorPath(id, formTab(formData, "overview"), "Couldn’t save the contract value — please try again.");
  }
  revalidatePath("/", "layout");
}

/** Advance a scheduled → in_transit → received delivery (chip tap). */
export async function cycleDeliveryAction(formData: FormData): Promise<void> {
  await requireUser();
  const id = str(formData, "id");
  const deliveryId = str(formData, "deliveryId");
  const status = str(formData, "status") as DeliveryStatus;
  if (!id || !deliveryId || !DELIVERY_STATUSES.includes(status)) return;
  try {
    if (!await setDeliveryStatus(id, deliveryId, status)) {
      projectErrorPath(id, formTab(formData, "deliveries"), "That delivery could not be updated — please refresh and try again.");
    }
  } catch (error) {
    console.error("cycleDeliveryAction failed", error);
    projectErrorPath(id, formTab(formData, "deliveries"), "Couldn’t update that delivery — please try again.");
  }
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
  try {
    if (!await addCrew(id, person)) {
      projectErrorPath(id, formTab(formData, "crew"), "That crew assignment could not be added — please refresh and try again.");
    }
  } catch (error) {
    console.error("addCrewAction failed", error);
    projectErrorPath(id, formTab(formData, "crew"), "Couldn’t add that crew member — please try again.");
  }
  revalidatePath("/", "layout");
}

/** Remove a crew assignment. */
export async function removeCrewAction(formData: FormData): Promise<void> {
  await requireUser();
  const id = str(formData, "id");
  const crewId = str(formData, "crewId");
  if (!id || !crewId) return;
  try {
    if (!await removeCrew(id, crewId)) {
      projectErrorPath(id, formTab(formData, "crew"), "That crew assignment could not be removed — please refresh and try again.");
    }
  } catch (error) {
    console.error("removeCrewAction failed", error);
    projectErrorPath(id, formTab(formData, "crew"), "Couldn’t remove that crew member — please try again.");
  }
  revalidatePath("/", "layout");
}

/** Record customer sign-off at hand-off — moves the job to its closeout stage
 *  (setSignoff). Done, and the #16 follow-up, happen at the Done stage
 *  (setProjectStage's done hook), not here. */
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
  try {
    if (!await setSignoff(id, {
      name,
      role,
      note,
      signature,
      scopeChecks: Object.fromEntries(scopes.map((scope) => [scope, true])),
    }, user.name)) {
      projectErrorPath(id, formTab(formData, "signoff"), "That project could not be signed off — please refresh and try again.");
    }
  } catch (error) {
    console.error("signoffAction: sign-off save failed", error);
    projectErrorPath(id, formTab(formData, "signoff"), "Couldn’t record sign-off — please try again.");
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
  // #180 review: createProjectFromQuote returns null (not a throw) whenever
  // the quote isn't eligible — already converted by someone else, dismissed,
  // not actually won, or a type it refuses outright (flame_test/repair/
  // inspection/consulting, see PUNCHLIST #180 item 3). This used to fall
  // through silently: the button did nothing and nobody was told why.
  redirect(
    "/projects?err=" +
      encodeURIComponent(
        "That quote can't become a project — it may already be converted, have been dismissed, or not be an install/system quote."
      )
  );
}

/* ---- field-side mutations (Field Work reuses these; provided per contract) ---- */

export async function addNoteAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const id = str(formData, "id");
  const text = str(formData, "text").trim();
  if (!id || !text) return;
  try {
    if (!await addNote(id, user.name || undefined, text)) {
      projectErrorPath(id, formTab(formData, "overview"), "That note could not be saved — please refresh and try again.");
    }
  } catch (error) {
    console.error("addNoteAction failed", error);
    projectErrorPath(id, formTab(formData, "overview"), "Couldn’t save that note — please try again.");
  }
  revalidatePath("/", "layout");
}

export async function addTimeAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const id = str(formData, "id");
  const hours = str(formData, "hours");
  if (!id || !hours) return;
  try {
    if (!await addTime(id, user.name || undefined, hours, str(formData, "note").trim())) {
      projectErrorPath(id, formTab(formData, "overview"), "That time entry could not be saved — please refresh and try again.");
    }
  } catch (error) {
    console.error("addTimeAction failed", error);
    projectErrorPath(id, formTab(formData, "overview"), "Couldn’t save that time entry — please try again.");
  }
  revalidatePath("/", "layout");
}

/** Delete one field note (soft delete — flags the embedded entry). Throws on
 *  refusal; the ConfirmButton this feeds shows a thrown Error's message
 *  inline (same convention as removeCustomerNoteAction, companies/actions.ts). */
export async function removeNoteAction(projectId: string, noteId: string): Promise<{ ok: true }> {
  await requireUser();
  if (!projectId || !noteId) throw new Error("Nothing to delete.");
  const p = await removeNote(projectId, noteId);
  if (!p) throw new Error("That project could not be found.");
  revalidatePath("/", "layout");
  return { ok: true };
}

/** Delete one time-log entry — see removeNoteAction above. */
export async function removeTimeAction(projectId: string, entryId: string): Promise<{ ok: true }> {
  await requireUser();
  if (!projectId || !entryId) throw new Error("Nothing to delete.");
  const p = await removeTime(projectId, entryId);
  if (!p) throw new Error("That project could not be found.");
  revalidatePath("/", "layout");
  return { ok: true };
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
  let projectId = str(formData, "id");
  try {
    projectId = (await getTask(taskId))?.projectId || projectId;
    if (!await setTaskStatus(taskId, status as TaskStatus)) {
      projectErrorPath(projectId, formTab(formData, "tasks"), "That task could not be updated — please refresh and try again.");
    }
  } catch (error) {
    console.error("setTaskStatusAction failed", error);
    projectErrorPath(projectId, formTab(formData, "overview"), "Couldn’t update that task — please try again.");
  }
  revalidatePath("/", "layout");
}

export async function updateTaskAction(formData: FormData) {
  await requireUser();
  const taskId = String(formData.get("taskId") || "");
  if (!taskId) return;
  let projectId = str(formData, "id");
  try {
    projectId = (await getTask(taskId))?.projectId || projectId;
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
    if (!await updateTask(taskId, patch)) {
      projectErrorPath(projectId, formTab(formData, "tasks"), "That task could not be updated — please refresh and try again.");
    }
  } catch (error) {
    console.error("updateTaskAction failed", error);
    projectErrorPath(projectId, formTab(formData, "overview"), "Couldn’t update that task — please try again.");
  }
  revalidatePath("/", "layout");
}

/** Delete a project task (soft delete). Parent-agnostic like set-status/update
 *  above — only ever touches taskId — mirroring removeQuoteTaskAction
 *  (estimator/actions.ts) and removeDesignTaskAction (design/designs/actions.ts). */
export async function removeTaskAction(formData: FormData) {
  await requireUser();
  const taskId = String(formData.get("taskId") || "");
  if (!taskId) return;
  await removeTask(taskId);
  revalidatePath("/", "layout");
}

/** Apply a reusable task-template set (D149, #118) to this project — thin
 *  FormData wrapper over task-templates.ts's applyTaskTemplate(), mirroring
 *  addTaskAction's own no-op-on-bad-input convention above. */
export async function applyProjectTemplateAction(formData: FormData): Promise<{ ok: true } | { ok: false; error: string } | void> {
  const me = await requireUser();
  const projectId = String(formData.get("id") || "");
  const setId = String(formData.get("setId") || "");
  if (!projectId || !setId) return;
  try {
    await applyTaskTemplate(setId, { kind: "project", id: projectId }, me);
  } catch (error) {
    console.error("applyProjectTemplateAction: task template failed", error);
    return { ok: false, error: error instanceof Error ? error.message : "Couldn’t apply that template — please try again." };
  }
  revalidatePath("/", "layout");
}

/**
 * Delete a project/order (soft delete — removeProject records the source
 * quote on the dismissed list so syncFromQuotes never re-creates it, #169).
 * Called directly from the project view's Delete control, not a form
 * action, so it never calls redirect() itself — the client navigates to
 * the book on success.
 */
export async function removeProjectAction(id: string): Promise<{ ok: true } | { ok: false; error: string }> {
  await requireUser();
  if (!id) return { ok: false, error: "Missing project id." };
  const p = await getProject(id);
  if (!p) return { ok: false, error: "That project could not be found." };
  await removeProject(id);
  revalidatePath("/", "layout");
  return { ok: true };
}
