/**
 * Seeding action (#38): "generate starting layout from dims" paints a
 * small, real, editable starter set — a couple of rigging pipes and a
 * front curtain-hardware position — onto a fresh (or not-so-fresh) plan.
 * This is intentionally a small, conservative starter set, not a full
 * parametric guess like the Quick estimator's goods.ts — the point is
 * "something real to edit," not "a complete system."
 *
 * `dims` IS now read — the drop positions are placed inside the generated
 * sheet's real stage band (see below). `existingCount` is still accepted and
 * unread, so a future "skip drops the design already has" pass can fill it in
 * without a caller-facing change. `partId` is left as the caller-facing
 * "PIPE"/"CURTAIN" token for the server action to resolve against real
 * catalog SKUs: this module has no DB access, so it stays pure/testable.
 */
import type { VenueDims } from "./venue-dims";
import { stageBandNormalized } from "./grid-base-sheet";

export type SeedDrop = { partId: "PIPE" | "CURTAIN"; x: number; y: number; category: string };

/**
 * How far each starter drop sits from the BACK WALL as a fraction of stage
 * depth: 0 is against the back wall, 1 is on the plaster line. Stated this way
 * — in stage terms, not page terms — because it is the part a human can
 * actually check: the main drape hangs 5% of the depth upstage of the plaster
 * line (1 ft 6 in on a 30 ft stage), then two pipes at 30% and 55% of the
 * depth upstage of it (9 ft and 16 ft 6 in).
 */
const SEED_DEPTH_FRACTIONS = { curtain: 0.95, pipe1: 0.7, pipe2: 0.45 };

const R4 = (n: number) => Math.round(n * 1e4) / 1e4;

/**
 * Normalized drop positions on the generated base sheet's page.
 *
 * Page `y` is NOT the depth axis one-for-one, and the previous fixed literals
 * (0.92 / 0.7 / 0.45) quietly assumed it was. `buildGridBaseSheetPlan`
 * (grid-base-sheet.ts) draws the back wall below a top margin and leaves blank
 * page below the plaster line, so the stage is a BAND inside 0..1 — about
 * 0.145 … 0.888 on the default dims, and it MOVES with the venue size. A
 * literal 0.92 was therefore downstage of the plaster line, i.e. out in the
 * house, not "just upstage of the proscenium" as intended.
 *
 * So the fractions above are mapped through `stageBandNormalized(dims)`, the
 * same helper `grid-lineset-schedule.ts` scores depths with and the same pixel
 * geometry the sheet is drawn from. Three consequences worth stating:
 *
 *  - correct for ANY dims, not just the ones someone spot-checked — no
 *    "safe range" of venue sizes to remember or re-verify;
 *  - the seeds and the schedule can never disagree about where a drop is,
 *    because there is one definition of the band;
 *  - still pure. `dims` was already a parameter and `grid-base-sheet.ts` is a
 *    pure lib module, so nothing about this module's no-DB-access design
 *    changes — no new caller-facing argument was needed.
 */
export function suggestSeedPlacements(dims: VenueDims, _existingCount: number): SeedDrop[] {
  const { yBackNorm, yPlasterNorm } = stageBandNormalized(dims);
  const span = yPlasterNorm - yBackNorm;
  /** Depth fraction off the back wall -> normalized page y. */
  const at = (fraction: number) => R4(yBackNorm + span * fraction);
  return [
    { partId: "CURTAIN", x: 0.5, y: at(SEED_DEPTH_FRACTIONS.curtain), category: "Curtains" },
    { partId: "PIPE", x: 0.5, y: at(SEED_DEPTH_FRACTIONS.pipe1), category: "Rigging" },
    { partId: "PIPE", x: 0.5, y: at(SEED_DEPTH_FRACTIONS.pipe2), category: "Rigging" },
  ];
}
