import { getDoc, listDocs, patchDoc, upsertDoc } from "@/db/doc-store";

/* ------------------------------------------------------------------ *
 * Assignments (D93) — the ONE new record behind My Queue.
 * Design: docs/superpowers/specs/2026-07-19-work-queue-reminders-sync-design.md
 *
 * Everything else in the queue is derived from records that already exist
 * (reviews, checklist items, milestones, project tasks, renewals), so it can
 * never drift out of sync with reality. Assignments cover the one case that
 * is NOT derivable: somebody asking somebody else to do a thing.
 *
 * Deliberately minimal — no subtasks, priorities, recurrence, or tags. The
 * app is a task SOURCE; Apple Reminders stays the place Jeff actually looks,
 * and competing with it is how this turns into the to-do app nobody wanted.
 * ------------------------------------------------------------------ */

function uid(p: string): string {
  return p + Math.random().toString(36).slice(2, 10);
}

/** Where an assignment came from, so a completed one can be traced back. */
export type AssignmentLink = {
  kind: "company" | "engagement" | "project" | "quote";
  id: string;
  label: string;
} | null;

export type Assignment = {
  id: string; // uid('as-')
  title: string;
  /** Team-member NAME (app convention — see EngagementPerson.person). */
  assignee: string;
  createdBy: string;
  createdAt: number;
  /** epoch-ms; 0 = no date. */
  dueDate: number;
  link: AssignmentLink;
  done: boolean;
  doneAt: number | null;
  /** Which surface completed it. `reminders` is written by the Mac-side sync
   *  agent through /api/queue, and is why write-back is restricted to this
   *  record type: a phone checkbox must never approve a review. */
  doneVia: "app" | "reminders" | null;
  /** Provenance when a pipeline suggested it (iMessage/Krisp) and a human
   *  confirmed — free text, e.g. "iMessage from Jena, 2026-07-19". */
  source: string;
};

export async function allAssignments(): Promise<Assignment[]> {
  const list = await listDocs<Assignment>("assignments");
  return list.sort((a, b) => {
    if (a.done !== b.done) return a.done ? 1 : -1;
    const ad = a.dueDate || Number.MAX_SAFE_INTEGER;
    const bd = b.dueDate || Number.MAX_SAFE_INTEGER;
    if (ad !== bd) return ad - bd;
    return b.createdAt - a.createdAt;
  });
}

export async function openAssignmentsFor(assignee: string): Promise<Assignment[]> {
  const all = await allAssignments();
  return all.filter((a) => !a.done && a.assignee === assignee);
}

export async function createAssignment(input: {
  title: string;
  assignee: string;
  createdBy: string;
  dueDate?: number;
  link?: AssignmentLink;
  source?: string;
}): Promise<Assignment> {
  const rec: Assignment = {
    id: uid("as-"),
    title: input.title.trim(),
    assignee: input.assignee.trim(),
    createdBy: input.createdBy,
    createdAt: Date.now(),
    dueDate: Number(input.dueDate) || 0,
    link: input.link || null,
    done: false,
    doneAt: null,
    doneVia: null,
    source: (input.source || "").trim(),
  };
  await upsertDoc<Assignment>("assignments", rec);
  return rec;
}

export async function setAssignmentDone(
  id: string,
  done: boolean,
  via: "app" | "reminders" = "app"
): Promise<void> {
  await patchDoc<Assignment>("assignments", id, (d) => {
    d.done = done;
    d.doneAt = done ? Date.now() : null;
    d.doneVia = done ? via : null;
  });
}

export async function updateAssignment(
  id: string,
  patch: Partial<Pick<Assignment, "title" | "assignee" | "dueDate" | "link">>
): Promise<void> {
  await patchDoc<Assignment>("assignments", id, (d) => {
    Object.assign(d, patch);
  });
}

export async function getAssignment(id: string): Promise<Assignment | null> {
  return getDoc<Assignment>("assignments", id);
}
