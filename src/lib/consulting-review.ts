import type {
  ChecklistItem,
  EngagementPhase,
  ReviewComment,
} from "@/lib/stores/engagements";

/**
 * Pure review-status helpers (D91/D92) — no doc-store, no db imports, so the
 * client view can import the VALUES without dragging PGlite into the browser
 * bundle. Same lesson as `consulting/tabs.ts` in D90: anything a "use client"
 * module needs at runtime must live in a dependency-free file.
 *
 * Type-only imports above are erased at compile time and stay safe.
 */

/** Items still blocking approval — open only. Checked and waived both clear
 *  the gate; waiving simply demands a recorded reason. */
export function openChecklistItems(ph: EngagementPhase): ChecklistItem[] {
  return (ph.checklist || []).filter((c) => c.state === "open");
}

export function openComments(ph: EngagementPhase): ReviewComment[] {
  return (ph.comments || []).filter((c) => c.state === "open");
}

/**
 * An approval goes stale when the phase's attachment set no longer matches
 * what was pinned at approval — i.e. a revised drawing landed afterwards.
 * Derived rather than stored, so it can never disagree with the documents.
 */
export function approvalIsStale(ph: EngagementPhase): boolean {
  const pin = ph.approvalPin;
  if (!pin) return false;
  const now = ph.attachments.map((a) => `${a.id}:${a.addedAt}`).sort();
  const then = pin.docs.map((d) => `${d.docId}:${d.version}`).sort();
  return now.join("|") !== then.join("|");
}

/** The open-until-Closed rule (D113 item 11 carried into the six-stage
 *  lifecycle, spec §1) now lives in consulting-stages with the other pure
 *  stage helpers — re-exported here so existing imports keep working. */
export { isOpenEngagement } from "@/lib/consulting-stages";
