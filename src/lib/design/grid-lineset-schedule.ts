/**
 * Lineset schedule DERIVED FROM GRID INSTANCES (punch #41).
 *
 * `lineset.ts` is the faithful port of Jeff's workbook: given venue inputs it
 * AUTO-PLACES an ideal 8-inch-grid layout. This module is the other
 * direction, and it is deliberately NOT a second parametric path (plan
 * constraint: "all artifacts derive from Grid instances ONLY"). It reads what
 * the designer actually painted on the plan and reports it in the workbook's
 * own `LinesetSlot` vocabulary, so the schedule and the drawing can never
 * disagree.
 *
 * WHAT A GRID-SOURCED ROW CAN AND CANNOT FILL
 * -------------------------------------------
 * `generateLineset` computes every field from its own rules. A painted
 * placement carries far less, so each `LinesetSlot` field is filled as
 * follows - and where a value genuinely isn't knowable it is left blank and
 * NAMED in `warning`, never guessed (the MatchReport ethos from bid-spec.ts):
 *
 *   slot ............ the nearest 8-inch grid slot to the painted depth,
 *                     `round(dsIn / 8) + 1`, which is exactly what the
 *                     workbook's slot number means. A placement that is not
 *                     on a grid center gets an off-grid warning rather than
 *                     being silently snapped.
 *   dsInches ........ inches UPSTAGE OF THE PLASTER LINE, linearly
 *                     interpolated across the generated sheet's real stage
 *                     band (see the depth-axis note below): 0" at the plaster
 *                     line, the full stage depth at the back wall. HONEST but
 *                     coarse on an UPLOADED sheet, where `y` is only a page
 *                     coordinate and no band is known.
 *   dsPositionLabel . feet-inches label for dsInches.
 *   usPositionLabel . the same measured off the back wall.
 *   active .......... always true - a painted item is, by definition, there.
 *   type ............ blank unless it is knowable: the user's free-text
 *                     placement category when it names a workbook type
 *                     (punch #48's "assign now, consume later" label, which
 *                     this is the first consumer of), else a curtain
 *                     drop-in's own curtain type. A bare pipe's type is NOT
 *                     derivable - a 44 ft batten is an electric, a shell
 *                     batten or a GP line depending on what hangs on it, and
 *                     the catalog cannot say which.
 *   name ............ the curtain's name, else the catalog description, else
 *                     the raw partId. Never an invented "LX 3" ordinal: the
 *                     workbook's running ordinals come from its own auto-type
 *                     ladder, and inventing them here would fabricate a
 *                     hang order the plan never stated.
 *   rule ............ provenance, not a rule: which plan coordinate produced
 *                     the row. The workbook's `rule` explains WHY the auto
 *                     layout chose a slot; nothing chose this one but a
 *                     human, so the honest thing to print is where it came
 *                     from.
 *   warning ......... every field left blank/best-effort, spelled out.
 *
 * DEPTH-AXIS CONVENTION
 * ---------------------
 * `y` is the normalized depth axis of the PAGE, and on a generated sheet it
 * runs UPSTAGE -> DOWNSTAGE: `buildGridBaseSheetPlan` (grid-base-sheet.ts)
 * puts the back wall near the top of the page and the plaster line below it,
 * conventional ground-plan orientation.
 *
 * But the stage does NOT fill the page. The generated sheet has a top margin
 * above the back wall and a blank strip below the plaster line, so the stage
 * occupies only the middle band — roughly y 0.145 … 0.888 on the default
 * dims. `stageBandNormalized(dims)` is the ONE statement of where that band
 * is (it and the drawing share the same pixel geometry, so they cannot
 * drift), and this module interpolates inside it:
 *
 *     dsIn = stageDepthIn × (yPlasterNorm − y) / (yPlasterNorm − yBackNorm)
 *
 * clamped to [0, stageDepthIn]. Treating raw y=0/y=1 as the two walls — which
 * this module used to do — stretches the stage across the margins and reports
 * depths feet out of true, worse the deeper the stage (the margins are fixed
 * pixels, so they eat a bigger share of a shallow page and a smaller share of
 * a deep one; the ERROR grows with depth because the same normalized offset
 * buys more feet). A placement painted OUTSIDE the band (in the margin, or
 * off in the house) clamps AND says so on the row — never a negative depth,
 * never a silent clamp.
 *
 * `suggestSeedPlacements` (grid-seed.ts) stamps seeded placements inside the
 * same band from the same helper, so seeded and hand-painted items read
 * identically.
 *
 * One caveat remains, deliberately not papered over: an UPLOADED plan has no
 * declared orientation, scale, OR stage band. There is no Grid-side field
 * that states any of it, so nothing here can correct for it. Callers signal
 * which case they are in with `opts.generatedSheetId`; without it this falls
 * back to the coarse whole-page mapping and the page prints the "indicative
 * until calibrated" hedge. See `LinesetScheduleOptions`.
 *
 * Pure and dependency-free like its grid-* siblings: the two value imports
 * (`grid-scopes`, `grid-base-sheet`) are themselves pure lib modules, and
 * nothing here may reach the doc-store.
 */
import type { VenueDims } from "./venue-dims";
import type { LinesetSlot } from "./lineset";
import type { GridCurtain, GridCurtainType } from "./grid-bom";
import { scopeOfPlacement, type ScopedPartLite, type ScopeSource } from "./grid-scopes";
import { stageBandNormalized } from "./grid-base-sheet";

/** The 8-inch grid the workbook's slot numbers are indexes into. */
const SLOT_SPACING_IN = 8;

/**
 * The workbook's auto-type vocabulary (lineset.ts column V/F). A free-text
 * placement category matching one of these - case-insensitively - types the
 * row; anything else is a user label with no lineset meaning and is ignored
 * for typing (it still shows on the row as provenance).
 */
export const LINESET_TYPES: readonly string[] = [
  "Border",
  "Draw",
  "Rear",
  "CYC",
  "Midstage Draw",
  "Electric",
  "Legs",
  "Shell",
  "General Purpose",
];

/**
 * Grid curtain type -> workbook lineset type. `Full` maps to `Draw` because
 * in the workbook's vocabulary a full-stage drape occupies a draw line; the
 * difference between the two is width and fullness, which the curtain spec
 * itself carries and the schedule prints in the name.
 */
const CURTAIN_TYPE_TO_LINESET: Record<GridCurtainType, string> = {
  Border: "Border",
  Draw: "Draw",
  Full: "Draw",
  Leg: "Legs",
};

/**
 * The placement slice this schedule needs. The stated interface takes
 * `GridPlacement[]`, so the fields this module never reads are declared
 * optional rather than omitted — that way a real GridPlacement (or a literal
 * shaped like one) is accepted without a cast, and the module still states
 * exactly which four fields it depends on.
 */
export type LinesetPlacementLite = {
  id: string;
  x: number;
  y: number;
  partId: string;
  category?: string;
  curtain?: GridCurtain;
  sheetId?: string;
  page?: number;
  by?: string;
  at?: number;
};

/** The part slice this schedule needs (PartLite satisfies it; its priced
 *  fields are accepted and ignored — a lineset schedule carries no prices). */
export type LinesetPartLite = ScopedPartLite & {
  id: string;
  desc?: string;
  category?: string;
  sku?: string;
  unit?: string;
  list?: number;
  cost?: number;
};

/**
 * A schedule row. Structurally a `LinesetSlot` (so it satisfies the stated
 * `LinesetSlot[]` contract and can be printed by anything that prints the
 * workbook's schedule), plus the Grid provenance a derived artifact owes its
 * reader: which placement and which catalog part produced it.
 */
export type GridLinesetRow = LinesetSlot & {
  placementId: string;
  partId: string;
  /** How the row's scope was resolved - see grid-scopes.ScopeSource. */
  scopeSource: ScopeSource;
  /** Fields that could not be determined, one plain-English phrase each. */
  unresolved: string[];
};

export type LinesetSkip = {
  placementId: string;
  partId: string;
  reason: string;
};

export type LinesetScheduleResult = {
  rows: GridLinesetRow[];
  /** Placements that are NOT lineset items, each with the reason. */
  skipped: LinesetSkip[];
  /**
   * True when depths were interpolated across a generated sheet's real stage
   * band (exact), false when they fell back to the whole-page mapping on a
   * design with no generated base sheet (indicative). The page prints its
   * calibration hedge off this rather than re-deriving the condition.
   */
  depthsFromGeneratedSheet: boolean;
};

/**
 * @property generatedSheetId
 * The id of the design's GENERATED base sheet, when it has one, and the sheet
 * `dims` came from. Passing it does two things that only make sense together:
 *
 *  1. depths interpolate across that sheet's real stage band
 *     (`stageBandNormalized`) instead of the whole page;
 *  2. placements painted on ANY OTHER sheet are moved to `skipped` rather
 *     than scored.
 *
 * (2) follows from (1). `dims` and the depth axis belong to ONE sheet; a
 * marker painted on an uploaded plan sheet in the same design sits in that
 * sheet's page coordinates, which state no orientation, scale or band. Depth-
 * scoring it against the generated sheet's geometry produces a number with no
 * meaning attached — so it is excluded and NAMED in `skipped`, the same way
 * an unscopeable placement is. The alternative (scoring both sets and hedging
 * the mixed table) was rejected: one table with two incompatible coordinate
 * systems in it is exactly the kind of quiet wrongness this module exists to
 * avoid.
 *
 * Omit it for a design with NO generated base sheet: every placement is then
 * scored on the coarse whole-page fallback, and `depthsFromGeneratedSheet`
 * comes back false so the caller can print the "indicative" hedge.
 */
export type LinesetScheduleOptions = {
  generatedSheetId?: string | null;
};

/** Feet-inches label. Mirrors lineset.ts's private `feetInchesLabel` - that
 *  one is module-private inside the workbook port, and exporting it would
 *  mean editing the ported file for a formatting helper. */
function feetInchesLabel(totalInches: number): string {
  const t = Math.max(0, Math.round(totalInches));
  return `${Math.floor(t / 12)}' ${t % 12}"`;
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.min(1, Math.max(0, n));
}

/**
 * Does this placement hang on a lineset?
 *
 * "Rigging" is a TRADE, never a literal `category` string on a part
 * (catalog-taxonomy.ts) - so this asks the resolved Grid SCOPE instead, and
 * accepts both Rigging AND Curtains. That pair is exactly the Rigging trade:
 * `GROUP_TRADES` puts the Curtains group under Rigging, and Curtains is the
 * only group that rolls up there, so {Rigging, Curtains} scope == Rigging
 * trade for every part that resolves at all. Curtains MUST be in - a lineset
 * schedule whose drapes are missing is not a lineset schedule.
 */
function hangsOnALineset(scope: string): boolean {
  return scope === "Rigging" || scope === "Curtains";
}

/**
 * Full derivation with the skip report. `linesetScheduleFromGrid` is the
 * thin "just the rows" wrapper over this; pages that want to tell the user
 * what was left off (they all should) call this one.
 *
 * `parts` is optional: with it, scope resolves from the server-resolved
 * group/trade, which is the reliable path. Without it, resolution falls back
 * to the placement's own free-text category, so the function still degrades
 * gracefully on a caller that has no catalog handy.
 */
export function linesetScheduleReport(
  placements: LinesetPlacementLite[],
  dims: VenueDims,
  parts: LinesetPartLite[] = [],
  opts: LinesetScheduleOptions = {}
): LinesetScheduleResult {
  const partById = new Map(parts.map((p) => [p.id, p]));
  const depthIn = Math.max(0, dims.stageDepthFt || 0) * 12;

  // The real stage band, or null when there is no generated sheet to have one.
  const generatedSheetId = opts.generatedSheetId || null;
  const band = generatedSheetId ? stageBandNormalized(dims) : null;
  const bandSpan = band ? band.yPlasterNorm - band.yBackNorm : 0;

  const rows: GridLinesetRow[] = [];
  const skipped: LinesetSkip[] = [];

  for (const pl of placements) {
    // A placement on a DIFFERENT sheet than the one `dims` describes carries
    // no comparable depth — see LinesetScheduleOptions. A placement with no
    // sheetId at all can only come from a caller-built literal (the stored
    // GridPlacement always has one), so it is left in rather than dropped on
    // a field the real data never omits.
    if (generatedSheetId && pl.sheetId && pl.sheetId !== generatedSheetId) {
      skipped.push({
        placementId: pl.id,
        partId: pl.partId,
        reason:
          "painted on an uploaded sheet, not the generated base sheet these dimensions come from — that page states no depth axis, so no honest position can be reported",
      });
      continue;
    }

    const part = partById.get(pl.partId) || null;
    const { scope, source } = scopeOfPlacement(pl, part);
    if (!hangsOnALineset(scope)) {
      skipped.push({
        placementId: pl.id,
        partId: pl.partId,
        reason:
          source === "none"
            ? part
              ? "no group or trade maps this part to a scope — map its category in the Catalog screen"
              : "not in the catalog and carries no scope label — can't tell whether it hangs"
            : `${scope} scope — not a rigging or curtain item`,
      });
      continue;
    }

    // Inches upstage of the plaster line — interpolated across the real stage
    // band when one is known, else the coarse whole-page fallback. See the
    // DEPTH-AXIS CONVENTION block.
    const y = clamp01(pl.y);
    let offStage = "";
    let dsIn: number;
    if (band && bandSpan > 0) {
      const raw = (depthIn * (band.yPlasterNorm - y)) / bandSpan;
      dsIn = Math.round(Math.min(depthIn, Math.max(0, raw)));
      // Outside the drawn stage: clamped, never negative or over-depth, and
      // never silently — the reader is told which way it fell off.
      if (y > band.yPlasterNorm) {
        offStage =
          "painted downstage of the plaster line, off the drawn stage — position clamped to the plaster line";
      } else if (y < band.yBackNorm) {
        offStage =
          "painted upstage of the back wall, off the drawn stage — position clamped to the back wall";
      }
    } else {
      dsIn = Math.round(depthIn * (1 - y));
    }
    const slot = Math.round(dsIn / SLOT_SPACING_IN) + 1;
    const offGridIn = Math.abs(dsIn - (slot - 1) * SLOT_SPACING_IN);

    // Type: the user's label wins (it is the explicit statement), then the
    // curtain spec. Never the catalog part — see the header.
    const label = (pl.category || "").trim();
    const labelType = LINESET_TYPES.find((t) => t.toLowerCase() === label.toLowerCase()) || "";
    const type = labelType || (pl.curtain ? CURTAIN_TYPE_TO_LINESET[pl.curtain.type] || "" : "");

    const unresolved: string[] = [];
    if (offStage) {
      unresolved.push(offStage);
    }
    if (!type) {
      unresolved.push(
        "lineset type not stated — label the placement Electric / Border / Draw / Legs / Shell / CYC / Rear / Midstage Draw / General Purpose to type this line"
      );
    }
    if (offGridIn > 0.5) {
      unresolved.push(`${offGridIn}" off the nearest 8-inch grid center (slot ${slot})`);
    }
    if (depthIn <= 0) {
      unresolved.push("no stage depth on this design — every position reads 0");
    }

    rows.push({
      slot,
      dsPositionLabel: feetInchesLabel(dsIn),
      dsInches: dsIn,
      usPositionLabel: feetInchesLabel(Math.max(0, depthIn - dsIn)),
      active: true,
      type,
      name: pl.curtain?.name || part?.desc || pl.partId,
      rule: band
        ? `Painted at y=${y.toFixed(3)} on the generated base sheet, whose stage runs back wall ${band.yBackNorm.toFixed(3)} → plaster line ${band.yPlasterNorm.toFixed(3)} × ${dims.stageDepthFt || 0} ft depth`
        : `Painted at y=${y.toFixed(3)} on the plan's depth axis (upstage 0 → downstage 1) × ${dims.stageDepthFt || 0} ft depth`,
      warning: unresolved.length > 0 ? unresolved.join("\n") : undefined,
      placementId: pl.id,
      partId: pl.partId,
      scopeSource: source,
      unresolved,
    });
  }

  // Downstage -> upstage, the order a schedule is read and hung in. `dsInches`
  // IS the distance upstage of the plaster line, so ascending is exactly that
  // order: the line closest to the proscenium first, the back wall last. Ties
  // keep their painted order (Array.prototype.sort is stable in ES2019+).
  rows.sort((a, b) => a.dsInches - b.dsInches);
  return { rows, skipped, depthsFromGeneratedSheet: !!band };
}

/**
 * The lineset schedule for a Grid design, downstage to upstage.
 *
 * Deliberately ONE ROW PER PLACEMENT, never merged by depth: the Grid has no
 * batten object, so two pipes painted at the same depth are two things the
 * designer drew, and collapsing them would invent a line item nobody placed.
 */
export function linesetScheduleFromGrid(
  placements: LinesetPlacementLite[],
  dims: VenueDims,
  parts: LinesetPartLite[] = [],
  opts: LinesetScheduleOptions = {}
): GridLinesetRow[] {
  return linesetScheduleReport(placements, dims, parts, opts).rows;
}
