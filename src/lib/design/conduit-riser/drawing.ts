/**
 * Conduit riser (#321) — one drawing, two writers. Everything the sheet
 * shows becomes a flat list of primitives in sheet inches (y down): lines,
 * polylines, rectangles, text, circles and block inserts with attributes.
 * svg.ts and dxf.ts consume only this list, so the screen, the printed sheet
 * and the CAD file can never disagree. Pure.
 */

import { TAG_FOOT, TAG_H, TAG_HEAD, TAG_MID, TAG_W, STUB_W, STUB_H, MARGIN, type DetailLayout, type Rect } from "./layout";
import { LINE_DASHED, LINE_SOLID, type TableModel } from "./tables";
import type { Pt, RiserNote } from "./model";
import type { CRDevice } from "./input";
import type { ViewDetail } from "./derive";

export type Layer = "TAG" | "CONDUIT" | "CABLEMGMT" | "SIGNAL" | "LEVEL" | "TEXT" | "TABLE";
export const LAYERS: readonly Layer[] = ["TAG", "CONDUIT", "CABLEMGMT", "SIGNAL", "LEVEL", "TEXT", "TABLE"];
export type BlockName = "PK_TAG" | "PK_SIGNAL" | "PK_POWER" | "PK_STUB";
export type Anchor = "start" | "middle" | "end";

export type Geo =
  | { t: "line"; a: Pt; b: Pt; layer: Layer; dashed?: boolean }
  | { t: "poly"; pts: Pt[]; layer: Layer; dashed?: boolean; closed?: boolean }
  | { t: "rect"; r: Rect; layer: Layer; fill?: boolean }
  /** `at` is the text's vertical middle; `h` its cap height. */
  | { t: "text"; at: Pt; s: string; h: number; anchor: Anchor; layer: Layer }
  | { t: "circle"; c: Pt; r: number; layer: Layer }
  | { t: "insert"; block: BlockName; at: Pt; scale: number; attrs: Record<string, string>; layer: Layer };

export type AttrDef = { tag: string; at: Pt; h: number; anchor: Anchor };
export type BlockDef = { geo: Geo[]; attrs: AttrDef[] };

const P_CELL_X = 0.78;
const footY = TAG_HEAD + TAG_MID + TAG_FOOT / 2;
const midY = TAG_HEAD + TAG_MID / 2;

/** Block geometry is relative to the insertion point: a tag's top-left, a
 *  bubble's or diamond's centre, a stub's top-left. Layer "TAG" inside a
 *  block means "the insert's layer" (DXF layer 0 semantics). */
export const BLOCKS: Record<BlockName, BlockDef> = {
  PK_TAG: {
    geo: [
      { t: "rect", r: { x: 0, y: 0, w: TAG_W, h: TAG_HEAD }, layer: "TAG", fill: true },
      { t: "rect", r: { x: 0, y: 0, w: TAG_W, h: TAG_H }, layer: "TAG" },
      { t: "line", a: { x: 0, y: TAG_HEAD }, b: { x: TAG_W, y: TAG_HEAD }, layer: "TAG" },
      { t: "line", a: { x: 0, y: TAG_HEAD + TAG_MID }, b: { x: TAG_W, y: TAG_HEAD + TAG_MID }, layer: "TAG" },
      { t: "line", a: { x: P_CELL_X, y: TAG_HEAD }, b: { x: P_CELL_X, y: TAG_HEAD + TAG_MID }, layer: "TAG" },
      ...[0.25, 0.5, 0.75].map((x): Geo => ({ t: "line", a: { x: x * TAG_W, y: TAG_HEAD + TAG_MID }, b: { x: x * TAG_W, y: TAG_H }, layer: "TAG" })),
    ],
    attrs: [
      { tag: "ID", at: { x: TAG_W / 2, y: TAG_HEAD / 2 }, h: 0.085, anchor: "middle" },
      { tag: "LOC", at: { x: P_CELL_X / 2, y: midY }, h: 0.075, anchor: "middle" },
      { tag: "PD", at: { x: (P_CELL_X + TAG_W) / 2, y: midY }, h: 0.055, anchor: "middle" },
      { tag: "BOX", at: { x: 0.125 * TAG_W, y: footY }, h: 0.05, anchor: "middle" },
      { tag: "FACE", at: { x: 0.375 * TAG_W, y: footY }, h: 0.05, anchor: "middle" },
      { tag: "MOUNT", at: { x: 0.625 * TAG_W, y: footY }, h: 0.05, anchor: "middle" },
      { tag: "HT", at: { x: 0.875 * TAG_W, y: footY }, h: 0.05, anchor: "middle" },
    ],
  },
  PK_SIGNAL: {
    geo: [{ t: "circle", c: { x: 0, y: 0 }, r: 0.075, layer: "TAG" }],
    attrs: [{ tag: "SYM", at: { x: 0, y: 0 }, h: 0.06, anchor: "middle" }],
  },
  PK_POWER: {
    geo: [{ t: "poly", pts: [{ x: 0, y: -0.08 }, { x: 0.08, y: 0 }, { x: 0, y: 0.08 }, { x: -0.08, y: 0 }], layer: "TAG", closed: true }],
    attrs: [{ tag: "PWR", at: { x: 0, y: 0 }, h: 0.055, anchor: "middle" }],
  },
  PK_STUB: {
    geo: [{ t: "poly", pts: [{ x: STUB_W * 0.3, y: STUB_H }, { x: STUB_W * 0.3, y: STUB_H * 0.7 }, { x: STUB_W * 0.7, y: STUB_H * 0.7 }, { x: STUB_W * 0.7, y: STUB_H }], layer: "TAG" }],
    attrs: [{ tag: "LABEL", at: { x: STUB_W / 2, y: STUB_H * 0.3 }, h: 0.065, anchor: "middle" }],
  },
};

const r4 = (v: number) => Math.round(v * 10000) / 10000;
const U = (s: string) => s.toUpperCase();

/** One detail's geometry in detail-local inches, its title bubble below. */
export function detailGeometry(layout: DetailLayout, view: ViewDetail): { geo: Geo[]; w: number; h: number } {
  const geo: Geo[] = [];
  const dev = new Map<string, CRDevice>(view.tags.map((t) => [t.device.id, t.device]));
  for (const l of layout.levels) {
    geo.push({ t: "line", a: { x: l.x1, y: l.y }, b: { x: l.x2, y: l.y }, layer: "LEVEL", dashed: true });
    const text = U([l.label, l.elevation].filter(Boolean).join(" "));
    if (text) geo.push({ t: "text", at: { x: l.x1, y: r4(l.y - 0.07) }, s: text, h: 0.07, anchor: "start", layer: "LEVEL" });
  }
  for (const r of layout.runs) {
    geo.push({ t: "poly", pts: r.path, layer: r.dashed ? "CABLEMGMT" : "CONDUIT", dashed: r.dashed || undefined });
    if (!r.dashed) geo.push({ t: "text", at: r.sizeAt, s: r.size, h: 0.08, anchor: r.sizeAnchor, layer: "TEXT" });
    for (const b of r.bubbles) geo.push({ t: "insert", block: "PK_SIGNAL", at: b.c, scale: 1, attrs: { SYM: b.symbol }, layer: "SIGNAL" });
  }
  for (const it of layout.items) {
    if (it.kind === "tag") {
      const d = dev.get(it.id);
      if (!d) continue;
      geo.push({
        t: "insert",
        block: "PK_TAG",
        at: { x: it.rect.x, y: it.rect.y },
        scale: 1,
        attrs: { ID: U(d.label), LOC: U(d.tag.location), PD: d.tag.pd, BOX: d.tag.box, FACE: d.tag.face, MOUNT: d.tag.mount, HT: d.tag.height },
        layer: "TAG",
      });
      if (d.tag.power) {
        geo.push({ t: "insert", block: "PK_POWER", at: { x: r4(it.rect.x + TAG_W / 2), y: r4(it.rect.y + TAG_H + 0.12) }, scale: 1, attrs: { PWR: d.tag.power }, layer: "TAG" });
      }
    } else {
      geo.push({ t: "insert", block: "PK_STUB", at: { x: it.rect.x, y: it.rect.y }, scale: 1, attrs: { LABEL: U(it.label || "") }, layer: "TAG" });
    }
  }
  const ty = r4(layout.h + 0.3);
  geo.push({ t: "circle", c: { x: MARGIN + 0.17, y: ty }, r: 0.17, layer: "TEXT" });
  geo.push({ t: "text", at: { x: MARGIN + 0.17, y: ty }, s: view.detail.n, h: 0.1, anchor: "middle", layer: "TEXT" });
  geo.push({ t: "text", at: { x: MARGIN + 0.45, y: r4(ty - 0.04) }, s: U(view.detail.name), h: 0.12, anchor: "start", layer: "TEXT" });
  geo.push({ t: "line", a: { x: MARGIN + 0.45, y: r4(ty + 0.06) }, b: { x: r4(MARGIN + 0.45 + Math.max(1.2, view.detail.name.length * 0.1)), y: r4(ty + 0.06) }, layer: "TEXT" });
  geo.push({ t: "text", at: { x: r4(MARGIN + 0.45 + Math.max(1.2, view.detail.name.length * 0.1)), y: r4(ty + 0.14) }, s: "NTS", h: 0.06, anchor: "end", layer: "TEXT" });
  return { geo, w: layout.w, h: r4(layout.h + 0.6) };
}

const ROW_H = 0.17;
const HEAD_H = 0.18;
const TITLE_H = 0.22;

/** One table at `at` (top-left). */
export function tableGeometry(t: TableModel, at: Pt): { geo: Geo[]; w: number; h: number } {
  const geo: Geo[] = [];
  const w = t.columns.reduce((s, c) => s + c.w, 0);
  const hasHead = t.columns.some((c) => c.head);
  geo.push({ t: "text", at: { x: at.x, y: r4(at.y + 0.09) }, s: t.title, h: 0.1, anchor: "start", layer: "TABLE" });
  geo.push({ t: "line", a: { x: at.x, y: r4(at.y + 0.17) }, b: { x: r4(at.x + Math.min(w, t.title.length * 0.085)), y: r4(at.y + 0.17) }, layer: "TABLE" });
  let y = at.y + TITLE_H;
  const rowsH = (hasHead ? HEAD_H : 0) + t.rows.length * ROW_H;
  geo.push({ t: "rect", r: { x: at.x, y: r4(y), w: r4(w), h: r4(rowsH) }, layer: "TABLE" });
  const cells = (row: string[], top: number, h: number, size: number) => {
    let x = at.x;
    row.forEach((cell, i) => {
      const cw = t.columns[i]?.w ?? 0;
      if (i > 0) geo.push({ t: "line", a: { x: r4(x), y: r4(top) }, b: { x: r4(x), y: r4(top + h) }, layer: "TABLE" });
      if (cell === LINE_SOLID || cell === LINE_DASHED) {
        geo.push({ t: "line", a: { x: r4(x + 0.08), y: r4(top + h / 2) }, b: { x: r4(x + cw - 0.08), y: r4(top + h / 2) }, layer: "TABLE", dashed: cell === LINE_DASHED || undefined });
      } else if (cell) {
        geo.push({ t: "text", at: { x: r4(x + 0.05), y: r4(top + h / 2) }, s: cell, h: size, anchor: "start", layer: "TABLE" });
      }
      x += cw;
    });
  };
  if (hasHead) {
    cells(t.columns.map((c) => c.head), y, HEAD_H, 0.065);
    y += HEAD_H;
    geo.push({ t: "line", a: { x: at.x, y: r4(y) }, b: { x: r4(at.x + w), y: r4(y) }, layer: "TABLE" });
  }
  for (const row of t.rows) {
    cells(row, y, ROW_H, 0.06);
    y += ROW_H;
    geo.push({ t: "line", a: { x: at.x, y: r4(y) }, b: { x: r4(at.x + w), y: r4(y) }, layer: "TABLE" });
  }
  return { geo, w: r4(w), h: r4(TITLE_H + rowsH) };
}

/** Scale about the origin, then translate. */
export function transformGeo(g: Geo, s: number, dx: number, dy: number): Geo {
  const p = (q: Pt): Pt => ({ x: r4(q.x * s + dx), y: r4(q.y * s + dy) });
  switch (g.t) {
    case "line":
      return { ...g, a: p(g.a), b: p(g.b) };
    case "poly":
      return { ...g, pts: g.pts.map(p) };
    case "rect":
      return { ...g, r: { x: r4(g.r.x * s + dx), y: r4(g.r.y * s + dy), w: r4(g.r.w * s), h: r4(g.r.h * s) } };
    case "text":
      return { ...g, at: p(g.at), h: r4(g.h * s) };
    case "circle":
      return { ...g, c: p(g.c), r: r4(g.r * s) };
    case "insert":
      return { ...g, at: p(g.at), scale: r4(g.scale * s) };
  }
}

export type SheetPage = { geo: Geo[]; w: number; h: number };

/**
 * Pack the details (in order) onto sheet pages of `area` inches: tables and
 * notes stacked in a right-hand column on the first page, details shelf-
 * packed in what's left, each shrunk to fit if it alone is too big (NTS).
 */
export function composeSheets(input: {
  details: readonly { geo: Geo[]; w: number; h: number }[];
  tables: readonly TableModel[];
  notes: readonly RiserNote[];
  area: { w: number; h: number };
}): SheetPage[] {
  const { area } = input;
  const GAP = 0.4;
  const side: Geo[] = [];
  let colX = area.w;
  let colW = 0;
  let y = 0.2;
  const blocks: { geo: Geo[]; w: number; h: number; place: (x: number, y: number) => Geo[] }[] = input.tables.map((t) => {
    const probe = tableGeometry(t, { x: 0, y: 0 });
    return { geo: probe.geo, w: probe.w, h: probe.h, place: (x, yy) => tableGeometry(t, { x, y: yy }).geo };
  });
  if (input.notes.length) {
    const lines = input.notes.map((n) => `${n.n}. ${U(n.text)}`);
    const h = TITLE_H + lines.length * ROW_H;
    blocks.push({
      geo: [],
      w: 4,
      h,
      place: (x, yy) => [
        { t: "text", at: { x, y: r4(yy + 0.09) }, s: "GENERAL NOTES", h: 0.1, anchor: "start", layer: "TEXT" } as Geo,
        ...lines.map((s, i): Geo => ({ t: "text", at: { x, y: r4(yy + TITLE_H + i * ROW_H + ROW_H / 2) }, s, h: 0.06, anchor: "start", layer: "TEXT" })),
      ],
    });
  }
  // Columns of tables/notes, right to left.
  let column: typeof blocks = [];
  const flush = () => {
    if (!column.length) return;
    colW = Math.max(...column.map((b) => b.w));
    colX -= colW + GAP;
    let yy = 0.2;
    for (const b of column) {
      side.push(...b.place(r4(colX + GAP / 2), r4(yy)));
      yy += b.h + 0.3;
    }
    column = [];
  };
  for (const b of blocks) {
    if (column.length && y + b.h > area.h) {
      flush();
      y = 0.2;
    }
    column.push(b);
    y += b.h + 0.3;
  }
  flush();
  const firstW = Math.max(1, colX - GAP / 2);

  const pages: SheetPage[] = [{ geo: [...side], w: area.w, h: area.h }];
  let page = 0;
  let x = 0;
  let shelfY = 0;
  let shelfH = 0;
  const availW = () => (page === 0 ? firstW : area.w);
  for (const d of input.details) {
    let s = Math.min(1, availW() / d.w, area.h / d.h);
    let w = d.w * s;
    let h = d.h * s;
    if (x > 0 && x + w > availW()) {
      x = 0;
      shelfY += shelfH + GAP;
      shelfH = 0;
    }
    if (shelfY > 0 && shelfY + h > area.h) {
      pages.push({ geo: [], w: area.w, h: area.h });
      page++;
      x = 0;
      shelfY = 0;
      shelfH = 0;
      s = Math.min(1, availW() / d.w, area.h / d.h);
      w = d.w * s;
      h = d.h * s;
    }
    pages[page].geo.push(...d.geo.map((g) => transformGeo(g, s, x, shelfY)));
    x += w + GAP;
    shelfH = Math.max(shelfH, h);
  }
  return pages;
}
