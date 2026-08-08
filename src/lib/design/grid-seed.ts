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

/** Normalized drop positions along the depth axis, front (0) to back (1). */
export function suggestSeedPlacements(_dims: VenueDims, _existingCount: number): SeedDrop[] {
  return [
    { partId: "CURTAIN", x: 0.5, y: 0.08, category: "Curtains" },
    { partId: "PIPE", x: 0.5, y: 0.3, category: "Rigging" },
    { partId: "PIPE", x: 0.5, y: 0.55, category: "Rigging" },
  ];
}
