/**
 * Seeding action (#38): "generate starting layout from dims" paints a
 * small, real, editable starter set — a couple of rigging pipes and a
 * front curtain-hardware position — onto a fresh (or not-so-fresh) plan.
 * This is intentionally a small, conservative starter set, not a full
 * parametric guess like the Quick estimator's goods.ts — the point is
 * "something real to edit," not "a complete system."
 *
 * `dims`/`existingCount` are accepted (not read yet) so the signature is
 * already the one a future dims-aware layout — e.g. spacing pipes off
 * battenLenFt(dims.proWidthFt), or skipping drops the design already has —
 * can fill in without a caller-facing change. `partId` is left as the
 * caller-facing "PIPE"/"CURTAIN" token for the server action to resolve
 * against real catalog SKUs: this module has no DB access, so it stays
 * pure/testable.
 */
import type { VenueDims } from "./venue-dims";

export type SeedDrop = { partId: "PIPE" | "CURTAIN"; x: number; y: number; category: string };

/**
 * Normalized drop positions along the depth axis, UPSTAGE (0) -> DOWNSTAGE (1).
 *
 * That direction is not arbitrary and it is not a choice this module gets to
 * make: `buildGridBaseSheetPlan` (grid-base-sheet.ts) draws the back wall at
 * `yBack = MT` (the top of the page) and the plaster line at
 * `yPlaster = yBack + depthPx` (below it), so on the sheet a user actually
 * looks at, y≈0 IS the upstage back wall and y≈1 IS the downstage plaster
 * line. The drawing is the ground truth; these seeds follow it.
 *
 * So the starter set reads, in stage terms: the main drape just upstage of
 * the proscenium (large y, near the plaster line), then two pipes stepping
 * back toward the wall (progressively smaller y).
 */
export function suggestSeedPlacements(_dims: VenueDims, _existingCount: number): SeedDrop[] {
  return [
    { partId: "CURTAIN", x: 0.5, y: 0.92, category: "Curtains" },
    { partId: "PIPE", x: 0.5, y: 0.7, category: "Rigging" },
    { partId: "PIPE", x: 0.5, y: 0.45, category: "Rigging" },
  ];
}
