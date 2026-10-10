/** Who an item is planned for (spec Part 1 "What is scheduled"). Pure, client-safe. */
import { sameName } from "@/lib/quote-approval-rules";
import type { Assignment } from "@/lib/stores/assignments";
import type { TaskRecord } from "@/lib/stores/tasks";

export type RosterPerson = { id: string; name: string };

/** Open or In progress. A Blocked task waits — it can't be worked. */
export function isPlannedTask(t: Pick<TaskRecord, "status">): boolean {
  return t.status === "open" || t.status === "in_progress";
}

/** The assignee's user id when it's on the roster, else the assignee name (legacy name-only tasks). */
export function personForTask(t: Pick<TaskRecord, "assigneeUserId" | "assigneeName">, roster: readonly RosterPerson[]): RosterPerson | null {
  if (t.assigneeUserId) {
    const hit = roster.find((u) => u.id === t.assigneeUserId);
    if (hit) return hit;
  }
  return t.assigneeName ? (roster.find((u) => sameName(u.name, t.assigneeName)) ?? null) : null;
}

/** Assignments carry a team-member NAME (app convention). */
export function personForAssignment(a: Pick<Assignment, "assignee">, roster: readonly RosterPerson[]): RosterPerson | null {
  return a.assignee ? (roster.find((u) => sameName(u.name, a.assignee)) ?? null) : null;
}
