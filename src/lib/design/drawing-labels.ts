/**
 * Drawing-set label placement (#209 final review I2/I3). Pure and
 * dependency-free (the grid-bom rule) — the riser canvas (server + client),
 * the plan-sheet figure (client) and the spec harness all import it.
 *
 * Two jobs, one greedy idea: try a short, fixed list of candidate spots in
 * order of preference and take the first that hits nothing already on the
 * sheet. Deterministic (same input → same drawing), never a solver.
 *
 *  - placeChip: a riser edge/conduit label along its Bézier, clear of every
 *    node box and every chip placed before it.
 *  - assignTypeMarks + placeLabels: plan-sheet type marks (L1, L2 …) and
 *    where each symbol's mark sits, clear of symbols, earlier marks, space
 *    names and (when it can) wire routes.
 */

export type Pt = { x: number; y: number };
export type Rect = { x: number; y: number; w: number; h: number };
/** A cubic Bézier's four control points: start, c1, c2, end. */
export type Bezier = readonly [Pt, Pt, Pt, Pt];

export function bezierAt(c: Bezier, t: number): Pt {
  const u = 1 - t;
  const a = u * u * u;
  const b = 3 * u * u * t;
  const d = 3 * u * t * t;
  const e = t * t * t;
  return { x: a * c[0].x + b * c[1].x + d * c[2].x + e * c[3].x, y: a * c[0].y + b * c[1].y + d * c[2].y + e * c[3].y };
}

export function rectsHit(a: Rect, b: Rect, pad = 0): boolean {
  return a.x < b.x + b.w + pad && b.x < a.x + a.w + pad && a.y < b.y + b.h + pad && b.y < a.y + a.h + pad;
}

/* --------------------------------- riser --------------------------------- */

/** Where along the curve a chip may sit, most-preferred first. */
export const CHIP_TS = [0.5, 0.4, 0.6, 0.3, 0.7, 0.2, 0.8] as const;
/** Vertical nudges tried at each spot. */
export const CHIP_DYS = [0, 14, -14, 28, -28] as const;
/** Gap between a same-side loop's apex and its chip. */
const LOOP_GAP = 4;

/**
 * The first chip rect along `curve` that hits no obstacle (node boxes and
 * chips already placed). A same-side loop (`side` set: both ends on one
 * node's right, 1, or left, -1, edge) anchors its chip OUTSIDE the loop —
 * beside the curve point, away from the box — instead of centring on it,
 * which would put half the chip over the node. Null when every candidate is
 * blocked: the caller falls back to a short tag.
 */
export function placeChip(curve: { pts: Bezier; side?: 1 | -1 }, w: number, h: number, obstacles: readonly Rect[]): Rect | null {
  for (const t of CHIP_TS) {
    const p = bezierAt(curve.pts, t);
    for (const dy of CHIP_DYS) {
      const x = curve.side === 1 ? p.x + LOOP_GAP : curve.side === -1 ? p.x - LOOP_GAP - w : p.x - w / 2;
      const r: Rect = { x, y: p.y + dy - h / 2, w, h };
      if (!obstacles.some((o) => rectsHit(r, o))) return r;
    }
  }
  return null;
}

/* ---------------------------------- plan ---------------------------------- */

/** `qty` = the symbol's unit count (#211: a lot marker stands for many
 *  units); absent = 1. */
export type TypeMarkItem = { key: string; desc: string; qty?: number };

/** A symbol's unit count — grid-bom placementQty's rule, inlined to keep this
 *  module dependency-free. */
function unitsOf(qty: number | undefined): number {
  const n = Math.round(Number(qty));
  return Number.isFinite(n) && n > 1 ? n : 1;
}
export type TypeMarkRow = { tag: string; key: string; desc: string; qty: number };

/**
 * Per-sheet type marks: one tag per distinct part (key), numbered in the
 * order the parts are first seen and prefixed with the sheet's system letter
 * (L1, L2 … on L-101; A1 … on A-101). Returns each key's tag and the device
 * key rows (tag · qty · description) in tag order. A row's qty sums UNITS,
 * so a 240-unit lot marker counts 240, not 1 (#211 fix wave 1, I3).
 */
export function assignTypeMarks(items: readonly TypeMarkItem[], prefix: string): { tags: Map<string, string>; rows: TypeMarkRow[] } {
  const tags = new Map<string, string>();
  const rows: TypeMarkRow[] = [];
  const byKey = new Map<string, TypeMarkRow>();
  for (const it of items) {
    const hit = byKey.get(it.key);
    if (hit) {
      hit.qty += unitsOf(it.qty);
      continue;
    }
    const row: TypeMarkRow = { tag: `${prefix}${rows.length + 1}`, key: it.key, desc: it.desc, qty: unitsOf(it.qty) };
    rows.push(row);
    byKey.set(it.key, row);
    tags.set(it.key, row.tag);
  }
  return { tags, rows };
}

export type LabelSpot = "above-right" | "right" | "left" | "above" | "below";
/** Candidate order for a type mark around its symbol. */
export const LABEL_SPOTS: readonly LabelSpot[] = ["above-right", "right", "left", "above", "below"];

/** A symbol (centre + size) and the size of its mark, in one unit space. */
export type LabelSymbol = { x: number; y: number; w: number; h: number; tw: number; th: number };

export function symbolRect(s: { x: number; y: number; w: number; h: number }): Rect {
  return { x: s.x - s.w / 2, y: s.y - s.h / 2, w: s.w, h: s.h };
}

export function labelRectAt(s: LabelSymbol, spot: LabelSpot, gap: number): Rect {
  const right = s.x + s.w / 2 + gap;
  switch (spot) {
    case "above-right":
      return { x: right, y: s.y - s.h / 2 - s.th * 0.6, w: s.tw, h: s.th };
    case "right":
      return { x: right, y: s.y - s.th / 2, w: s.tw, h: s.th };
    case "left":
      return { x: s.x - s.w / 2 - gap - s.tw, y: s.y - s.th / 2, w: s.tw, h: s.th };
    case "above":
      return { x: s.x - s.tw / 2, y: s.y - s.h / 2 - gap - s.th, w: s.tw, h: s.th };
    case "below":
      return { x: s.x - s.tw / 2, y: s.y + s.h / 2 + gap, w: s.tw, h: s.th };
  }
}

/** Does segment ab cross (or lie in) rect r? */
export function segmentHitsRect(a: Pt, b: Pt, r: Rect): boolean {
  const inside = (p: Pt) => p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h;
  if (inside(a) || inside(b)) return true;
  // Liang–Barsky clip of the segment against the rect.
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  let t0 = 0;
  let t1 = 1;
  const edges: Array<[number, number]> = [
    [-dx, a.x - r.x],
    [dx, r.x + r.w - a.x],
    [-dy, a.y - r.y],
    [dy, r.y + r.h - a.y],
  ];
  for (const [p, q] of edges) {
    if (p === 0) {
      if (q < 0) return false;
      continue;
    }
    const t = q / p;
    if (p < 0) {
      if (t > t1) return false;
      if (t > t0) t0 = t;
    } else {
      if (t < t0) return false;
      if (t < t1) t1 = t;
    }
  }
  return t0 <= t1;
}

/**
 * Greedy collision pass for plan type marks, in input order. Each mark tries
 * LABEL_SPOTS and takes the first that stays inside `bounds` and hits no
 * symbol box, no earlier mark and no fixed obstacle (space names); a first
 * pass also keeps clear of wire `segments`, a second lets a mark sit on a
 * wire rather than on a device. A mark with no clear spot at all takes its
 * preferred spot (above-right) — visible beats missing.
 */
export function placeLabels(input: {
  symbols: readonly LabelSymbol[];
  obstacles?: readonly Rect[];
  segments?: ReadonlyArray<readonly [Pt, Pt]>;
  gap?: number;
  bounds?: { w: number; h: number };
}): Rect[] {
  const gap = input.gap ?? 2;
  const boxes = input.symbols.map(symbolRect);
  const fixed = input.obstacles || [];
  const segs = input.segments || [];
  const placed: Rect[] = [];
  const inBounds = (r: Rect) => !input.bounds || (r.x >= 0 && r.y >= 0 && r.x + r.w <= input.bounds.w && r.y + r.h <= input.bounds.h);
  const clear = (r: Rect, avoidWires: boolean) =>
    inBounds(r) &&
    !boxes.some((b) => rectsHit(r, b)) &&
    !placed.some((p) => rectsHit(r, p)) &&
    !fixed.some((o) => rectsHit(r, o)) &&
    (!avoidWires || !segs.some(([a, b]) => segmentHitsRect(a, b, r)));
  for (const s of input.symbols) {
    let got: Rect | null = null;
    for (const avoidWires of [true, false]) {
      for (const spot of LABEL_SPOTS) {
        const r = labelRectAt(s, spot, gap);
        if (clear(r, avoidWires)) {
          got = r;
          break;
        }
      }
      if (got) break;
    }
    placed.push(got || labelRectAt(s, "above-right", gap));
  }
  return placed;
}

/**
 * Where a space's name goes on a plan: inside the space's top-left corner
 * first (base sheets usually letter their own room names at the centre, and
 * a second name on top of that reads as a smudge), then the other corners,
 * then the centre — the first spot fully `inside` the polygon that hits no
 * symbol or mark in `avoid`. Rect in the caller's units.
 */
export function spaceNameRect(
  points: readonly Pt[],
  tw: number,
  th: number,
  avoid: readonly Rect[],
  pad: number,
  inside: (p: Pt) => boolean = () => true
): Rect {
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const x0 = Math.min(...xs);
  const x1 = Math.max(...xs);
  const y0 = Math.min(...ys);
  const y1 = Math.max(...ys);
  const cx = points.reduce((a, p) => a + p.x, 0) / (points.length || 1);
  const cy = points.reduce((a, p) => a + p.y, 0) / (points.length || 1);
  const spots: Rect[] = [
    { x: x0 + pad, y: y0 + pad, w: tw, h: th },
    { x: x1 - pad - tw, y: y0 + pad, w: tw, h: th },
    { x: x0 + pad, y: y1 - pad - th, w: tw, h: th },
    { x: x1 - pad - tw, y: y1 - pad - th, w: tw, h: th },
  ];
  const centre: Rect = { x: cx - tw / 2, y: cy - th / 2, w: tw, h: th };
  const corners = (r: Rect) => [
    { x: r.x, y: r.y },
    { x: r.x + r.w, y: r.y },
    { x: r.x, y: r.y + r.h },
    { x: r.x + r.w, y: r.y + r.h },
  ];
  return spots.find((r) => corners(r).every(inside) && !avoid.some((a) => rectsHit(r, a))) || centre;
}

/**
 * Where a plan sheet's device key goes: a column beside the plan, or a band
 * under it (only for a short key) — whichever leaves the bigger plan. Inches.
 */
export function planKeyLayout(input: {
  areaW: number;
  areaH: number;
  captionH: number;
  aspect: number | null;
  rows: number;
  /** Printed lines the key's rows take (a wrapped designators cell is more
   *  than one); defaults to `rows`. */
  lines?: number;
  k: number;
}): { side: boolean; keyW: number; keyH: number; planW: number; planH: number } {
  const { areaW, areaH, captionH, aspect, rows, k } = input;
  const lines = Math.max(rows, input.lines ?? rows);
  const gap = 0.2 * k;
  const keyW = rows > 0 ? 2.3 * k : 0;
  const keyH = rows > 0 ? (Math.min(lines, KEY_MAX_ROWS) + 2.2) * 0.2 * k : 0;
  const side = { side: true, keyW, keyH, planW: Math.max(0, areaW - (keyW ? keyW + gap : 0)), planH: areaH - captionH };
  if (!rows || !(aspect && aspect > 0) || rows > 6 || lines > 6) return side;
  const bottom = { side: false, keyW, keyH, planW: areaW, planH: Math.max(0, areaH - captionH - keyH - gap) };
  const fitW = (w: number, h: number) => Math.min(w, h / aspect);
  return fitW(bottom.planW, bottom.planH) > fitW(side.planW, side.planH) ? bottom : side;
}

/** Device-key lines a plan sheet prints before it says "+N more" (one line
 *  per row unless a designators cell wraps — #320). */
export const KEY_MAX_ROWS = 36;

/** #320: characters of the key's Designators cell per printed line. The cell
 *  is 38 % of a 2.3 in key (≈ 57 pt after padding) in 7.5 pt mono (4.5 pt a
 *  character) → about 12 on paper; 10 is the conservative budget. */
export const KEY_DESIGNATOR_CHARS_PER_LINE = 10;

/**
 * Printed lines a comma list takes in a cell `width` characters wide when it
 * wraps only after ", " (a token longer than a line breaks anywhere). A greedy
 * pack that never counts fewer lines than the browser would draw. >= 1.
 */
export function wrapLineCount(text: string, width: number): number {
  const w = Math.max(1, Math.floor(width));
  if (!text) return 1;
  const parts = text.split(", ");
  let lines = 1;
  let used = 0;
  parts.forEach((part, i) => {
    const t = i < parts.length - 1 ? `${part},` : part;
    const len = t.length;
    if (used === 0 ? len <= w : used + 1 + len <= w) {
      used = used === 0 ? len : used + 1 + len;
      return;
    }
    if (used > 0) lines += 1;
    lines += Math.ceil(len / w) - 1;
    used = ((len - 1) % w) + 1;
  });
  return lines;
}

/** #320: the most designator lines one device-key row prints. The key is an
 *  index — the E-60x schedule is the record — so a longer list is cut. */
export const KEY_ROW_MAX_LINES = 4;
/** What a cut key row ends with. */
export const KEY_CUT_SUFFIX = "… see schedule";

/**
 * A device-key row's designators as printed: as is when they fit
 * KEY_ROW_MAX_LINES; else the most leading ", "-separated designators that
 * fit with KEY_CUT_SUFFIX after them (at least the first, whole). Never cuts
 * inside a designator: a lone over-long one is left whole (designators cap at
 * 24 characters, so that is at most 3 lines).
 */
export function capKeyTag(tag: string): string {
  const fits = (t: string) => wrapLineCount(t, KEY_DESIGNATOR_CHARS_PER_LINE) <= KEY_ROW_MAX_LINES;
  if (fits(tag)) return tag;
  const tokens = tag.split(", ");
  if (tokens.length === 1) return tag;
  const cut = (k: number) => `${tokens.slice(0, k).join(", ")} ${KEY_CUT_SUFFIX}`;
  let keep = 1;
  while (keep + 1 < tokens.length && fits(cut(keep + 1))) keep += 1;
  return cut(keep);
}

/** Lines one device-key row prints (its designators cell wraps; capped —
 *  capKeyTag). */
export function keyRowLines(tag: string): number {
  return wrapLineCount(capKeyTag(tag), KEY_DESIGNATOR_CHARS_PER_LINE);
}

/** How many key rows fit the line budget, and the lines they take. Order is
 *  kept (no skipping); the first row always shows, even if taller than the
 *  budget. One-line rows: min(rows, KEY_MAX_ROWS), exactly as before. */
export function planKeyVisible(rows: ReadonlyArray<{ tag: string }>): { shown: number; lines: number } {
  let lines = 0;
  let shown = 0;
  for (const r of rows) {
    const n = keyRowLines(r.tag);
    if (shown > 0 && lines + n > KEY_MAX_ROWS) break;
    lines += n;
    shown += 1;
  }
  return { shown, lines };
}

/** Raster zoom for a PDF plan sheet (#209 I6): about `dpi` across the width
 *  the page will print at inside a `boxW` × `boxH` inch box, capped at
 *  `maxPixels` per canvas. `pageW`/`pageH` are the page's scale-1 viewport
 *  (PDF points). Floored at 1 (screen resolution) unless the pixel cap
 *  itself is lower — the cap always wins. */
export function printZoom(pageW: number, pageH: number, boxW: number, boxH: number, dpi = 200, maxPixels = 12e6): number {
  if (!(pageW > 0) || !(pageH > 0) || !(boxW > 0) || !(boxH > 0)) return 2;
  const fitW = Math.min(boxW, (boxH * pageW) / pageH);
  const cap = Math.sqrt(maxPixels / (pageW * pageH));
  const z = Math.max(Math.min(1, cap), Math.min(cap, (fitW * dpi) / pageW));
  return Math.floor(z * 1000) / 1000;
}
