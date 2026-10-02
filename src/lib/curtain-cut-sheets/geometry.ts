/**
 * Curtain cut sheets (#292) — the front elevation as pure shapes in PAPER
 * INCHES (spec §2.4), drawn from finished dimensions (decision 2). Returns
 * shapes, never JSX.
 */
import { textExtent, type Shape } from "./shapes";
import type { CurtainSize } from "./parse";
import type { CurtainBottomFinish, CurtainTopFinish } from "./vocab";

export type SizedPanel = CurtainSize & { qty?: number };

const FRACTIONS = ["", "1/4", "1/2", "3/4"];

/** Feet → ft-in to the nearest 1/4": 21.5 → 21'-6"; 0.75 → 0'-9"; 6.0208 → 6'-0 1/4". */
export function ftIn(ft: number): string {
  const q = Math.round((Number.isFinite(ft) ? ft : 0) * 48);
  const sign = q < 0 ? "-" : "";
  const a = Math.abs(q);
  const feet = Math.floor(a / 48);
  const rem = a - feet * 48;
  const frac = FRACTIONS[rem % 4];
  return `${sign}${feet}'-${Math.floor(rem / 4)}${frac ? " " + frac : ""}"`;
}

/** Inches → `12"`, `11 3/4"` (nearest 1/4"). */
export function inchLabel(inches: number): string {
  const q = Math.max(0, Math.round((Number.isFinite(inches) ? inches : 0) * 4));
  const frac = FRACTIONS[q % 4];
  const whole = Math.floor(q / 4);
  return `${frac && whole === 0 ? "" : whole + (frac ? " " : "")}${frac}"`;
}

/** Largest first. */
export const ARCH_SCALES: ReadonlyArray<{ label: string; inPerFt: number }> = [
  { label: `1"=1'-0"`, inPerFt: 1 },
  { label: `3/4"=1'-0"`, inPerFt: 0.75 },
  { label: `1/2"=1'-0"`, inPerFt: 0.5 },
  { label: `3/8"=1'-0"`, inPerFt: 0.375 },
  { label: `1/4"=1'-0"`, inPerFt: 0.25 },
  { label: `3/16"=1'-0"`, inPerFt: 0.1875 },
  { label: `1/8"=1'-0"`, inPerFt: 0.125 },
  { label: `3/32"=1'-0"`, inPerFt: 0.09375 },
  { label: `1/16"=1'-0"`, inPerFt: 0.0625 },
];
/** Room kept on every side of the drawn panels for dimensions and labels, in. */
export const ELEV_DIM_IN = 0.6;
/** Space between side-by-side panels, in. */
export const ELEV_GAP_IN = 0.5;
export const ELEV_TEXT_IN = 0.085;
const TOP_BAND_FT = 3.5 / 12; // webbing (Open question 5)
const BOTTOM_BAND_FT = 4 / 12; // hem / pocket (Open question 5)
const MIN_BAND_IN = 0.06;

/** Up to 3 distinct sizes, largest area first; more than 3 → only the largest, flagged `typical`. */
export function drawnPanels(sizes: readonly SizedPanel[]): { panels: SizedPanel[]; typical: boolean; count: number } {
  const sorted = sizes
    .filter((s) => s.widthFt > 0 && s.heightFt > 0)
    .slice()
    .sort((a, b) => b.widthFt * b.heightFt - a.widthFt * a.heightFt || b.widthFt - a.widthFt);
  return sorted.length > 3 ? { panels: sorted.slice(0, 1), typical: true, count: sorted.length } : { panels: sorted, typical: false, count: sorted.length };
}

/** The largest architectural scale at which every drawn panel fits the box; the smallest scale when none does. */
export function pickScale(sizes: readonly SizedPanel[], box: { wIn: number; hIn: number }): { label: string; inPerFt: number } {
  const { panels } = drawnPanels(sizes);
  const sumW = panels.reduce((a, p) => a + p.widthFt, 0);
  const maxH = panels.reduce((a, p) => Math.max(a, p.heightFt), 0);
  const availW = box.wIn - 2 * ELEV_DIM_IN;
  const availH = box.hIn - 2 * ELEV_DIM_IN;
  for (const s of ARCH_SCALES) {
    const w = sumW * s.inPerFt + Math.max(0, panels.length - 1) * ELEV_GAP_IN;
    if (w <= availW + 1e-9 && maxH * s.inPerFt <= availH + 1e-9) return s;
  }
  return ARCH_SCALES[ARCH_SCALES.length - 1];
}

/** Smallest mark spacing honored, in, and the most marks one panel ever draws (a runaway input never hangs a render). */
export const MIN_MARK_SPACING_IN = 1;
export const MAX_MARKS = 2000;

/** Evenly spaced marks, both ends always marked: count = ceil(W·12 ÷ s) + 1, at W·12 ÷ (count − 1) ≤ s (until the caps). */
export function topMarks(widthFt: number, maxSpacingIn: number): { count: number; spacingIn: number } {
  const wIn = widthFt * 12;
  if (!(wIn > 0) || !(maxSpacingIn > 0)) return { count: 0, spacingIn: 0 };
  const count = Math.min(MAX_MARKS, Math.ceil(wIn / Math.max(MIN_MARK_SPACING_IN, maxSpacingIn) - 1e-9) + 1);
  return { count, spacingIn: wIn / (count - 1) };
}

export function elevation(input: {
  sizes: readonly SizedPanel[];
  fullnessPct: number;
  top: CurtainTopFinish;
  bottom: CurtainBottomFinish;
  markSpacingIn: number;
  markLabel: "Grommets" | "Carriers";
  box: { wIn: number; hIn: number };
}): { scale: string; shapes: Shape[] } {
  const { panels, typical, count: drawnCount } = drawnPanels(input.sizes);
  const scale = pickScale(input.sizes, input.box);
  const s = scale.inPerFt;
  const shapes: Shape[] = [];
  const y = ELEV_DIM_IN;
  let x = ELEV_DIM_IN;
  let maxH = 0;
  for (const [pi, p] of panels.entries()) {
    const w = p.widthFt * s;
    const h = p.heightFt * s;
    maxH = Math.max(maxH, h);
    const topH = Math.max(MIN_BAND_IN, TOP_BAND_FT * s);
    const botH = Math.max(MIN_BAND_IN, BOTTOM_BAND_FT * s);
    shapes.push({ kind: "rect", tag: "panel", x, y, w, h, stroke: "heavy" });
    // fullness: thin pleat lines at half the mark spacing; none when flat
    if (input.fullnessPct > 0) {
      const step = Math.max(0.04, (input.markSpacingIn / 2 / 12) * s);
      for (let px = x + step, n = 0; px < x + w - 1e-6 && n < 400; px += step, n++) {
        shapes.push({ kind: "line", tag: "pleat", x1: px, y1: y + topH, x2: px, y2: y + h - botH, stroke: "thin" });
      }
    }
    // top band
    shapes.push({ kind: "rect", tag: "band", x, y, w, h: topH, stroke: "med", fill: input.top === "hook-loop" ? "hatch" : "tone" });
    if (input.top === "grommets") {
      const m = topMarks(p.widthFt, input.markSpacingIn);
      const r = Math.min(topH * 0.3, 0.03);
      for (let i = 0; i < m.count; i++) {
        shapes.push({ kind: "circle", tag: "mark", cx: x + ((i * m.spacingIn) / 12) * s, cy: y + topH / 2, r, stroke: "thin", fill: "none" });
      }
      if (m.count >= 2) {
        const x2 = x + (m.spacingIn / 12) * s;
        const dy = y - 0.1;
        // the full o.c. label prints once (first panel); the rest carry only their count
        const full = `${input.markLabel} @ ${inchLabel(input.markSpacingIn)} o.c. max (${m.count})`;
        const label = pi === 0 ? full : `(${m.count})`;
        const raise = pi === 0 && panels.length > 1 && textExtent({ x, text: full, size: ELEV_TEXT_IN }).x1 > x + w + ELEV_GAP_IN - 0.05;
        shapes.push(
          { kind: "line", tag: "dim", x1: x, y1: dy, x2, y2: dy, stroke: "thin" },
          { kind: "line", tag: "dim", x1: x, y1: dy - 0.04, x2: x, y2: y, stroke: "thin" },
          { kind: "line", tag: "dim", x1: x2, y1: dy - 0.04, x2, y2: y, stroke: "thin" },
          { kind: "text", x, y: dy - 0.06 - (raise ? 0.12 : 0), text: label, size: ELEV_TEXT_IN }
        );
      }
    } else {
      shapes.push({ kind: "text", x, y: y - 0.1, text: input.top === "pipe-pocket" ? "Pipe pocket" : "Hook-and-loop", size: ELEV_TEXT_IN });
    }
    // bottom
    const by = y + h - botH;
    if (input.bottom === "hem") {
      shapes.push({ kind: "line", tag: "band", x1: x, y1: by, x2: x + w, y2: by, stroke: "thin" });
    } else {
      shapes.push({ kind: "rect", tag: "band", x, y: by, w, h: botH, stroke: "med", fill: "tone" });
      if (input.bottom === "chain") shapes.push({ kind: "line", tag: "band", x1: x, y1: by + botH / 2, x2: x + w, y2: by + botH / 2, stroke: "thin", dash: true });
    }
    const bottomLabel = input.bottom === "chain" ? "Chain pocket" : input.bottom === "pipe-pocket" ? "Pipe pocket" : "Hem";
    {
      // fit the label to the panel: one line, else two lines, shrinking to a floor; omitted when even that cannot fit
      const room = w - 0.04;
      const base = ELEV_TEXT_IN * 0.85;
      const lines = [bottomLabel, bottomLabel.replace(" ", "\n")];
      for (const text of lines) {
        const longest = Math.max(...text.split("\n").map((l) => l.length));
        const size = Math.min(base, room / (longest * 0.6));
        if (size < 0.055) continue;
        const nl = text.split("\n").length;
        shapes.push({ kind: "text", x: x + w / 2, y: by - 0.04 - (nl - 1) * size * 1.15, text, size, anchor: "middle" });
        break;
      }
    }
    // overall width, then the qty of this size, under the panel
    const wy = y + h + 0.16;
    shapes.push(
      { kind: "line", tag: "dim", x1: x, y1: wy, x2: x + w, y2: wy, stroke: "thin" },
      { kind: "line", tag: "dim", x1: x, y1: y + h + 0.03, x2: x, y2: wy + 0.04, stroke: "thin" },
      { kind: "line", tag: "dim", x1: x + w, y1: y + h + 0.03, x2: x + w, y2: wy + 0.04, stroke: "thin" },
      { kind: "text", x: x + w / 2, y: wy + 0.13, text: ftIn(p.widthFt), size: ELEV_TEXT_IN, anchor: "middle" },
      { kind: "text", x: x + w / 2, y: wy + 0.26, text: `Qty ${p.qty ?? 1}`, size: ELEV_TEXT_IN, anchor: "middle", bold: true }
    );
    // overall height, left of the panel
    const hx = x - 0.16;
    shapes.push(
      { kind: "line", tag: "dim", x1: hx, y1: y, x2: hx, y2: y + h, stroke: "thin" },
      { kind: "line", tag: "dim", x1: hx - 0.04, y1: y, x2: x - 0.03, y2: y, stroke: "thin" },
      { kind: "line", tag: "dim", x1: hx - 0.04, y1: y + h, x2: x - 0.03, y2: y + h, stroke: "thin" },
      { kind: "text", x: hx - 0.05, y: y + h / 2, text: ftIn(p.heightFt), size: ELEV_TEXT_IN, anchor: "middle", rotate: -90 }
    );
    x += w + ELEV_GAP_IN;
  }
  if (typical) {
    shapes.push({ kind: "text", x: ELEV_DIM_IN, y: y + maxH + 0.56, text: `Typical — ${drawnCount} sizes, see schedule`, size: ELEV_TEXT_IN, bold: true });
  }
  return { scale: scale.label, shapes };
}
