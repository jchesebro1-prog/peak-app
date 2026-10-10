/**
 * One-time due-date backfill (spec Part 1 "Due dates"): existing open,
 * assigned, undated tasks and Queue assignments get due dates spread over the
 * next 4 weeks of each person's work days, oldest first. Dry run by default;
 * `apply` writes. Idempotent: a write lands only while the item is still
 * undated, and a second run finds nothing. CLI: scripts/backfill-task-due.ts.
 */
import { patchDoc } from "@/db/doc-store";
import { allAssignments, type Assignment } from "@/lib/stores/assignments";
import { workHoursFor } from "@/lib/stores/schedule-prefs";
import { allTasks, patchTask, type TaskRecord } from "@/lib/stores/tasks";
import { activeUsers } from "@/lib/users";
import type { WorkHours } from "@/lib/visit-plan/settings";
import { planDueBackfill, type BackfillItem, type BackfillPlan } from "./due";
import { isPlannedTask, personForAssignment, personForTask, type RosterPerson } from "./people";

export type BackfillDeps = {
  now(): number;
  roster(): Promise<RosterPerson[]>;
  tasks(): Promise<TaskRecord[]>;
  assignments(): Promise<Assignment[]>;
  workHours(userId: string): Promise<WorkHours>;
  /** true when it wrote (the item was still undated) */
  setTaskDue(id: string, dueAt: number): Promise<boolean>;
  setAssignmentDue(id: string, dueAt: number): Promise<boolean>;
};

function defaultDeps(): BackfillDeps {
  return {
    now: Date.now,
    roster: async () => (await activeUsers()).map((u) => ({ id: u.id, name: u.name })),
    tasks: allTasks,
    assignments: allAssignments,
    workHours: workHoursFor,
    setTaskDue: async (id, dueAt) => {
      const r = { wrote: false };
      await patchTask(id, (t) => {
        if (!(typeof t.dueAt === "number" && t.dueAt > 0)) {
          t.dueAt = dueAt;
          r.wrote = true;
        }
        return t;
      });
      return r.wrote;
    },
    setAssignmentDue: async (id, dueAt) => {
      const r = { wrote: false };
      await patchDoc<Assignment>("assignments", id, (d) => {
        if (!(Number(d.dueDate) > 0)) {
          d.dueDate = dueAt;
          r.wrote = true;
        }
      });
      return r.wrote;
    },
  };
}

export async function runDueBackfill(opts: {
  apply: boolean;
  deps?: Partial<BackfillDeps>;
}): Promise<{ apply: boolean; planned: number; updated: number; plan: BackfillPlan }> {
  const d: BackfillDeps = { ...defaultDeps(), ...opts.deps };
  const [roster, tasks, assignments] = await Promise.all([d.roster(), d.tasks(), d.assignments()]);
  const items: BackfillItem[] = [];
  for (const t of tasks) {
    if (!isPlannedTask(t) || (t.dueAt ?? 0) > 0) continue;
    const p = personForTask(t, roster);
    if (p) items.push({ kind: "task", id: t.id, person: p.id, personName: p.name, createdAt: t.createdAt || 0 });
  }
  for (const a of assignments) {
    if (a.done || Number(a.dueDate) > 0) continue;
    const p = personForAssignment(a, roster);
    if (p) items.push({ kind: "assignment", id: a.id, person: p.id, personName: p.name, createdAt: a.createdAt || 0 });
  }
  const people = [...new Set(items.map((i) => i.person))];
  const hours = new Map(await Promise.all(people.map(async (id) => [id, await d.workHours(id)] as const)));
  const plan = planDueBackfill({ items, hoursByPerson: hours, nowMs: d.now() });
  let updated = 0;
  if (opts.apply) {
    for (const u of plan.updates) {
      const wrote = u.kind === "task" ? await d.setTaskDue(u.id, u.dueAt) : await d.setAssignmentDue(u.id, u.dueAt);
      if (wrote) updated++;
    }
  }
  return { apply: opts.apply, planned: plan.updates.length, updated, plan };
}
