/**
 * Generated Grid base sheet (punch #38): a venue plan drawn straight from
 * VenueDims, with implicit scale (no calibration step). This is
 * DELIBERATELY NOT a call into design/quick/plan-svg.tsx's
 * buildPlanProscenium — that function's inputs (AState.sys flags,
 * AState.drape flags, door-position arrays) model the Quick estimator's
 * PARAMETRIC ASSUMPTIONS about what's rigged where. The Grid doesn't guess
 * — the user paints real catalog devices onto this shell. So this builder
 * draws only what VenueDims actually knows: the house floor, the
 * proscenium opening, and dimension lines. It reuses <PlanSvg> (the
 * primitive renderer) from plan-svg.tsx, not its geometry functions.
 *
 * v1 is proscenium-only — see the plan's Global Constraints for why the
 * other 5 venue kinds aren't covered here.
 */
import type { PlanData } from "@/app/(app)/design/quick/plan-svg";
import type { VenueDims } from "./venue-dims";

const R = (n: number) => Math.round(n * 10) / 10;

/**
 * Raw pixel geometry of the generated sheet. THE single place the canvas
 * constants and the depth math live — `buildGridBaseSheetPlan` draws from it
 * and `stageBandNormalized` measures from it, so the drawing and anything
 * that reads positions off the drawing can never drift apart. (They did:
 * `grid-lineset-schedule.ts` re-derived the depth axis as if the page had no
 * margins, which put every reported depth several feet out.)
 */
function baseSheetGeometry(dims: VenueDims) {
  const W = 640, ML = 58, MR = 138, MT = 52;
  /** Blank page below the plaster line — the sheet is taller than the stage. */
  const MB = 40;
  // stageWidthFt is wall-to-wall; when absent, assume no wings beyond the
  // opening (a conservative default — the user can always upload a real
  // plan instead of trusting the generated one for wing-dependent work).
  // Clamped to at least proWidthFt: a house floor narrower than the
  // proscenium opening it contains is physically nonsensical and would
  // otherwise draw the opening rect wider than the house rect (a typo'd
  // stageWidthFt shouldn't invert the plan).
  const houseWft = Math.max(dims.stageWidthFt ?? dims.proWidthFt, dims.proWidthFt);
  const ppf = (W - ML - MR) / Math.max(houseWft, 1);
  const depthPx = Math.max(150, dims.stageDepthFt * ppf);
  const xHouseL = ML, xHouseR = W - MR, cx = (xHouseL + xHouseR) / 2;
  const yBack = MT, yPlaster = yBack + depthPx;
  const xProcL = cx - (dims.proWidthFt / 2) * ppf, xProcR = cx + (dims.proWidthFt / 2) * ppf;
  // R() here, not at the call sites: the canvas height a viewer's normalized
  // coordinates are measured against is the ROUNDED one that ships in
  // PlanData, so the band must normalize by exactly that number.
  const H = R(yPlaster + MB);
  return { W, H, ML, MR, MT, MB, ppf, depthPx, xHouseL, xHouseR, cx, yBack, yPlaster, xProcL, xProcR };
}

/**
 * Where the STAGE actually sits on the generated sheet, in the normalized
 * 0..1 page coordinates a `GridPlacement.y` is stored in.
 *
 * The stage does NOT fill the page: `buildGridBaseSheetPlan` leaves a top
 * margin above the back wall and a strip of blank page below the plaster
 * line, so on the default dims the band is roughly y 0.145 … 0.888. Anything
 * mapping a painted `y` to a real depth MUST interpolate inside this band —
 * treating y=0 as the back wall and y=1 as the plaster line stretches the
 * stage over the margins and reports depths that are feet out (and further
 * out the deeper the stage, since the margins are fixed pixels).
 *
 * Only meaningful for GENERATED sheets. An UPLOADED plan has no known band —
 * nothing states where its stage sits on the page, or which way its depth
 * axis runs — so callers must not pretend this applies to one.
 */
export function stageBandNormalized(dims: VenueDims): { yBackNorm: number; yPlasterNorm: number } {
  const g = baseSheetGeometry(dims);
  return { yBackNorm: g.yBack / g.H, yPlasterNorm: g.yPlaster / g.H };
}

export function buildGridBaseSheetPlan(dims: VenueDims): PlanData {
  const { W, H, depthPx, xHouseL, xHouseR, cx, yBack, yPlaster, xProcL, xProcR } =
    baseSheetGeometry(dims);
  const openW = xProcR - xProcL;

  const rects: PlanData["rects"] = [
    { x: R(xHouseL), y: R(yBack), w: R(xHouseR - xHouseL), h: R(depthPx), fill: "#f6f7f9", stroke: "#dcdfe5", sw: 1.2, rx: 2, dash: "" },
    { x: R(xProcL), y: R(yBack), w: R(openW), h: R(depthPx), fill: "#ffffff", stroke: "#e3e5ea", sw: 1, rx: 1, dash: "" },
  ];
  const lines: PlanData["lines"] = [
    // proscenium line
    { x1: R(xProcL), y1: R(yBack), x2: R(xProcL), y2: R(yPlaster), stroke: "#16181d", sw: 1.6, dash: "" },
    { x1: R(xProcR), y1: R(yBack), x2: R(xProcR), y2: R(yPlaster), stroke: "#16181d", sw: 1.6, dash: "" },
    { x1: R(xProcL), y1: R(yPlaster), x2: R(xProcR), y2: R(yPlaster), stroke: "#16181d", sw: 1.8, dash: "" },
  ];
  const texts: PlanData["texts"] = [
    { x: R(cx), y: R(yBack - 12), t: `Pro width ${dims.proWidthFt} ft`, fill: "#2f333a", size: 12, weight: 600, anchor: "middle", transform: "" },
    { x: R(xHouseR + 14), y: R((yBack + yPlaster) / 2), t: `Depth ${dims.stageDepthFt} ft`, fill: "#2f333a", size: 12, weight: 600, anchor: "middle", transform: `rotate(-90 ${R(xHouseR + 14)} ${R((yBack + yPlaster) / 2)})` },
  ];

  return { W, H, rects, lines, circles: [], texts, paths: [], isHouse: true, canSlideWalls: false };
}
