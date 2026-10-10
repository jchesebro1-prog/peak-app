/**
 * Conduit riser (#321) — geometry → DXF text, for CAD. Written as AutoCAD
 * R12 (AC1009) ASCII: no handles or object dictionaries to get wrong, and
 * every CAD package (AutoCAD, Vectorworks, Revit, BricsCAD) reads it; DWG is
 * one Save As away. Units are sheet inches at 1:1, y flipped up. Tags,
 * signal bubbles, power diamonds and stubs are BLOCKs with ATTDEFs, inserted
 * with ATTRIBs, so a drafter can restyle a block or edit an attribute. Each
 * layer is `PK-RISER-<LAYER>`; no title block. Pure.
 */

import { BLOCKS, LAYERS, type Anchor, type BlockName, type Geo, type Layer } from "./drawing";

export const DXF_LAYER = (l: Layer) => `PK-RISER-${l}`;
const LAYER_COLOR: Record<Layer, number> = { TAG: 7, CONDUIT: 7, CABLEMGMT: 7, SIGNAL: 7, LEVEL: 8, TEXT: 7, TABLE: 7 };
/** ACI 9 — light gray, the tag header fill. */
const FILL_COLOR = 9;

const f = (v: number) => {
  const s = (Math.round(v * 10000) / 10000).toFixed(4).replace(/\.?0+$/, "");
  return s === "-0" ? "0" : s;
};

/** DXF R12 text: ASCII only, AutoCAD's %% codes for Ø and °, ≤ 250 chars. */
export function dxfText(s: string): string {
  return s
    .replace(/[\r\n\t]+/g, " ")
    .replace(/%%/g, "% %")
    .replace(/[‒-―−]/g, "-")
    .replace(/[‘’]/g, "'")
    .replace(/[“”″]/g, '"')
    .replace(/[ØøⲐ⌀]/g, "%%c")
    .replace(/°/g, "%%d")
    .replace(/×/g, "x")
    .replace(/[^\x20-\x7e]/g, "?")
    .slice(0, 250);
}

const HJ: Record<Anchor, number> = { start: 0, middle: 1, end: 2 };

class Out {
  private parts: string[] = [];
  g(code: number, value: string | number): this {
    this.parts.push(String(code), typeof value === "number" ? f(value) : value);
    return this;
  }
  toString(): string {
    return this.parts.join("\n") + "\n";
  }
}

type Xf = { x: (v: number) => number; y: (v: number) => number; s: number };

function entity(o: Out, g: Geo, layer: string, X: Xf): void {
  const lt = (d?: boolean) => {
    if (d) o.g(6, "DASHED");
  };
  switch (g.t) {
    case "line":
      o.g(0, "LINE").g(8, layer);
      lt(g.dashed);
      o.g(10, X.x(g.a.x)).g(20, X.y(g.a.y)).g(30, 0).g(11, X.x(g.b.x)).g(21, X.y(g.b.y)).g(31, 0);
      return;
    case "poly":
      o.g(0, "POLYLINE").g(8, layer);
      lt(g.dashed);
      o.g(66, 1).g(10, 0).g(20, 0).g(30, 0).g(70, g.closed ? 1 : 0);
      for (const p of g.pts) o.g(0, "VERTEX").g(8, layer).g(10, X.x(p.x)).g(20, X.y(p.y)).g(30, 0);
      o.g(0, "SEQEND").g(8, layer);
      return;
    case "rect": {
      const [x0, y0, x1, y1] = [X.x(g.r.x), X.y(g.r.y), X.x(g.r.x + g.r.w), X.y(g.r.y + g.r.h)];
      if (g.fill) {
        o.g(0, "SOLID").g(8, layer).g(62, FILL_COLOR)
          .g(10, x0).g(20, y0).g(30, 0).g(11, x1).g(21, y0).g(31, 0)
          .g(12, x0).g(22, y1).g(32, 0).g(13, x1).g(23, y1).g(33, 0);
      }
      o.g(0, "POLYLINE").g(8, layer).g(66, 1).g(10, 0).g(20, 0).g(30, 0).g(70, 1);
      for (const [px, py] of [[x0, y0], [x1, y0], [x1, y1], [x0, y1]]) o.g(0, "VERTEX").g(8, layer).g(10, px).g(20, py).g(30, 0);
      o.g(0, "SEQEND").g(8, layer);
      return;
    }
    case "circle":
      o.g(0, "CIRCLE").g(8, layer).g(10, X.x(g.c.x)).g(20, X.y(g.c.y)).g(30, 0).g(40, g.r * X.s);
      return;
    case "text": {
      if (!g.s) return;
      const x = X.x(g.at.x);
      const y = X.y(g.at.y);
      o.g(0, "TEXT").g(8, layer).g(10, x).g(20, y).g(30, 0).g(40, g.h * X.s).g(1, dxfText(g.s)).g(7, "STANDARD")
        .g(72, HJ[g.anchor]).g(11, x).g(21, y).g(31, 0).g(73, 2);
      return;
    }
    case "insert": {
      const def = BLOCKS[g.block];
      const ix = X.x(g.at.x);
      const iy = X.y(g.at.y);
      const s = g.scale * X.s;
      o.g(0, "INSERT").g(8, layer).g(66, 1).g(2, g.block).g(10, ix).g(20, iy).g(30, 0).g(41, s).g(42, s).g(43, s);
      for (const a of def.attrs) {
        const ax = ix + a.at.x * s;
        const ay = iy - a.at.y * s;
        o.g(0, "ATTRIB").g(8, layer).g(10, ax).g(20, ay).g(30, 0).g(40, a.h * s).g(1, dxfText(g.attrs[a.tag] ?? "")).g(2, a.tag)
          .g(70, 0).g(7, "STANDARD").g(72, HJ[a.anchor]).g(11, ax).g(21, ay).g(31, 0).g(74, 2);
      }
      o.g(0, "SEQEND").g(8, layer);
      return;
    }
  }
}

function blockDef(o: Out, name: BlockName): void {
  const def = BLOCKS[name];
  // Block-local: x as drawn, y flipped about the insertion point.
  const X: Xf = { x: (v) => v, y: (v) => -v, s: 1 };
  o.g(0, "BLOCK").g(8, "0").g(2, name).g(70, 2).g(10, 0).g(20, 0).g(30, 0).g(3, name);
  for (const g of def.geo) entity(o, g, "0", X);
  for (const a of def.attrs) {
    o.g(0, "ATTDEF").g(8, "0").g(10, a.at.x).g(20, -a.at.y).g(30, 0).g(40, a.h).g(1, "").g(3, a.tag).g(2, a.tag)
      .g(70, 0).g(7, "STANDARD").g(72, HJ[a.anchor]).g(11, a.at.x).g(21, -a.at.y).g(31, 0).g(74, 2);
  }
  o.g(0, "ENDBLK").g(8, "0");
}

/** The whole DXF file for one sheet of `size` inches. */
export function geometryToDxf(geo: readonly Geo[], size: { w: number; h: number }): string {
  const o = new Out();
  const X: Xf = { x: (v) => v, y: (v) => size.h - v, s: 1 };
  o.g(0, "SECTION").g(2, "HEADER")
    .g(9, "$ACADVER").g(1, "AC1009")
    .g(9, "$INSBASE").g(10, 0).g(20, 0).g(30, 0)
    .g(9, "$EXTMIN").g(10, 0).g(20, 0).g(30, 0)
    .g(9, "$EXTMAX").g(10, size.w).g(20, size.h).g(30, 0)
    .g(9, "$LIMMIN").g(10, 0).g(20, 0)
    .g(9, "$LIMMAX").g(10, size.w).g(20, size.h)
    .g(9, "$LTSCALE").g(40, 1)
    .g(0, "ENDSEC");

  o.g(0, "SECTION").g(2, "TABLES");
  o.g(0, "TABLE").g(2, "LTYPE").g(70, 2);
  o.g(0, "LTYPE").g(2, "CONTINUOUS").g(70, 0).g(3, "Solid line").g(72, 65).g(73, 0).g(40, 0);
  o.g(0, "LTYPE").g(2, "DASHED").g(70, 0).g(3, "Dashed __ __ __").g(72, 65).g(73, 2).g(40, 0.13).g(49, 0.08).g(49, -0.05);
  o.g(0, "ENDTAB");
  o.g(0, "TABLE").g(2, "LAYER").g(70, LAYERS.length + 1);
  o.g(0, "LAYER").g(2, "0").g(70, 0).g(62, 7).g(6, "CONTINUOUS");
  for (const l of LAYERS) o.g(0, "LAYER").g(2, DXF_LAYER(l)).g(70, 0).g(62, LAYER_COLOR[l]).g(6, l === "CABLEMGMT" ? "DASHED" : "CONTINUOUS");
  o.g(0, "ENDTAB");
  o.g(0, "TABLE").g(2, "STYLE").g(70, 1);
  o.g(0, "STYLE").g(2, "STANDARD").g(70, 0).g(40, 0).g(41, 1).g(50, 0).g(71, 0).g(42, 0.1).g(3, "arial.ttf").g(4, "");
  o.g(0, "ENDTAB");
  o.g(0, "ENDSEC");

  o.g(0, "SECTION").g(2, "BLOCKS");
  for (const name of Object.keys(BLOCKS) as BlockName[]) blockDef(o, name);
  o.g(0, "ENDSEC");

  o.g(0, "SECTION").g(2, "ENTITIES");
  for (const g of geo) entity(o, g, DXF_LAYER(g.layer), X);
  o.g(0, "ENDSEC");
  o.g(0, "EOF");
  return o.toString();
}
