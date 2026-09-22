"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/session";
import { can } from "@/lib/team";
import {
  createTaskTemplateSet,
  removeTaskTemplateSet,
  updateTaskTemplateSet,
  type TaskTemplateSetRecord,
  type TaskTemplateLine,
  type TemplateRecordKind,
} from "@/lib/stores/task-templates";

/**
 * Admin authoring for reusable task-template sets (D149, #118). Gated on
 * `manage_users` — the closest existing permission fit (see DECISIONS.md
 * D149); there is no dedicated "manage templates" permission and this
 * screen edits data every team member's tasks are minted from, same
 * sensitivity class as Estimating Rules and the team roster itself.
 *
 * `saveTaskTemplateSetAction` takes the WHOLE record (mirroring
 * design/assemblies' saveFixtureAssembliesAction pattern) rather than
 * per-field mutators: the client editor holds the full set — name,
 * description, appliesTo, and every line — as one piece of local state, and
 * a line's own edits (title/section/target) never need a server round trip
 * until Save is pressed.
 */

export type TaskTemplateSetInput = {
  id: string | null; // null -> create
  name: string;
  description: string;
  appliesTo: TemplateRecordKind[];
  lines: TaskTemplateLine[];
};

export async function saveTaskTemplateSetAction(
  input: TaskTemplateSetInput
): Promise<{ ok: true; record: TaskTemplateSetRecord } | { ok: false; error: string }> {
  const user = await requireUser();
  if (!can("manage_users", user.roles)) return { ok: false, error: "You don't have access to task templates." };
  const name = input.name.trim();
  if (!name) return { ok: false, error: "Name is required." };
  if (!input.appliesTo.length) return { ok: false, error: "Pick at least one record type this template applies to." };

  const lines = input.lines
    .map((l) => ({ ...l, title: l.title.trim() }))
    .filter((l) => l.title);

  let record: TaskTemplateSetRecord | null;
  if (input.id) {
    record = await updateTaskTemplateSet(input.id, {
      name,
      description: input.description.trim(),
      appliesTo: input.appliesTo,
      lines,
    });
    if (!record) return { ok: false, error: "Template set not found." };
  } else {
    record = await createTaskTemplateSet(
      { name, description: input.description.trim(), appliesTo: input.appliesTo, lines },
      user
    );
  }
  revalidatePath("/task-templates");
  return { ok: true, record };
}

export async function archiveTaskTemplateSetAction(
  id: string,
  archived: boolean
): Promise<{ ok: true; record: TaskTemplateSetRecord } | { ok: false; error: string }> {
  const user = await requireUser();
  if (!can("manage_users", user.roles)) return { ok: false, error: "You don't have access to task templates." };
  const record = await updateTaskTemplateSet(id, { archived });
  if (!record) return { ok: false, error: "Template set not found." };
  revalidatePath("/task-templates");
  return { ok: true, record };
}

export async function deleteTaskTemplateSetAction(
  id: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  const user = await requireUser();
  if (!can("manage_users", user.roles)) return { ok: false, error: "You don't have access to task templates." };
  await removeTaskTemplateSet(id);
  revalidatePath("/task-templates");
  return { ok: true };
}
