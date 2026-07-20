import { getDoc, upsertDoc } from "@/db/doc-store";
import type { EngagementDoc, EngagementPhase } from "@/lib/stores/engagements";

/* ------------------------------------------------------------------ *
 * Frozen approval snapshots (D92).
 * Design: docs/superpowers/specs/2026-07-19-review-markup-accountability-design.md
 *
 * When a phase review is approved, the exact files reviewed are copied here
 * and never touched again. The engagement document keeps only lightweight
 * pointers (ApprovalPin.docs) so it stays small; the heavy data-URL payloads
 * live in these standalone docs.
 *
 * Immutability is the whole point: if the original attachment is replaced or
 * deleted later, the approved artifact is still retrievable, and the phase
 * shows the approval as stale (approvalIsStale) rather than quietly
 * inheriting the new file.
 * ------------------------------------------------------------------ */

function uid(p: string): string {
  return p + Math.random().toString(36).slice(2, 10);
}

export type ReviewSnapshot = {
  id: string; // uid('rs-')
  engagementId: string;
  phaseId: string;
  phaseName: string;
  frozenAt: number;
  frozenBy: string;
  /** Verbatim copies of the attachments as they stood at approval. */
  docs: EngagementDoc[];
};

/** Copy the phase's attachments into an immutable snapshot doc. Returns the
 *  snapshot id to pin on the approval, or null when there was nothing to
 *  freeze (an approval with no documents is legitimate — a review of work
 *  that produced no artifact). */
export async function freezeApprovalSnapshot(
  engagementId: string,
  phase: EngagementPhase,
  by: string
): Promise<string | null> {
  const docs = phase.attachments || [];
  if (!docs.length) return null;
  const snap: ReviewSnapshot = {
    id: uid("rs-"),
    engagementId,
    phaseId: phase.id,
    phaseName: phase.name,
    frozenAt: Date.now(),
    frozenBy: by,
    // Deep-copied on write: later mutation of the live attachment array must
    // not reach through into the snapshot.
    docs: docs.map((d) => ({ ...d })),
  };
  await upsertDoc<ReviewSnapshot>("review_snapshots", snap);
  return snap.id;
}

export async function getSnapshot(id: string): Promise<ReviewSnapshot | null> {
  return getDoc<ReviewSnapshot>("review_snapshots", id);
}
