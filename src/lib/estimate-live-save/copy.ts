/** Estimator live save — the words (pure, client-safe). */
import type { LiveConflict, LiveStatus } from "./scheduler";

export const LIVE_COPY = {
  changedElsewhere: "This estimate changed somewhere else.",
  reload: "Reload",
  keepMine: "Keep mine",
  reloadHint: "Reload drops the changes in this window that aren't saved yet.",
  keepMineHint: "Keep mine replaces what was saved elsewhere with this window's version.",
  historyEmpty: "Nothing to undo",
  redoEmpty: "Nothing to redo",
  notSavedYet: "Not saved yet",
  notSavedYetHint: "A new estimate saves itself when you add its first line.",
};

export function chipLabel(status: LiveStatus): string {
  if (status === "saved") return "Saved ✓";
  if (status === "failed") return "Not saved — Retry";
  if (status === "refused" || status === "conflict") return "Not saved";
  return "Saving…";
}

const timeOf = (at: number) => new Date(at).toLocaleTimeString("en-US", { timeZone: "America/Chicago", hour: "numeric", minute: "2-digit" });

export function conflictMessage(c: LiveConflict): string {
  if (!c.by) return LIVE_COPY.changedElsewhere;
  return `This estimate changed somewhere else — saved by ${c.by}${c.at ? ` at ${timeOf(c.at)}` : ""}.`;
}
