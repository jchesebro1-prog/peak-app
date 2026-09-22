"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/session";
import { can } from "@/lib/team";
import {
  approveDesign,
  claimDesignReview,
  createDesign,
  getDesign,
  promoteDesignToQuote,
  removeDesign,
  requestDesignChanges,
  submitDesignForReview,
  updateDesign,
  type DesignRecord,
} from "@/lib/stores/designs";
import { createProject, removeProject as removeGridProject } from "@/lib/stores/grid-projects";
import { createDraftQuoteAction } from "../grid/[id]/actions";

/**
 * Design dashboard server actions — promote-to-quote plus the design
 * review/approval workflow (shared with Quick Design's review banner).
 */

/** Start a new manual-layout design: a linked, empty Grid project + the
 *  design record that points at it (D-grid-merge). The caller navigates
 *  into the returned project's editor — that's where naming, customer and
 *  plan-sheet upload happen, same as The Grid's old standalone flow. */
export async function createManualDesignAction(): Promise<
  { ok: true; id: string; gridProjectId: string } | { ok: false; error: string }
> {
  const user = await requireUser();
  const project = await createProject({ name: "", customer: "", customerId: null, by: user.name });
  const design = await createDesign({
    name: project.name,
    owner: user.name,
    layoutMode: "manual",
    gridProjectId: project.id,
  });
  revalidatePath("/design/designs");
  return { ok: true, id: design.id, gridProjectId: project.id };
}

/**
 * Promote a budgetary design into the quotes pipeline. Port of
 * Design.dc.html promoteDesign(id), branched by layout mode (D-grid-merge):
 * manual-layout designs delegate entirely to The Grid's own BOM/quote logic
 * (createDraftQuoteAction) so the numbers on the quote are exactly what the
 * plan-sheet editor priced, then mirror the resulting quoteId back onto the
 * design record; quick designs keep going through the shared sandbox flow.
 * Neither path deletes the design anymore — see promoteDesignToQuote.
 */
// Punch #75: shared flow lives in promoteDesignToQuote(); this used to be a near-identical duplicate of the other copy, which is how #65's missing tier stamp happened.
export async function promoteDesignAction(
  id: string
): Promise<{ ok: true; quoteId: string } | { ok: false; error: string }> {
  const user = await requireUser();
  const d = await getDesign(id);
  if (!d) return { ok: false, error: "Design not found." };

  if (d.layoutMode === "manual") {
    if (!d.gridProjectId) return { ok: false, error: "This design has no linked Grid project." };
    const result = await createDraftQuoteAction(d.gridProjectId, null);
    if (!result.ok) return { ok: false, error: result.error };
    await updateDesign(id, { quoteId: result.quoteId });
    revalidatePath("/design/designs");
    revalidatePath("/quotes");
    return { ok: true, quoteId: result.quoteId };
  }

  const q = await promoteDesignToQuote(id, user.name);
  if (!q) return { ok: false, error: "Design not found." };
  revalidatePath("/design/designs");
  revalidatePath("/quotes");
  return { ok: true, quoteId: q.id };
}

/**
 * Delete a design, cascading to the Grid project behind a manual-layout one
 * (D-grid-merge). The standalone Grid index owned the only delete control in
 * the app (design/grid/delete-button.tsx) and the merge removed it without a
 * replacement, so no design or Grid project could be deleted by any route.
 * Promotion stopped deleting designs in the same commit, so this is now the
 * only way the list ever shrinks.
 *
 * Gated on `create` rather than `approve`: a Reviewer can approve a design but
 * has never been able to make one, so it should not be able to destroy one.
 */
export async function deleteDesignAction(
  id: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  const user = await requireUser();
  if (!can("create", user.roles)) return { ok: false, error: "You can't delete designs." };
  const d = await getDesign(id);
  if (!d) return { ok: false, error: "Design not found." };
  // Grid project first: if the design row survives a failure here it still
  // points at its project, which is recoverable. The reverse leaves an
  // orphan project with nothing linking to it (#74 — no transactions).
  if (d.layoutMode === "manual" && d.gridProjectId) {
    await removeGridProject(d.gridProjectId);
  }
  await removeDesign(id);
  revalidatePath("/design/designs");
  revalidatePath("/design");
  return { ok: true };
}

/* ---- review & approval workflow (sandbox.js parity, session-actored) ---- */

export async function submitDesignReviewAction(
  id: string,
  reviewer: string | null
): Promise<{ ok: true; record: DesignRecord } | { ok: false; error: string }> {
  const user = await requireUser();
  const d = await submitDesignForReview(id, { by: user.name, reviewer: reviewer || null });
  if (!d) return { ok: false, error: "Design not found." };
  revalidatePath("/design/designs");
  return { ok: true, record: d };
}

export async function claimDesignReviewAction(
  id: string
): Promise<{ ok: true; record: DesignRecord } | { ok: false; error: string }> {
  const user = await requireUser();
  if (!can("approve", user.roles)) return { ok: false, error: "You can't review designs." };
  const d = await claimDesignReview(id, user.name);
  if (!d) return { ok: false, error: "Design not found." };
  revalidatePath("/design/designs");
  return { ok: true, record: d };
}

export async function approveDesignAction(
  id: string
): Promise<{ ok: true; record: DesignRecord } | { ok: false; error: string }> {
  const user = await requireUser();
  if (!can("approve", user.roles)) return { ok: false, error: "You can't approve designs." };
  const d = await approveDesign(id, { by: user.name });
  if (!d) return { ok: false, error: "Design not found." };
  revalidatePath("/design/designs");
  return { ok: true, record: d };
}

export async function requestDesignChangesAction(
  id: string,
  note: string
): Promise<{ ok: true; record: DesignRecord } | { ok: false; error: string }> {
  const user = await requireUser();
  if (!can("approve", user.roles)) return { ok: false, error: "You can't review designs." };
  if (!note.trim()) return { ok: false, error: "A note is required." };
  const d = await requestDesignChanges(id, { by: user.name, note: note.trim() });
  if (!d) return { ok: false, error: "Design not found." };
  revalidatePath("/design/designs");
  return { ok: true, record: d };
}

/** Fresh record for client-side refresh after actions. */
export async function getDesignAction(id: string): Promise<DesignRecord | null> {
  await requireUser();
  return getDesign(id);
}
