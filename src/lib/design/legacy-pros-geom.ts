import type { AState } from "@/app/(app)/design/quick/engine";

const R = (n: number) => Math.round(n * 10) / 10;

/**
 * The proscenium geometry from before #249 — the hand-drawn schematic
 * (house of four seat arcs, doors, a booth box). Kept for Grid designs whose
 * generated base sheet was drawn with it: a re-fill must land on the plan the
 * design actually has (grid-auto-layout venueFrame, intake.baseSheetTemplate).
 */
export function legacyProsGeom(s: AState) {
  const W = 640, ML = 58, MR = 138, MT = 52;
  const wing = s.wing || 0;
  const houseWft = s.width + 2 * wing;
  const ppf = (W - ML - MR) / Math.max(houseWft, 1);
  const depthPx = Math.max(150, s.depth * ppf);
  const pitFt = s.sys.pit ? Math.min(Math.max(s.depth * 0.16, 6), 12) : 0;
  const pitPx = pitFt * ppf;
  const xHouseL = ML, xHouseR = W - MR, cx = (xHouseL + xHouseR) / 2;
  const yBack = MT, yPlaster = yBack + depthPx;
  const xProcL = cx - (s.width / 2) * ppf, xProcR = cx + (s.width / 2) * ppf, openW = xProcR - xProcL;
  const apronFt = 6, apronPx = apronFt * ppf, apronBulge = apronPx * 0.7;
  const yApron = yPlaster + apronPx, yApronFront = yApron + apronBulge;
  const defHalfFt = houseWft / 2;
  const minHalfFt = s.width / 2 + 1.5, maxHalfFt = Math.min(cx - 12, W - 12 - cx) / ppf;
  let halfFt = typeof s.houseHalfFt === "number" && s.houseHalfFt > 0 ? s.houseHalfFt : defHalfFt;
  halfFt = Math.max(minHalfFt, Math.min(halfFt, maxHalfFt));
  const halfPx = halfFt * ppf, xAudL = R(cx - halfPx), xAudR = R(cx + halfPx);
  const yHouseFront = R(yPlaster);
  const seatTop = R(yApronFront) + 16, seatRows = 4, seatGap = 13;
  const seatBottom = seatTop + seatRows * seatGap;
  const yBackWall = R(seatBottom + 16);
  const boothW = R(Math.min(openW * 0.5, halfPx * 1.05));
  const boothH = 24, yBoothBottom = R(yBackWall + boothH);
  const yMix = R(seatTop + (seatBottom - seatTop) * 0.6);
  const doorsL = Array.isArray(s.doorsL) ? s.doorsL : [0.34, 0.82];
  const doorsR = Array.isArray(s.doorsR) ? s.doorsR : [0.34, 0.82];
  const doorsBack = Array.isArray(s.doorsBack) ? s.doorsBack : [0.13, 0.87];
  const H = R(yBoothBottom + 22);
  return {
    W, H, ML, MR, MT, wing, houseWft, ppf, depthPx, apronFt, apronPx, apronBulge, pitFt, pitPx,
    yApron, yApronFront, xHouseL, xHouseR, cx, yBack, yPlaster, xProcL, xProcR, openW,
    halfFt, halfPx, minHalfFt, maxHalfFt, xAudL, xAudR, yHouseFront, seatTop, seatRows, seatGap,
    seatBottom, yBackWall, boothW, boothH, yBoothBottom, yMix, doorsL, doorsR, doorsBack,
    stage: { x: xProcL, y: yBack, w: openW, h: depthPx },
  };
}
