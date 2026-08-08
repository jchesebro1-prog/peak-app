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

export function buildGridBaseSheetPlan(dims: VenueDims): PlanData {
  const W = 640, ML = 58, MR = 138, MT = 52;
  // stageWidthFt is wall-to-wall; when absent, assume no wings beyond the
  // opening (a conservative default — the user can always upload a real
  // plan instead of trusting the generated one for wing-dependent work).
  const houseWft = dims.stageWidthFt ?? dims.proWidthFt;
  const ppf = (W - ML - MR) / Math.max(houseWft, 1);
  const depthPx = Math.max(150, dims.stageDepthFt * ppf);
  const xHouseL = ML, xHouseR = W - MR, cx = (xHouseL + xHouseR) / 2;
  const yBack = MT, yPlaster = yBack + depthPx;
  const xProcL = cx - (dims.proWidthFt / 2) * ppf, xProcR = cx + (dims.proWidthFt / 2) * ppf;
  const openW = xProcR - xProcL;
  const H = R(yPlaster + 40);

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
