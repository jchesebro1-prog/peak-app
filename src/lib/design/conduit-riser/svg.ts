/**
 * Conduit riser (#321) — geometry → SVG markup for the editor and the
 * printed drawing-set sheet. Blocks are expanded in place (a <g> per
 * insert), so the SVG and the DXF draw the same primitives. Pure.
 */

import { BLOCKS, type Geo } from "./drawing";

/** SVG user units per sheet inch. */
const U = 100;
const n = (v: number) => String(Math.round(v * U * 100) / 100);

export function escapeXml(s: string): string {
  // XML 1.0 forbids most C0 controls — a stray one from an import would break the SVG.
  return s.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffe\uffff]/g, "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

const STROKE: Record<string, string> = {
  TAG: "#222",
  CONDUIT: "#222",
  CABLEMGMT: "#222",
  SIGNAL: "#222",
  LEVEL: "#888",
  TEXT: "#111",
  TABLE: "#222",
};

function prim(g: Geo, layer: string): string {
  const stroke = STROKE[layer] || "#222";
  const dash = (d?: boolean) => (d ? ` stroke-dasharray="${n(0.08)} ${n(0.05)}"` : "");
  switch (g.t) {
    case "line":
      return `<line x1="${n(g.a.x)}" y1="${n(g.a.y)}" x2="${n(g.b.x)}" y2="${n(g.b.y)}" stroke="${stroke}" stroke-width="${n(0.008)}"${dash(g.dashed)}/>`;
    case "poly": {
      const pts = g.pts.map((p) => `${n(p.x)},${n(p.y)}`).join(" ");
      return `<${g.closed ? "polygon" : "polyline"} points="${pts}" fill="${g.closed ? "#fff" : "none"}" stroke="${stroke}" stroke-width="${n(0.008)}"${dash(g.dashed)}/>`;
    }
    case "rect":
      return `<rect x="${n(g.r.x)}" y="${n(g.r.y)}" width="${n(g.r.w)}" height="${n(g.r.h)}" fill="${g.fill ? "#c8c8c8" : "none"}" stroke="${stroke}" stroke-width="${n(0.008)}"/>`;
    case "circle":
      return `<circle cx="${n(g.c.x)}" cy="${n(g.c.y)}" r="${n(g.r)}" fill="#fff" stroke="${stroke}" stroke-width="${n(0.008)}"/>`;
    case "text":
      if (!g.s) return "";
      return `<text x="${n(g.at.x)}" y="${n(g.at.y)}" font-size="${n(g.h * 1.4)}" text-anchor="${g.anchor}" dominant-baseline="central" font-family="Arial, Helvetica, sans-serif" fill="#111">${escapeXml(g.s)}</text>`;
    case "insert": {
      const def = BLOCKS[g.block];
      const inner = [
        ...def.geo.map((b) => prim(b, g.layer)),
        ...def.attrs.map((a) => prim({ t: "text", at: a.at, s: g.attrs[a.tag] ?? "", h: a.h, anchor: a.anchor, layer: g.layer }, g.layer)),
      ].join("");
      const scale = g.scale === 1 ? "" : ` scale(${g.scale})`;
      return `<g data-block="${g.block}" transform="translate(${n(g.at.x)} ${n(g.at.y)})${scale}">${inner}</g>`;
    }
  }
}

/** A complete <svg> for `size` inches. */
export function geometryToSvg(geo: readonly Geo[], size: { w: number; h: number }): string {
  const body = geo.map((g) => prim(g, g.layer)).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${n(size.w)} ${n(size.h)}" width="${size.w}in" height="${size.h}in">${body}</svg>`;
}
