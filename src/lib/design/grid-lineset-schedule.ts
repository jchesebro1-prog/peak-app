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
 *   dsInches ........ `stageDepthFt * y * 12`. HONEST but coarse: `y` is a
 *                     normalized page coordinate, so this is only a real
 *                     depth when the plan's depth axis fills the page. See
 *                     the depth-axis note below.
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
 * `y` is treated as the normalized depth axis, DOWNSTAGE 0 -> UPSTAGE 1.
 * That is the convention `suggestSeedPlacements` (grid-seed.ts) already
 * stamps onto seeded placements, so seeded and hand-painted items read the
 * same way. Two known caveats, deliberately not papered over:
 *   - the GENERATED base sheet (grid-base-sheet.ts) draws the plaster line at
 *     the BOTTOM of the page (conventional ground-plan orientation), so on
 *     that sheet the on-page axis runs the other way and also carries page
 *     margins. Depths derived from a generated sheet are therefore indicative
 *     only, which is what the page says out loud.
 *   - an UPLOADED plan has no declared orientation at all. There is no
 *     Grid-side field that states it, so nothing here can correct for it.
 * Neither is silently absorbed - both are surfaced on the schedule page.
 *
 * Pure and dependency-free like its grid-* siblings (type-only imports only):
 * nothing here may reach the doc-store.
 */
import type { VenueDims } from "./venue-dims";
import type { LinesetSlot } from "./lineset";
import type { GridCurtain, GridCurtainType } from "./grid-bom";
import { scopeOfPlacement, type ScopedPartLite, type ScopeSource } from "./grid-scopes";

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
  parts: LinesetPartLite[] = []
): LinesetScheduleResult {
  const partById = new Map(parts.map((p) => [p.id, p]));
  const depthIn = Math.max(0, dims.stageDepthFt || 0) * 12;

  const rows: GridLinesetRow[] = [];
  const skipped: LinesetSkip[] = [];

  for (const pl of placements) {
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

    const dsIn = Math.round(depthIn * clamp01(pl.y));
    const slot = Math.round(dsIn / SLOT_SPACING_IN) + 1;
    const offGridIn = Math.abs(dsIn - (slot - 1) * SLOT_SPACING_IN);

    // Type: the user's label wins (it is the explicit statement), then the
    // curtain spec. Never the catalog part — see the header.
    const label = (pl.category || "").trim();
    const labelType = LINESET_TYPES.find((t) => t.toLowerCase() === label.toLowerCase()) || "";
    const type = labelType || (pl.curtain ? CURTAIN_TYPE_TO_LINESET[pl.curtain.type] || "" : "");

    const unresolved: string[] = [];
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
      rule: `Painted at y=${clamp01(pl.y).toFixed(3)} on the plan's depth axis × ${dims.stageDepthFt || 0} ft depth`,
      warning: unresolved.length > 0 ? unresolved.join("\n") : undefined,
      placementId: pl.id,
      partId: pl.partId,
      scopeSource: source,
      unresolved,
    });
  }

  // Downstage -> upstage, the order a schedule is read and hung in. Ties keep
  // their painted order (Array.prototype.sort is stable in ES2019+).
  rows.sort((a, b) => a.dsInches - b.dsInches);
  return { rows, skipped };
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
  parts: LinesetPartLite[] = []
): GridLinesetRow[] {
  return linesetScheduleReport(placements, dims, parts).rows;
}
