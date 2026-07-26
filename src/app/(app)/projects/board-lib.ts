import type { ProjectKind } from "@/lib/stores/projects";

/**
 * Projects board helpers (#19) — pure, type-only store import, so the spec
 * harness exercises them without touching the DB.
 */

/** Board mode shows INSTALLS only — ORDER_STAGES is a different 4-stage
 *  vocabulary; orders keep the master-detail list (decision A, spec §3). */
export function boardProjects<T extends { kind: ProjectKind }>(rows: T[]): T[] {
  return rows.filter((r) => r.kind === "project");
}

/** The list card's due/age chip, extracted verbatim from view.tsx (was
 *  inline at the listSrc.map card, ~line 510) so the board card and the
 *  list row always agree — and so it's testable. */
export function dueChipLabel(stage: string, due: number, closedDate: string): string {
  if (stage === "complete") return "Closed " + closedDate;
  if (due < 0) return Math.abs(due) + "d overdue";
  if (due === 0) return "Due today";
  return "Due in " + due + "d";
}
