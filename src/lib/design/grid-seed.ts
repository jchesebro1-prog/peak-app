/**
 * The Grid — "generate starting layout from dims" (#38 Task 2, D14x).
 *
 * Translates `compute(a)`'s real fixture/curtain quantities (the same
 * numbers the Quick Design BOM prices) into placeable `GridPlacement`
 * descriptors, at the SAME normalized positions `buildPlanProscenium`
 * (plan-svg.tsx) already draws its rigged electrics/curtain lines at —
 * generalized off the venue's own `stage` rect (exported by both
 * `prosGeom`/`churchGeom`) instead of re-deriving new geometry.
 *
 * Deliberately scoped to Lighting + Curtains only. Those are the only two
 * systems `buildPlan()` gives individual, positioned marks for anywhere in
 * this codebase (`rigged` array, plan-svg.tsx:227-266) — Audio/Video/
 * Rigging/Acoustical/Pit render as lump BOM totals with no per-device plan
 * position to reuse, and inventing one here would be exactly the kind of
 * unfounded new geometry this module is built to avoid. A follow-up task
 * can extend this once those systems have a real plan-view home.
 *
 * No catalog SKU is ever invented here (punch #52's rule: never guess a
 * real part number). Every returned placement's `partId` is a stable,
 * obviously-non-catalog placeholder (`SEED_PART_PREFIX`-prefixed) — see
 * DECISIONS.md D14x for the full trade-off. `category` carries the real,
 * human system-function label (reusing compute()'s own BOM item names) so
 * the placement is still meaningful and filterable before a real catalog
 * part is ever assigned to it, via the SAME picker/delete-and-replace flow
 * every hand-placed device already uses.
 *
 * Pure and dependency-free (the grid-bom.ts rule): called from both the
 * server action and the client editor (for the pre-confirm count), so it
 * must never reach for the doc-store or drag in anything heavier.
 */

import { clamp01, type Point } from "@/lib/annotations";
import { compute, venueOf, type AState } from "@/app/(app)/design/quick/engine";
import { churchGeom, prosGeom } from "@/app/(app)/design/quick/plan-svg";

/** Non-catalog placeholder — see file header. Never resolves against
 *  `catalog`/`grid_catalog`, so the editor's existing "part not found"
 *  fallback rendering (marker label, BOM "no longer in the catalog" line)
 *  is what a seeded-but-unassigned device shows until replaced. */
export const SEED_PART_PREFIX = "grid-seed:";

export function seedPlaceholderPartId(key: string): string {
  return `${SEED_PART_PREFIX}${key}`;
}

/** True for any placement carrying one of this module's placeholder ids —
 *  the inverse of `seedPlaceholderPartId`, for callers that need to know
 *  whether a placement still needs a real catalog part assigned. */
export function isSeedPlaceholder(partId: string): boolean {
  return partId.startsWith(SEED_PART_PREFIX);
}

export type SeedPlacement = {
  /** Stable identity for this computed instance (e.g. "lighting:par:2"),
   *  independent of x/y/category — the re-run action diffs on this, never
   *  on position, so a hand-dragged seeded device still reads as seeded. */
  seededFrom: string;
  /** Human system-function label, reusing compute()'s own BOM item names
   *  (e.g. "Par", "Grand drape") — becomes the placement's user-defined
   *  `category` (punch #41/#48's "assign now, consume later" field). */
  category: string;
  x: number;
  y: number;
  partId: string;
};

type StageRect = { x: number; y: number; w: number; h: number };

/**
 * The venue's stage rect, normalized 0..1 against the sheet `generateBaseSheet`
 * (grid-projects.ts) rendered. Proscenium and church have real geometry
 * (`prosGeom`/`churchGeom` both already export a `stage: {x,y,w,h}` in their
 * own pixel frame — the exact rect `buildPlanProscenium` computes its rigged
 * electrics/curtain fracs against). The other three buildable kinds compute
 * their platform/room rect as private locals inside their own buildPlan*
 * function (confirmed in the #38 recon — same reason `starterSpaces()` in
 * grid-projects.ts doesn't have real geometry for them either): this reuses
 * that SAME function's fixed-fraction "Stage" rectangle rather than
 * reverse-engineering each builder's private margins a second time.
 */
function stageRectFor(a: AState): StageRect {
  const kind = venueOf(a).kind || "proscenium";
  if (kind === "proscenium") {
    const G = prosGeom(a);
    return { x: G.stage.x / G.W, y: G.stage.y / G.H, w: G.stage.w / G.W, h: G.stage.h / G.H };
  }
  if (kind === "church") {
    const G = churchGeom(a);
    return { x: G.stage.x / G.W, y: G.stage.y / G.H, w: G.stage.w / G.W, h: G.stage.h / G.H };
  }
  // flat / blackbox / gym / arena — identical to starterSpaces()'s fallback
  // "Stage" Space (grid-projects.ts) for the same reason: {0.2,0.12}..{0.8,0.4}.
  return { x: 0.2, y: 0.12, w: 0.6, h: 0.28 };
}

/**
 * `n` fixture positions spread across `rows` electrics, at the SAME
 * per-row fraction `buildPlanProscenium` uses for its rigged electrics
 * (plan-svg.tsx: `(electrics - j) / (electrics + 1)`), then evenly across
 * the stage width within a row — the same idea as that function's decorative
 * dot spacing (`(k + 0.5) / dn`), but sized to compute()'s REAL fixture
 * quantity instead of a cosmetic dot count.
 */
function fixturePositions(stage: StageRect, rows: number, n: number): Point[] {
  if (rows <= 0 || n <= 0) return [];
  const perRow = Math.ceil(n / rows);
  const pts: Point[] = [];
  for (let i = 0; i < n; i++) {
    const row = i % rows;
    const col = Math.floor(i / rows);
    const rowFrac = (rows - row) / (rows + 1);
    pts.push({
      x: clamp01(stage.x + ((col + 0.5) / perRow) * stage.w),
      y: clamp01(stage.y + rowFrac * stage.h),
    });
  }
  return pts;
}

/** compute()'s addFix BOM-item desc -> a stable seed key. Read directly off
 *  the generic desc (compute() is called with no assemblyOptions below, so
 *  a project's fixture-assembly picks never change these strings — see
 *  the module-level note on why that's deliberate). */
const FIXTURE_KEY_BY_DESC: Record<string, string> = {
  Par: "par",
  Front: "front",
  Cyc: "cyc",
  "Side light": "side",
  Automated: "automated",
};

/**
 * The fixed schematic curtain/drape positions `buildPlanProscenium` draws
 * (plan-svg.tsx:227-241) — literally the same fracs, not re-derived. Legs
 * sit just outside the stage's side edges, same as the schematic's
 * `xProcL - legW` / `xProcR + legW`, clamped onto the sheet.
 */
function curtainSeeds(a: AState): Array<{ key: string; label: string; frac: number; xFrac: number }> {
  const drape = a.drape || {};
  const out: Array<{ key: string; label: string; frac: number; xFrac: number }> = [];
  if (drape.draw) out.push({ key: "draw", label: "Grand drape", frac: 0.95, xFrac: 0.5 });
  if (drape.fullstage) out.push({ key: "fullstage", label: "Mid traveler", frac: 0.5, xFrac: 0.5 });
  if (drape.border) {
    [0.74, 0.48, 0.22].forEach((frac, i) => out.push({ key: `border:${i}`, label: `Border ${i + 1}`, frac, xFrac: 0.5 }));
  }
  if (drape.scenerytrack) out.push({ key: "scenerytrack", label: "Cyc / scenery", frac: 0.05, xFrac: 0.5 });
  if (drape.legs) {
    [0.74, 0.48, 0.22].forEach((frac, i) => {
      out.push({ key: `legs:${i}:L`, label: `Leg — SL ${i + 1}`, frac, xFrac: -0.03 });
      out.push({ key: `legs:${i}:R`, label: `Leg — SR ${i + 1}`, frac, xFrac: 1.03 });
    });
  }
  return out;
}

/**
 * Derive the full starting-layout seed set for the given intake config.
 * Additive by construction — a caller diffs the returned `seededFrom` keys
 * against what's already on the project (seedStartingLayoutAction,
 * grid/[id]/actions.ts) so a re-run only adds what's genuinely new.
 */
export function deriveSeedPlacements(a: AState): SeedPlacement[] {
  const stage = stageRectFor(a);
  const { electrics, systems } = compute(a, {});
  const lighting = systems.find((s) => s.key === "lighting");
  const curtains = systems.find((s) => s.key === "curtains");
  const out: SeedPlacement[] = [];

  if (lighting?.on && electrics > 0) {
    for (const item of lighting.items) {
      const key = FIXTURE_KEY_BY_DESC[item.desc];
      if (!key || item.qty <= 0) continue;
      const pts = fixturePositions(stage, electrics, item.qty);
      pts.forEach((pt, i) => {
        out.push({
          seededFrom: `lighting:${key}:${i}`,
          category: item.desc,
          x: pt.x,
          y: pt.y,
          partId: seedPlaceholderPartId(`lighting-${key}`),
        });
      });
    }
  }

  if (curtains?.on) {
    for (const c of curtainSeeds(a)) {
      out.push({
        seededFrom: `curtains:${c.key}`,
        category: c.label,
        x: clamp01(stage.x + c.xFrac * stage.w),
        y: clamp01(stage.y + c.frac * stage.h),
        partId: seedPlaceholderPartId(`curtains-${c.key.split(":")[0]}`),
      });
    }
  }

  return out;
}
