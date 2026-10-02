/**
 * #296 — pure rack elevation geometry. One placement list → a flat `Shape[]`
 * in inches (y grows downward, RU 1 at the bottom) that `svg.ts` serializes;
 * the builder sidebar and the printed submittal draw the SAME string.
 *
 * Span, lane and shelf rules come from `layout.ts` — nothing here re-derives
 * them. No React, no store/db imports.
 */
import { textExtent, type Shape } from "@/lib/curtain-cut-sheets/shapes";
import { childrenOf, laneSpan, occupiedSpan, placementFacts, ruRangeLabel } from "./layout";
import { ruLabel } from "./rules";
import { RU_IN, type RackConfig, type RackFace, type RackLayout, type RackPartInfo, type RackPartLookup, type RackPlacement } from "./types";

export const RACK_GEOM = { railIn: 1.6, panelIn: 19, marginIn: 0.6, labelSize: 0.55, ruNumberSize: 0.45 } as const;

const INSET = 0.04;
const TITLE_BAND = 1.2;
const TITLE_SIZE = 0.7;
const LABEL_PAD = 0.3;
const RESERVED_TEXT = "Reserved — future";
const TRAY_IN = 0.25; // the shelf tray band, at the bottom of the shelf's occupied span

export type RackSlot = { placementId: string; x: number; y: number; w: number; h: number; face: RackFace };
export type RackGeometryOpts = {
  face: RackFace;
  numbering?: RackConfig["numbering"];
  ghostOppositeFace?: boolean;
  title?: string;
  /** Prefix for the hatch pattern id, so several SVGs can share a page. Used by `svg.ts`. */
  idPrefix?: string;
  /** "screen" (default): non-scaling px strokes. "absolute": user-unit strokes for rasterizers that ignore vector-effect. Used by `svg.ts`. */
  strokeMode?: "screen" | "absolute";
};
/** A text shape that wants a white halo so it stays legible over hatching (read by `svg.ts`). */
export type RackTextShape = Extract<Shape, { kind: "text" }> & { halo?: true };

type Rect = { x: number; y: number; w: number; h: number };

/** Three-place rounding as a string — the one number format the SVG serializer and slot coordinates share. */
export const fmt = (n: number) => String(+n.toFixed(3));
const rnd = (n: number) => +fmt(n);
const rounded = (r: Rect): Rect => ({ x: rnd(r.x), y: rnd(r.y), w: rnd(r.w), h: rnd(r.h) });

/** Collapse whitespace so a pasted label can't add line breaks to a one-line text shape. */
const oneLine = (s: string) => s.replace(/\s+/g, " ").trim();

/** `text` shortened with "…" until `textExtent` fits `maxW`; null when even "…" doesn't fit. */
function fitText(text: string, size: number, maxW: number): string | null {
  const width = (t: string) => {
    const e = textExtent({ x: 0, text: t, size, anchor: "middle" });
    return e.x1 - e.x0;
  };
  if (width(text) <= maxW) return text;
  const chars = Array.from(text);
  for (let n = chars.length - 1; n >= 0; n--) {
    const cand = chars.slice(0, n).join("").trimEnd() + "…";
    if (width(cand) <= maxW) return cand;
  }
  return null;
}

export function rackGeometry(
  layout: RackLayout,
  lookup: RackPartLookup,
  opts: RackGeometryOpts
): { viewBox: { w: number; h: number }; shapes: Shape[]; slots: RackSlot[] } {
  const { config } = layout;
  const { railIn, panelIn, marginIn, labelSize, ruNumberSize } = RACK_GEOM;
  const ruCount = config.ruCount;
  const numbering = opts.numbering ?? config.numbering;
  const numCfg = { ruCount, numbering };

  const top = marginIn + (opts.title ? TITLE_BAND : 0);
  const bodyH = ruCount * RU_IN;
  const W = 2 * marginIn + 2 * railIn + panelIn;
  const H = top + bodyH + marginIn;
  const panelX0 = marginIn + railIn;
  const panelX1 = panelX0 + panelIn;
  const rightRailX = panelX1;
  const ruTop = (ru: number) => top + (ruCount - ru) * RU_IN; // top edge of RU `ru`

  const shapes: Shape[] = [];
  const slots: RackSlot[] = [];

  /* ---- title, frame, rails ---- */
  if (opts.title) {
    const t = fitText(oneLine(opts.title), TITLE_SIZE, W - 2 * marginIn);
    if (t) shapes.push({ kind: "text", x: W / 2, y: marginIn + TITLE_BAND / 2 + TITLE_SIZE * 0.2, text: t, size: TITLE_SIZE, anchor: "middle", bold: true });
  }
  shapes.push({ kind: "rect", x: marginIn, y: top, w: railIn, h: bodyH, stroke: "med", fill: "none" });
  shapes.push({ kind: "rect", x: rightRailX, y: top, w: railIn, h: bodyH, stroke: "med", fill: "none" });
  shapes.push({ kind: "rect", x: panelX0, y: top, w: panelIn, h: bodyH, stroke: "thin", fill: "none" });
  for (let r = 1; r < ruCount; r++) {
    const y = top + r * RU_IN;
    shapes.push({ kind: "line", x1: marginIn, y1: y, x2: marginIn + railIn, y2: y, stroke: "thin" });
    shapes.push({ kind: "line", x1: rightRailX, y1: y, x2: rightRailX + railIn, y2: y, stroke: "thin" });
  }
  for (let ru = 1; ru <= ruCount; ru++) {
    const n = ruLabel(numCfg, ru);
    const y = ruTop(ru) + RU_IN / 2 + ruNumberSize * 0.35;
    const bold = n % 5 === 0;
    shapes.push({ kind: "text", x: marginIn + railIn / 2, y, text: String(n), size: ruNumberSize, anchor: "middle", bold });
    shapes.push({ kind: "text", x: rightRailX + railIn / 2, y, text: String(n), size: ruNumberSize, anchor: "middle", bold });
  }

  /* ---- placement boxes ---- */
  const laneX = (p: RackPlacement): { x: number; w: number } => {
    const [a, b] = laneSpan(p);
    return { x: panelX0 + a * panelIn + INSET, w: (b - a) * panelIn - 2 * INSET };
  };
  /** The drawn box for RU `lo..hi`, clamped to the frame; null when none of it is inside (a draft may be out of range). */
  const spanRect = (p: RackPlacement, lo: number, hi: number): Rect | null => {
    if (!Number.isFinite(lo) || !Number.isFinite(hi)) return null;
    const a = Math.max(1, lo);
    const b = Math.min(ruCount, hi);
    if (a > b) return null;
    const { x, w } = laneX(p);
    return rounded({ x, y: ruTop(b) + INSET, w, h: (b - a + 1) * RU_IN - 2 * INSET });
  };

  const drawLabel = (p: RackPlacement, r: Rect) => {
    if (p.kind === "vent" && !p.label) return; // identified by its slats
    const info = p.sku ? lookup(p.sku) : undefined;
    const clean = (s: string | undefined) => (s ? oneLine(s) : "");
    const line1 = clean(p.label) || (p.kind === "reserved" ? RESERVED_TEXT : clean(info?.desc) || clean(p.sku));
    if (!line1) return;
    const maxW = r.w - LABEL_PAD;
    const cx = r.x + r.w / 2;
    const cy = r.y + r.h / 2;
    const l2 = p.kind !== "reserved" && p.kind !== "vent" && p.ruHeight >= 2 ? `${clean(info?.mfr)} ${clean(p.sku)}`.trim() : "";
    const size2 = labelSize * 0.8;
    const t1 = fitText(line1, labelSize, maxW);
    const t2 = l2 && l2 !== line1 ? fitText(l2, size2, maxW) : null;
    const halo = p.kind === "reserved" || p.kind === "vent" ? ({ halo: true } as const) : {};
    if (t1 && t2) {
      const y1 = cy - 0.08;
      shapes.push({ kind: "text", x: cx, y: y1, text: t1, size: labelSize, anchor: "middle", ...halo } as RackTextShape);
      shapes.push({ kind: "text", x: cx, y: y1 + size2 * 1.4, text: t2, size: size2, anchor: "middle" });
    } else if (t1) {
      shapes.push({ kind: "text", x: cx, y: cy + labelSize * 0.35, text: t1, size: labelSize, anchor: "middle", ...halo } as RackTextShape);
    }
  };

  const drawBox = (p: RackPlacement, r: Rect, face: RackFace) => {
    const fill = p.kind === "device" ? "none" : p.kind === "reserved" ? "hatch" : "tone";
    shapes.push({ kind: "rect", x: r.x, y: r.y, w: r.w, h: r.h, stroke: "med", fill, ...(p.optional ? { dash: true } : {}) });
    if (p.kind === "vent") {
      for (const f of [0.25, 0.5, 0.75]) {
        const y = r.y + r.h * f;
        shapes.push({ kind: "line", x1: r.x + r.w * 0.15, y1: y, x2: r.x + r.w * 0.85, y2: y, stroke: "thin", tag: "band" });
      }
    }
    drawLabel(p, r);
    slots.push({ placementId: p.id, x: r.x, y: r.y, w: r.w, h: r.h, face });
  };

  /* ---- the opposite face, faintly, when its devices run deep ---- */
  if (opts.ghostOppositeFace) {
    for (const p of layout.placements) {
      if (p.shelfId || p.face === opts.face || p.kind !== "device") continue;
      const depth = placementFacts(p, lookup).depthIn;
      if (depth !== undefined && !(config.depthIn !== undefined && depth > config.depthIn / 2)) continue;
      const r = spanRect(p, p.ruStart, p.ruStart + p.ruHeight - 1);
      if (r) shapes.push({ kind: "rect", x: r.x, y: r.y, w: r.w, h: r.h, stroke: "thin", dash: true });
    }
  }

  /* ---- this face: top-level placements, a shelf's devices right after it ---- */
  for (const p of layout.placements) {
    if (p.shelfId || p.face !== opts.face) continue;
    if (p.kind !== "shelf") {
      const r = spanRect(p, p.ruStart, p.ruStart + p.ruHeight - 1);
      if (r) drawBox(p, r, opts.face);
      continue;
    }
    // A shelf is the outline of everything the engine reserves for it (D575: its own
    // rows, plus the extension for a tall device); the tray is a thin band at the bottom.
    const span = occupiedSpan(layout, p)!;
    const box = spanRect(p, span.lo, span.hi);
    if (!box) continue;
    const bandTop = rnd(box.y + box.h - TRAY_IN);
    shapes.push({ kind: "rect", x: box.x, y: box.y, w: box.w, h: box.h, stroke: "med", fill: "none", ...(p.optional ? { dash: true } : {}) });
    shapes.push({ kind: "rect", x: box.x, y: bandTop, w: box.w, h: TRAY_IN, stroke: "thin", fill: "tone" });
    const kids = childrenOf(layout, p.id);
    if (kids.length === 0) drawLabel(p, { ...box, h: box.h - TRAY_IN });
    slots.push({ placementId: p.id, x: box.x, y: box.y, w: box.w, h: box.h, face: opts.face });
    for (const c of kids) {
      const { x, w } = laneX(c);
      const cell = c.ruHeight * RU_IN;
      // Bottom on the tray band; a device as tall as the whole span is trimmed to clear it.
      const y = Math.max(box.y, bandTop - cell + INSET);
      const h = bandTop - INSET - y;
      if (h > 0) drawBox(c, rounded({ x, y, w, h }), opts.face);
    }
  }

  return { viewBox: { w: W, h: H }, shapes, slots };
}

/* ---------- interaction helpers (the shared RackElevation component) ---------- */

/**
 * Screen-reader text for a placement: "RU 12–13, front: QSC CXD4.3". The name is
 * the drawn label's first line (label > "Reserved — future" > catalog description > SKU).
 * Pass `layout` so a shelf reads its extended span (D575).
 */
export function slotAriaLabel(p: RackPlacement, info: RackPartInfo | undefined, config: RackConfig, layout?: RackLayout): string {
  const span = (layout ? occupiedSpan(layout, p) : null) ?? { lo: p.ruStart, hi: p.ruStart + p.ruHeight - 1 };
  const clean = (s: string | undefined) => (s ? oneLine(s) : "");
  const name = clean(p.label) || (p.kind === "reserved" ? RESERVED_TEXT : clean(info?.desc) || clean(p.sku) || "Unnamed part");
  return `${ruRangeLabel(config, span.lo, span.hi)}, ${p.face}: ${name}${p.optional ? " (optional)" : ""}`;
}

/**
 * The snapped `ruStart` for a part of `ruHeight` RU under a pointer at `yIn`
 * (drawing inches, y down). The ghost centers on the pointer's RU row and is
 * clamped to the rack. `title` must match how the drawing was rendered.
 */
export function ruFromPointer(yIn: number, config: Pick<RackConfig, "ruCount">, ruHeight: number, opts?: { title?: boolean }): number {
  const { ruCount } = config;
  const top = RACK_GEOM.marginIn + (opts?.title ? TITLE_BAND : 0);
  const row = Math.min(ruCount - 1, Math.max(0, Math.floor((yIn - top) / RU_IN)));
  const pointerRu = ruCount - row;
  const h = Math.max(1, Math.round(ruHeight));
  return Math.max(1, Math.min(ruCount - h + 1, pointerRu - Math.floor((h - 1) / 2)));
}

/** The lane (0-based) under a pointer at `xIn` for a part `laneCount` lanes wide, clamped. */
export function laneFromPointer(xIn: number, laneCount: 1 | 2 | 3): 0 | 1 | 2 {
  const x0 = RACK_GEOM.marginIn + RACK_GEOM.railIn;
  const lane = Math.floor(((xIn - x0) / RACK_GEOM.panelIn) * laneCount);
  return Math.max(0, Math.min(laneCount - 1, lane)) as 0 | 1 | 2;
}

/** The slot under a point. A shelf's slot contains its devices', which come after it — so the last hit wins. */
export function slotAt(slots: readonly RackSlot[], x: number, y: number): RackSlot | null {
  for (let i = slots.length - 1; i >= 0; i--) {
    const s = slots[i];
    if (x >= s.x && x <= s.x + s.w && y >= s.y && y <= s.y + s.h) return s;
  }
  return null;
}

/** The box a part of `ruHeight` RU at `ruStart` in `lane` of `laneCount` would draw — same rounding as a placed slot. */
export function ghostRect(
  config: Pick<RackConfig, "ruCount">,
  ruStart: number,
  ruHeight: number,
  lane: number,
  laneCount: 1 | 2 | 3,
  opts?: { title?: boolean }
): { x: number; y: number; w: number; h: number } {
  const { marginIn, railIn, panelIn } = RACK_GEOM;
  const top = marginIn + (opts?.title ? TITLE_BAND : 0);
  const hi = ruStart + ruHeight - 1;
  const x0 = marginIn + railIn;
  return rounded({
    x: x0 + (lane / laneCount) * panelIn + INSET,
    y: top + (config.ruCount - hi) * RU_IN + INSET,
    w: panelIn / laneCount - 2 * INSET,
    h: ruHeight * RU_IN - 2 * INSET,
  });
}
