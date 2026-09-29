import type { AState } from "@/app/(app)/design/quick/engine";

const R = (n: number) => Math.round(n * 10) / 10;

/**
 * The church geometry from before #255 — the hand-drawn schematic (trapezoid
 * chancel, curved pews, doors, a booth box). Kept for Grid designs whose
 * generated base sheet was drawn with it: a re-fill must land on the plan the
 * design actually has (grid-auto-layout venueFrame, intake.baseSheetTemplate).
 */
export function legacyChurchGeom(s: AState) {
  const Wpx = 640, ML = 62, MR = 40, MT = 54;
  const ppf = (Wpx - ML - MR) / Math.max(s.width, 1);
  const x0 = ML, x1 = Wpx - MR, y0 = MT, cx = (x0 + x1) / 2;
  const chancelPx = Math.min(s.depth * ppf, 270);
  const congPx = 150, depthPx = chancelPx + congPx, y1 = y0 + depthPx;
  const halfFront = (x1 - x0) / 2, halfBack = halfFront * 0.6, pBot = y0 + chancelPx;
  const seatBot = y1 - 16;
  const boothW = R((x1 - x0) * 0.42), boothH = 24, yBoothBottom = R(y1 + boothH);
  const H = R(yBoothBottom + 22);
  const dDef = [0.3, 0.74];
  const doorsL = Array.isArray(s.doorsL) ? s.doorsL : dDef;
  const doorsR = Array.isArray(s.doorsR) ? s.doorsR : dDef;
  const doorsBack = Array.isArray(s.doorsBack) ? s.doorsBack : [0.13, 0.87];
  return { W: Wpx, ML, MR, MT, ppf, x0, x1, y0, y1, cx, chancelPx, congPx, depthPx, halfFront, halfBack, pBot, seatBot, boothW, boothH, doorsL, doorsR, doorsBack, H, stage: { x: x0, y: y0, w: x1 - x0, h: chancelPx } };
}
