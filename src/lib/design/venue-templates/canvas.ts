import type { Pt, StretchedPlan } from "./types";

/** A stretched template laid on the 640-px plan canvas (#249, #255): drawing inches y UP → px y DOWN. */
export type Box = { x: number; y: number; w: number; h: number };
export type Margins = { W: number; ML: number; MR: number; MT: number; MB: number };

const R = (n: number) => Math.round(n * 10) / 10;

export const boxOf = (pts: Pt[]): Box => {
  const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
  const x = Math.min(...xs), y = Math.min(...ys);
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
};

export function canvasOf(plan: StretchedPlan, m: Margins) {
  const b = plan.bounds;
  const ppi = (m.W - m.ML - m.MR) / Math.max(b.maxX - b.minX, 1);
  const px = (p: Pt): Pt => ({ x: R(m.ML + (p.x - b.minX) * ppi), y: R(m.MT + (b.maxY - p.y) * ppi) });
  const fromPx = (p: Pt): Pt => ({ x: b.minX + (p.x - m.ML) / ppi, y: b.maxY - (p.y - m.MT) / ppi });
  const regions: Record<string, Pt[]> = {};
  for (const [id, pts] of Object.entries(plan.regions)) regions[id] = pts.map(px);
  return {
    W: m.W,
    H: R(m.MT + (b.maxY - b.minY) * ppi + m.MB),
    ppi,
    ppf: ppi * 12,
    px,
    fromPx,
    regions,
    polylines: plan.polylines.map((pl) => pl.map(px)),
    labels: plan.labels.map((l) => ({ text: l.text, ...px(l), h: R(l.h * ppi) })),
  };
}

/** The x-intervals where the horizontal line `y` lies inside `poly` (even-odd). */
export function rowSpans(poly: Pt[], y: number): Array<[number, number]> {
  const xs: number[] = [];
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[j], b = poly[i];
    if (a.y > y !== b.y > y) xs.push(a.x + ((y - a.y) * (b.x - a.x)) / (b.y - a.y));
  }
  xs.sort((p, q) => p - q);
  const out: Array<[number, number]> = [];
  for (let i = 0; i + 1 < xs.length; i += 2) out.push([xs[i], xs[i + 1]]);
  return out;
}

/** #255: whether `p` lies inside `poly` (even-odd). */
export function inPoly(poly: Pt[], p: Pt): boolean {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) c = !c;
  }
  return c;
}

/** #255: the distance from `p` to the nearest edge of the closed outline `poly`. */
export function distToPoly(poly: Pt[], p: Pt): number {
  let m = Infinity;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    const ab = { x: b.x - a.x, y: b.y - a.y }, L2 = ab.x ** 2 + ab.y ** 2;
    const t = L2 ? Math.max(0, Math.min(1, ((p.x - a.x) * ab.x + (p.y - a.y) * ab.y) / L2)) : 0;
    m = Math.min(m, Math.hypot(p.x - a.x - t * ab.x, p.y - a.y - t * ab.y));
  }
  return m;
}

/** The movable rooms' centres on the canvas (#255). */
export function movablesPx(plan: StretchedPlan, px: (p: Pt) => Pt): Array<{ id: string; centre: Pt }> {
  return Object.entries(plan.movables).map(([id, m]) => ({ id, centre: px(m.centre) }));
}
