/* Grid workspace — snap grid rules (#299). Pure: derives a snap step from the sheet calibration. */
import { clamp01, type MeasureUnit, type Point } from "@/lib/annotations";

export const SNAP_SPACINGS_FT = [0.5, 1, 2, 5] as const;
export const SNAP_PLAN_STEP = 0.01;
export const SNAP_ON_KEY = "pk.grid.snap.on.v1";
export const SNAP_FT_KEY = "pk.grid.snap.ft.v1";

export type SnapGrid = { stepX: number; stepY: number; label: string };

const FEET: Record<MeasureUnit, number> = { ft: 1, in: 1 / 12, m: 3.280839895, mm: 0.003280839895 };

/** "6\"" for half a foot, "N'" for whole feet. */
export function feetLabel(ft: number): string {
  if (Number.isInteger(ft)) return `${ft}'`;
  return `${Math.round(ft * 12)}"`;
}

/**
 * Snap steps as fractions of the sheet. Calibrated: `spacingFt` over the page width in feet; null when the
 * grid would be too dense (< 0.001) or too coarse (> 0.5) to help. Uncalibrated: 1% of the sheet.
 * `aspect` is size.h / size.w; stepY = stepX / aspect keeps the cells square on the sheet.
 */
export function snapGrid(
  cal: { scale: number; unit: MeasureUnit } | null | undefined,
  spacingFt: number,
  aspect: number,
): SnapGrid | null {
  const asp = Number.isFinite(aspect) && aspect > 0 ? aspect : 1;
  if (cal && Number.isFinite(cal.scale) && cal.scale > 0) {
    const pageFt = cal.scale * FEET[cal.unit];
    const stepX = spacingFt / pageFt;
    if (!Number.isFinite(stepX) || stepX < 0.001 || stepX > 0.5) return null;
    return { stepX, stepY: stepX / asp, label: feetLabel(spacingFt) };
  }
  return { stepX: SNAP_PLAN_STEP, stepY: SNAP_PLAN_STEP / asp, label: "1% of sheet" };
}

/** Round each axis to the nearest step and clamp to the sheet. A null grid returns the point unchanged. */
export function snapPoint(p: Point, g: SnapGrid | null): Point {
  if (!g) return p;
  return {
    x: clamp01(Math.round(p.x / g.stepX) * g.stepX),
    y: clamp01(Math.round(p.y / g.stepY) * g.stepY),
  };
}

/** The move that puts the anchor on the grid when dragged to `to`. */
export function snapDelta(anchor: Point, to: Point, g: SnapGrid | null): { dx: number; dy: number } {
  const t = g ? snapPoint(to, g) : to;
  return { dx: t.x - anchor.x, dy: t.y - anchor.y };
}
