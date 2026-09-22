import {
  listDocs, getDoc, patchDoc, softDeleteDoc, insertWithPrefixedId,
} from "@/db/doc-store";
import { activeUsers } from "@/lib/users";
import type { Role } from "@/lib/team";
import {
  createAutoTask, expandTemplate, tasksForProject, tasksForQuote, tasksForDesign,
  type TaskRecord, type TaskTemplateItem,
} from "@/lib/stores/tasks";
import { getProject } from "@/lib/stores/projects";
import { get as getQuote } from "@/lib/stores/quotes";
import { getDesign } from "@/lib/stores/designs";

/* ============================================================
   Task template sets (D149, #118) — Jeff's ask: "add template tasks
   to projects, quotes, and designs that can be assigned based on
   groups, people, or teams." A NEW, separate, admin-editable
   mechanism — distinct from tasks.ts's TASK_TEMPLATE constant, which
   is per-project-stage, hardcoded, and always unassigned, and is left
   completely untouched by this feature.

   A set is a named, reusable list of lines (title + optional section
   + an assignment target), tagged with which record kinds it applies
   to (a set can cover more than one of project/quote/design). Applying
   a set to a record fans role/team lines out into one real task per
   matching active user (see applyTaskTemplate) and reuses tasks.ts's
   own expandTemplate() for the coverage-key dedup, so re-applying the
   same set to the same record is additive, not duplicative — same
   idiom as the per-stage project template and the Grid's seeded-layout
   re-run (D147).

   Assignment-target mapping (logged in DECISIONS.md D149): the data
   model has no "department"/"crew"/"team" concept distinct from the
   permission-oriented Role enum in lib/team.ts (Admin/Manager/
   Estimator/Reviewer) — confirmed by grepping the users table and
   team.ts before designing this. So:
     - "person"  -> a specific assigneeUserId, same as a manual task.
     - "role"    -> one task PER active user holding that Role.
     - "team"    -> one task PER active user, i.e. everyone.
   This is the closest fit to "groups, people, or teams" the real data
   model supports; a genuine department/crew grouping is a bigger,
   separate ask and is logged as an open follow-up rather than invented
   here.
   ============================================================ */

const now = () => Date.now();

// Kinds + labels live in a DB-free module (client components import them);
// re-exported here so server-side importers keep one entry point.
import { TEMPLATE_RECORD_KINDS, TEMPLATE_RECORD_LABEL, type TemplateRecordKind } from "@/lib/task-template-kinds";
export { TEMPLATE_RECORD_KINDS, TEMPLATE_RECORD_LABEL, type TemplateRecordKind };

export type TemplateAssignTarget =
  | { kind: "person"; userId: string }
  | { kind: "role"; role: Role }
  | { kind: "team" };

export type TaskTemplateLine = {
  key: string;      // stable within the set — the fan-out/coverage-key seed (see applyTaskTemplate)
  title: string;
  section: string;
  target: TemplateAssignTarget;
};

export type TaskTemplateSetRecord = {
  id: string;                       // "TT-###" (base 100)
  name: string;
  description: string;
  appliesTo: TemplateRecordKind[];  // which record kinds this set can be applied to
  lines: TaskTemplateLine[];
  archived: boolean;                // hidden from "Apply template" pickers; never hard-deleted lines
  createdBy: string;
  createdAt: number;
  updatedAt: number;
};

function normalizeTarget(raw: unknown): TemplateAssignTarget {
  const t = (raw && typeof raw === "object" ? raw : {}) as Partial<TemplateAssignTarget> & Record<string, unknown>;
  if (t.kind === "person" && typeof t.userId === "string" && t.userId) {
    return { kind: "person", userId: t.userId };
  }
  if (t.kind === "role" && typeof t.role === "string" && t.role) {
    return { kind: "role", role: t.role as Role };
  }
  return { kind: "team" };
}

function normalizeLine(raw: unknown): TaskTemplateLine {
  const l = (raw && typeof raw === "object" ? raw : {}) as Partial<TaskTemplateLine>;
  return {
    key: l.key || Math.random().toString(36).slice(2, 10),
    title: l.title || "Untitled task",
    section: l.section || "",
    target: normalizeTarget(l.target),
  };
}

function normalizeSet(raw: Partial<TaskTemplateSetRecord> & { id: string }): TaskTemplateSetRecord {
  const at = raw.createdAt ?? now();
  const appliesTo = Array.isArray(raw.appliesTo)
    ? raw.appliesTo.filter((k): k is TemplateRecordKind => TEMPLATE_RECORD_KINDS.includes(k as TemplateRecordKind))
    : [];
  return {
    id: raw.id,
    name: raw.name || "Untitled template",
    description: raw.description ?? "",
    appliesTo,
    lines: Array.isArray(raw.lines) ? raw.lines.map(normalizeLine) : [],
    archived: !!raw.archived,
    createdBy: raw.createdBy ?? "",
    createdAt: at,
    updatedAt: raw.updatedAt ?? at,
  };
}

/* ---------- CRUD (admin authoring — gated on manage_users in the server actions) ---------- */

export async function allTaskTemplateSets(): Promise<TaskTemplateSetRecord[]> {
  const rows = await listDocs<TaskTemplateSetRecord>("task_templates");
  return rows.map(normalizeSet).sort((a, b) => a.name.localeCompare(b.name));
}

/** Non-archived sets that apply to one record kind — what an "Apply template" picker offers. */
export async function taskTemplateSetsFor(kind: TemplateRecordKind): Promise<TaskTemplateSetRecord[]> {
  return (await allTaskTemplateSets()).filter((s) => !s.archived && s.appliesTo.includes(kind));
}

export async function getTaskTemplateSet(id: string): Promise<TaskTemplateSetRecord | null> {
  const doc = await getDoc<TaskTemplateSetRecord>("task_templates", id);
  return doc ? normalizeSet(doc) : null;
}

export async function createTaskTemplateSet(
  input: { name: string; description?: string; appliesTo: TemplateRecordKind[]; lines?: TaskTemplateLine[] },
  me: { name: string },
): Promise<TaskTemplateSetRecord> {
  const at = now();
  return insertWithPrefixedId<TaskTemplateSetRecord>("task_templates", "TT", 100, (id) =>
    normalizeSet({
      id,
      name: input.name,
      description: input.description || "",
      appliesTo: input.appliesTo,
      lines: input.lines || [],
      archived: false,
      createdBy: me.name,
      createdAt: at,
      updatedAt: at,
    })
  );
}

export async function updateTaskTemplateSet(
  id: string,
  patch: Partial<Pick<TaskTemplateSetRecord, "name" | "description" | "appliesTo" | "lines" | "archived">>,
): Promise<TaskTemplateSetRecord | null> {
  return patchDoc<TaskTemplateSetRecord>("task_templates", id, (s) => {
    if (patch.name !== undefined) s.name = patch.name;
    if (patch.description !== undefined) s.description = patch.description;
    if (patch.appliesTo !== undefined) s.appliesTo = patch.appliesTo;
    if (patch.lines !== undefined) s.lines = patch.lines;
    if (patch.archived !== undefined) s.archived = patch.archived;
    s.updatedAt = now();
    return s;
  });
}

export async function removeTaskTemplateSet(id: string): Promise<void> {
  await softDeleteDoc("task_templates", id);
}

/* ---------- apply a set to a record ---------- */

export type ApplyTemplateTarget = { kind: TemplateRecordKind; id: string };

async function tasksForTarget(target: ApplyTemplateTarget): Promise<TaskRecord[]> {
  if (target.kind === "project") return tasksForProject(target.id);
  if (target.kind === "quote") return tasksForQuote(target.id);
  return tasksForDesign(target.id);
}

export type ApplyTemplateResult = {
  set: TaskTemplateSetRecord;
  created: TaskRecord[];
  /** Instances the dedup already covered (a prior apply, or a race) — not an error. */
  skipped: number;
};

/**
 * Apply a template set to one project/quote/design. Fans each line out to
 * one concrete task per matching person (see the module doc comment for the
 * person/role/team mapping), then creates them through tasks.ts's own
 * expandTemplate() + createAutoTask() — the SAME coverage-key dedup the
 * per-stage project template already uses (projects.ts's setProjectStage),
 * so re-applying a set to the same record only ever adds instances that
 * don't already exist (a newly-hired Estimator added to a role target after
 * the first apply gets their task on the next apply; everyone else's rows
 * are untouched).
 */
export async function applyTaskTemplate(
  setId: string,
  target: ApplyTemplateTarget,
  appliedBy: { name: string },
): Promise<ApplyTemplateResult> {
  const set = await getTaskTemplateSet(setId);
  if (!set) throw new Error("Template set not found: " + setId);
  if (!set.appliesTo.includes(target.kind)) {
    throw new Error(`"${set.name}" isn't set up to apply to ${TEMPLATE_RECORD_LABEL[target.kind].toLowerCase()}.`);
  }
  // Confirm the target actually exists (and is the kind claimed) before
  // minting any tasks against it — a bad id (mistyped, or a caller passing
  // a quote id under a "project" target) must fail here, not create tasks
  // pointed at a projectId/quoteId/designId nothing else will ever read.
  const record =
    target.kind === "project" ? await getProject(target.id)
    : target.kind === "quote" ? await getQuote(target.id)
    : await getDesign(target.id);
  if (!record) {
    throw new Error(`That ${TEMPLATE_RECORD_LABEL[target.kind].toLowerCase()} could not be found.`);
  }

  const users = await activeUsers();

  // Each fanned-out instance carries its own key so expandTemplate's
  // dedup treats "line X for user Y" as its own unit. Person-target lines
  // keep the line's own key (one instance, same as a manual task);
  // role/team lines suffix the user id so N users never collide.
  type Instance = { key: string; title: string; section: string; assigneeUserId: string | null; assigneeName: string };
  const instances: Instance[] = [];
  for (const line of set.lines) {
    if (line.target.kind === "person") {
      const userId = line.target.userId;
      const u = users.find((u) => u.id === userId);
      instances.push({
        key: line.key, title: line.title, section: line.section,
        assigneeUserId: userId, assigneeName: u?.name || "",
      });
    } else if (line.target.kind === "role") {
      const role = line.target.role;
      for (const u of users.filter((u) => (u.roles || []).includes(role))) {
        instances.push({
          key: line.key + "::" + u.id, title: line.title, section: line.section,
          assigneeUserId: u.id, assigneeName: u.name,
        });
      }
    } else {
      for (const u of users) {
        instances.push({
          key: line.key + "::" + u.id, title: line.title, section: line.section,
          assigneeUserId: u.id, assigneeName: u.name,
        });
      }
    }
  }

  const byKey = new Map(instances.map((i) => [i.key, i]));
  const items: TaskTemplateItem[] = instances.map((i) => ({ key: i.key, title: i.title, section: i.section }));

  // Record-scoped stage (expandTemplate's own requirement, see tasks.ts) —
  // keyed by set AND target so applying two different sets, or the same set
  // to two different records, never collides.
  const stage = "tpl:" + setId + ":" + target.kind + ":" + target.id;
  const existing = new Set(
    (await tasksForTarget(target)).map((t) => t.coverageKey).filter((k): k is string => !!k)
  );
  const toCreate = expandTemplate(items, stage, existing);

  const created: TaskRecord[] = [];
  for (const item of toCreate) {
    const inst = byKey.get(item.coverageKey.slice(stage.length + 1));
    const t = await createAutoTask({
      title: item.title,
      section: item.section,
      coverageKey: item.coverageKey,
      projectId: target.kind === "project" ? target.id : null,
      quoteId: target.kind === "quote" ? target.id : null,
      designId: target.kind === "design" ? target.id : null,
      assigneeUserId: inst?.assigneeUserId ?? null,
      assigneeName: inst?.assigneeName ?? "",
      createdBy: appliedBy.name,
    });
    if (t) created.push(t);
  }

  return { set, created, skipped: toCreate.length - created.length };
}
