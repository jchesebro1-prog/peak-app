// src/lib/design/room-shape/svg.ts
import { inPoly, rowSpans } from "@/lib/design/venue-templates/canvas";
import { arcInfo, bounds, centroid, dist, edgeLength, edgeMid, outlinePoints, outwardNormalAt, sampleEdge, signedArea, wallBands } from "./geometry";
import type { RoomShape, SheetFrame, ShapePt, ShapeRoom } from "./types";
import { fmtFeet } from "./units";

const n3 = (v: number) => String(Math.round(v * 1000) / 1000);
const esc = (s: string) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** A closed path through sampled points. */
export function pathD(pts: readonly ShapePt[]): string {
  return pts.length ? `M${pts.map((p) => `${n3(p.x)} ${n3(p.y)}`).join("L")}Z` : "";
}

/** Where a room's name goes: its centroid when inside, else the middle of the widest span across its centroid's row. */
export function labelPoint(room: Pick<ShapeRoom, "pts" | "edges">): ShapePt {
  const poly = outlinePoints(room, 1, 16);
  const c = centroid(poly);
  if (inPoly(poly, c)) return c;
  const spans = rowSpans(poly, c.y);
  if (!spans.length) return c;
  const [x0, x1] = spans.reduce((w, s) => (s[1] - s[0] > w[1] - w[0] ? s : w));
  return { x: (x0 + x1) / 2, y: c.y };
}

const NAME_FT = 1.1;
type Box = { x0: number; y0: number; x1: number; y1: number };
const nameBox = (name: string, at: ShapePt): Box => {
  const w = name.length * NAME_FT * 0.62 + 0.4, h = NAME_FT * 1.4;
  return { x0: at.x - w / 2, y0: at.y - h / 2, x1: at.x + w / 2, y1: at.y + h / 2 };
};
const hit = (a: Box, b: Box) => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;
const boxInside = (poly: ShapePt[], b: Box) =>
  [[b.x0, b.y0], [b.x1, b.y0], [b.x1, b.y1], [b.x0, b.y1], [(b.x0 + b.x1) / 2, b.y0], [(b.x0 + b.x1) / 2, b.y1]].every(([x, y]) => inPoly(poly, { x, y }));

/**
 * Where every name goes. Each room starts at `labelPoint`; where names would sit on top of each other (a bowl around a floor
 * around a court all share one centre) the smaller room keeps the spot and the larger one moves to the nearest clear place
 * inside its own outline — preferring ground not covered by a smaller room. Deterministic.
 */
function placeNames(rooms: readonly ShapeRoom[]): ShapePt[] {
  const polys = rooms.map((r) => outlinePoints(r, 1, 16));
  const area = polys.map((p) => Math.abs(signedArea(p)));
  const at = rooms.map((r) => labelPoint(r));
  const order = rooms.map((_, i) => i).sort((a, b) => area[a] - area[b] || a - b);
  const placed: Box[] = [];
  for (const i of order) {
    const first = nameBox(rooms[i].name, at[i]);
    if (!placed.some((q) => hit(first, q))) { placed.push(first); continue; }
    const bb = bounds(polys[i]);
    const step = Math.max(1, Math.max(bb.maxX - bb.minX, bb.maxY - bb.minY) / 48);
    const smaller = order.filter((j) => j !== i && area[j] < area[i]);
    let best: { p: ShapePt; score: number } | null = null;
    for (let y = bb.minY + step / 2; y < bb.maxY; y += step) {
      for (let x = bb.minX + step / 2; x < bb.maxX; x += step) {
        const p = { x, y }, box = nameBox(rooms[i].name, p);
        if (placed.some((q) => hit(box, q)) || !boxInside(polys[i], box)) continue;
        const covered = smaller.some((j) => inPoly(polys[j], p));
        const score = dist(p, at[i]) + (covered ? 1e6 : 0);
        if (!best || score < best.score) best = { p, score };
      }
    }
    if (best) at[i] = best.p;
    placed.push(nameBox(rooms[i].name, at[i]));
  }
  return at;
}

export type ShapeSheet = { markup: string; frame: SheetFrame; widthPx: number; heightPx: number };

const MARGIN_FT = 8;
const W_PX = 1200;
const WALL = "#3a3f4a", ROOM_FILL = "#f4f5f7", ZONE = "#6b7280", OPEN = "#9aa0ab", DIM = "#737985";
const FONT = "IBM Plex Mono, monospace";

/**
 * #370: the base sheet drawn from a room shape — rooms (light fill, 6" walls on walled edges, a fine dashed line on
 * openings), zones (dashed), names, and a dimension on each walled edge of 4' or more. viewBox in feet; the frame
 * (with an 8' margin, grown to `extraPts`) is what every feet ↔ sheet conversion uses.
 */
export function roomShapeSvg(shape: RoomShape, opts: { extraPts?: readonly ShapePt[] } = {}): ShapeSheet {
  const rooms = [...shape.rooms].sort((a, b) => Math.abs(signedArea(outlinePoints(b, 2, 8))) - Math.abs(signedArea(outlinePoints(a, 2, 8))));
  const bands = rooms.flatMap((r) => wallBands(r));
  const b = bounds([...rooms.flatMap((r) => outlinePoints(r, 1, 32)), ...bands.flat(), ...(opts.extraPts ?? [])]);
  const minX = Math.floor(b.minX - MARGIN_FT), minY = Math.floor(b.minY - MARGIN_FT);
  const wFt = Math.ceil(b.maxX + MARGIN_FT) - minX, hFt = Math.ceil(b.maxY + MARGIN_FT) - minY;
  const frame: SheetFrame = { minX, minY, wFt, hFt };
  const heightPx = Math.round((W_PX * hFt) / wFt);
  const parts: string[] = [`<rect x="${minX}" y="${minY}" width="${wFt}" height="${hFt}" fill="#fff"/>`];
  for (const r of rooms) {
    const d = pathD(outlinePoints(r));
    parts.push(r.kind === "zone"
      ? `<path data-k="zone" d="${d}" fill="none" stroke="${ZONE}" stroke-width="0.15" stroke-dasharray="1 0.6"/>`
      : `<path data-k="room" d="${d}" fill="${ROOM_FILL}"/>`);
  }
  for (const r of rooms) {
    if (r.kind === "zone") continue;
    for (const band of wallBands(r)) parts.push(`<path data-k="wall" d="${pathD(band)}" fill="${WALL}"/>`);
    const n = r.pts.length;
    for (let i = 0; i < n; i++) {
      if (!r.edges[i].open) continue;
      const pts = [...sampleEdge(r.pts[i], r.pts[(i + 1) % n], r.edges[i], 0.5, 64), r.pts[(i + 1) % n]];
      parts.push(`<path data-k="open" d="M${pts.map((p) => `${n3(p.x)} ${n3(p.y)}`).join("L")}" fill="none" stroke="${OPEN}" stroke-width="0.06" stroke-dasharray="0.5 0.4"/>`);
    }
  }
  for (const r of rooms) {
    if (r.kind === "zone") continue;
    const n = r.pts.length, area = signedArea(outlinePoints(r, 0.5, 32));
    for (let i = 0; i < n; i++) {
      const a = r.pts[i], q = r.pts[(i + 1) % n], e = r.edges[i];
      if (e.open || dist(a, q) < 4) continue;
      const m = edgeMid(a, q, e), nn = outwardNormalAt(area, a, q, e, 0.5);
      const at = { x: m.x + nn.x * 1.6, y: m.y + nn.y * 1.6 };
      let deg = (Math.atan2(q.y - a.y, q.x - a.x) * 180) / Math.PI;
      if (deg > 90) deg -= 180;
      if (deg < -90) deg += 180;
      const A = e.kind === "arc" ? arcInfo(a, q, e.bulge) : null;
      const text = A ? `R ${fmtFeet(A.r)}` : fmtFeet(edgeLength(a, q, e));
      parts.push(`<text data-k="dim" x="${n3(at.x)}" y="${n3(at.y)}" transform="rotate(${n3(deg)} ${n3(at.x)} ${n3(at.y)})" text-anchor="middle" dominant-baseline="middle" font-size="0.8" fill="${DIM}" font-family="${FONT}">${esc(text)}</text>`);
    }
  }
  const names = placeNames(rooms);
  for (const [k, r] of rooms.entries()) {
    const p = names[k];
    parts.push(`<text data-k="name" x="${n3(p.x)}" y="${n3(p.y)}" text-anchor="middle" dominant-baseline="middle" font-size="1.1" font-weight="600" fill="${WALL}" font-family="${FONT}">${esc(r.name)}</text>`);
  }
  const markup = `<svg xmlns="http://www.w3.org/2000/svg" width="${W_PX}" height="${heightPx}" viewBox="${minX} ${minY} ${wFt} ${hFt}" preserveAspectRatio="xMidYMid meet">${parts.join("")}</svg>`;
  return { markup, frame, widthPx: W_PX, heightPx };
}
