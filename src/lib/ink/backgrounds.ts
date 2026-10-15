/* Venue Assessment notes (#344 C2) — pure SVG backgrounds for the Apple-Pencil sketch pads, plus the pad registry.
   Drawn in feet-scaled units (1 ft = 10 units) when the measurements parse, generic proportions otherwise.
   Pure and client-safe: strings in, strings out. */

export type SketchKey =
  | "beams" | "cwElevation" | "brick" | "stagePlan" | "stageSection" | "houseSection" | "housePlan" | "linesetSheet"
  | `linesetSheet${number}`;

export const SKETCH_PADS: Array<{ key: SketchKey; section: string; title: string; gate?: "counterweight" | "linesets" }> = [
  { key: "beams", section: "mBeams", title: "Beams & rigging sketch" },
  { key: "cwElevation", section: "mBeams", title: "CW elevation sketch", gate: "counterweight" },
  { key: "brick", section: "mBeams", title: "Brick drawing sketch", gate: "counterweight" },
  { key: "stagePlan", section: "mLayout", title: "Stage plan sketch" },
  { key: "stageSection", section: "mSection", title: "Stage section sketch" },
  { key: "houseSection", section: "mFOH", title: "House section sketch" },
  { key: "housePlan", section: "mHouse", title: "House plan sketch" },
  { key: "linesetSheet", section: "linesets", title: "Line set schedule sheet", gate: "linesets" },
];

export const LINESET_SHEET_COLUMNS = [
  "Set", "Dist. from PL", "Set name", "Type", "Batten", "Lift lines", "Goods", "Finished W×H", "Arbor load",
  "Trim low", "Trim high", "Condition", "Notes",
] as const;
export const LINESET_ROWS_PER_PAGE = 30;

const LINE = "#9aa0ab";
const TEXT = "#8c919c";
const U = 10; // units per foot
const MAX_FT = 300;

/** Free-text measurement ("38'-6\"", "38.5", "38 ft") → feet, or null. Same rules as the 3D preview's parser. */
export function feetOf(v: unknown): number | null {
  if (v == null || typeof v === "boolean") return null;
  const s = String(v).trim().replace(/[′’]/g, "'").replace(/[″”]/g, '"');
  if (!s) return null;
  let out: number | null = null;
  const ftIn = s.match(/^(\d+(?:\.\d+)?)\s*'\s*[- ]?\s*(\d+(?:\.\d+)?)?\s*"?$/);
  if (ftIn) out = parseFloat(ftIn[1]) + (ftIn[2] ? parseFloat(ftIn[2]) / 12 : 0);
  else {
    const inOnly = s.match(/^(\d+(?:\.\d+)?)\s*"$/);
    if (inOnly) out = parseFloat(inOnly[1]) / 12;
    else {
      const num = s.match(/^(\d+(?:\.\d+)?)\s*(?:ft|feet)?$/i);
      if (num) out = parseFloat(num[1]);
    }
  }
  return out != null && Number.isFinite(out) && out > 0 ? Math.min(out, MAX_FT) : null;
}

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** 38.5 → 38'-6"; 40 → 40' */
function fmtFt(ft: number): string {
  const totalIn = Math.round(ft * 12);
  const f = Math.floor(totalIn / 12);
  const i = totalIn % 12;
  return i === 0 ? `${f}'` : `${f}'-${i}"`;
}

type M = Record<string, string | boolean>;
type Out = { svg: string; w: number; h: number };

const MIN_W = 900;
const MIN_H = 600;
const MARGIN = 60;

function svgWrap(w: number, h: number, body: string): Out {
  return {
    w, h,
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}"><rect width="${w}" height="${h}" fill="#ffffff"/>${body}</svg>`,
  };
}

const r1 = (n: number) => Math.round(n * 10) / 10;
const line = (x1: number, y1: number, x2: number, y2: number, dash = false, w = 1) =>
  `<line x1="${r1(x1)}" y1="${r1(y1)}" x2="${r1(x2)}" y2="${r1(y2)}" stroke="${LINE}" stroke-width="${w}"${dash ? ' stroke-dasharray="8 5"' : ""}/>`;
const rect = (x: number, y: number, w: number, h: number, dash = false) =>
  `<rect x="${r1(x)}" y="${r1(y)}" width="${r1(w)}" height="${r1(h)}" fill="none" stroke="${LINE}" stroke-width="1"${dash ? ' stroke-dasharray="8 5"' : ""}/>`;
const text = (x: number, y: number, s: string, anchor: "start" | "middle" | "end" = "middle") =>
  `<text x="${r1(x)}" y="${r1(y)}" font-family="sans-serif" font-size="11" fill="${TEXT}" text-anchor="${anchor}">${esc(s)}</text>`;
const title = (s: string) => text(16, 20, s, "start");

type Dim = { ft: number; measured: boolean };
function dim(m: M, key: string, fallback: number): Dim {
  const v = feetOf(m[key]);
  return v != null ? { ft: v, measured: true } : { ft: fallback, measured: false };
}
/** Label with the measured value appended; a generic default shows the name only. */
function lbl(name: string, d: Dim): string {
  return d.measured ? `${name} ${fmtFt(d.ft)}` : name;
}

/** Horizontal dimension line with end ticks, label centred above. */
function hdim(x1: number, x2: number, y: number, label: string): string {
  return line(x1, y, x2, y) + line(x1, y - 4, x1, y + 4) + line(x2, y - 4, x2, y + 4) + text((x1 + x2) / 2, y - 6, label);
}
/** Vertical dimension line, label rotated beside it. */
function vdim(x: number, y1: number, y2: number, label: string): string {
  const cy = (y1 + y2) / 2;
  return line(x, y1, x, y2) + line(x - 4, y1, x + 4, y1) + line(x - 4, y2, x + 4, y2) +
    `<text x="${r1(x - 6)}" y="${r1(cy)}" font-family="sans-serif" font-size="11" fill="${TEXT}" text-anchor="middle" transform="rotate(-90 ${r1(x - 6)} ${r1(cy)})">${esc(label)}</text>`;
}

function canvas(innerW: number, innerH: number): { w: number; h: number; ox: number; oy: number } {
  const w = Math.max(MIN_W, Math.ceil(innerW + MARGIN * 2));
  const h = Math.max(MIN_H, Math.ceil(innerH + MARGIN * 2));
  return { w, h, ox: Math.round((w - innerW) / 2), oy: Math.round((h - innerH) / 2) };
}

/* Stage-only plan: audience at the bottom, plaster line across, stage above it. SR on the drawing's left, SL on its right. */
function stagePlan(m: M, heading: string): Out {
  const pro = dim(m, "proW", 40), depth = dim(m, "stageDepth", 30), sl = dim(m, "wingSL", 15), sr = dim(m, "wingSR", 15), apron = dim(m, "apron", 6);
  const wPx = (sr.ft + pro.ft + sl.ft) * U, dPx = depth.ft * U, aPx = apron.ft * U;
  const c = canvas(wPx, dPx + aPx + 30);
  const x0 = c.ox, y0 = c.oy + 10, plaster = y0 + dPx, xProL = x0 + sr.ft * U, xProR = xProL + pro.ft * U;
  const body =
    title(heading) +
    rect(x0, y0, wPx, dPx) +
    line(x0 - 20, plaster, x0 + wPx + 20, plaster, false, 1.5) +
    text(x0 - 24, plaster - 5, "PLASTER LINE", "end") +
    // proscenium opening: jambs on the plaster line
    line(xProL, plaster - 6, xProL, plaster + 6, false, 3) + line(xProR, plaster - 6, xProR, plaster + 6, false, 3) +
    // apron
    `<path d="M ${r1(xProL)} ${r1(plaster)} L ${r1(xProL)} ${r1(plaster + aPx)} Q ${r1((xProL + xProR) / 2)} ${r1(plaster + aPx + 14)} ${r1(xProR)} ${r1(plaster + aPx)} L ${r1(xProR)} ${r1(plaster)}" fill="none" stroke="${LINE}" stroke-width="1"/>` +
    line((xProL + xProR) / 2, y0 - 10, (xProL + xProR) / 2, plaster + aPx + 18, true) +
    text((xProL + xProR) / 2 + 6, y0 - 12, "CL", "start") +
    text(x0 + (sr.ft * U) / 2, y0 + 16, "SR") + text(x0 + wPx - (sl.ft * U) / 2, y0 + 16, "SL") +
    text((xProL + xProR) / 2, y0 + dPx / 2, "STAGE") +
    hdim(xProL, xProR, plaster + aPx + 34, lbl("PROSCENIUM", pro)) +
    hdim(x0, xProL, y0 - 20, lbl("SR WING", sr)) +
    hdim(xProR, x0 + wPx, y0 - 20, lbl("SL WING", sl)) +
    vdim(x0 + wPx + 24, y0, plaster, lbl("STAGE DEPTH", depth)) +
    (apron.measured ? vdim(xProR + 16, plaster, plaster + aPx, lbl("APRON", apron)) : "");
  return svgWrap(c.w, c.h + 40, body);
}

/* Stage section: house at left of the plaster line, stage to the right. */
function stageSection(m: M, heading: string): Out {
  const depth = dim(m, "stageDepth", 30), apron = dim(m, "apron", 6), proH = dim(m, "proH", 20), grid = dim(m, "gridH", 50);
  const stageH = dim(m, "stageH", 3);
  const wPx = (apron.ft + depth.ft) * U, hPx = Math.max(grid.ft, proH.ft) * U;
  const c = canvas(wPx, hPx + 30);
  const x0 = c.ox, floor = c.oy + hPx + 10, plaster = x0 + apron.ft * U, back = plaster + depth.ft * U;
  const deck = floor - (stageH.measured ? stageH.ft * U : 0);
  const body =
    title(heading) +
    line(x0 - 20, floor, back + 20, floor) +
    (stageH.measured ? line(x0, floor, x0, deck) + line(x0, deck, plaster, deck) : "") +
    line(plaster, deck, back, deck, false, 2) + text((plaster + back) / 2, deck + 14, "DECK") +
    line(plaster, floor, plaster, floor - hPx, true) + text(plaster, floor - hPx - 8, "PLASTER LINE") +
    line(plaster - 14, deck - proH.ft * U, plaster + 14, deck - proH.ft * U, false, 3) + text(plaster + 20, deck - proH.ft * U + 4, "PROSCENIUM HEAD", "start") +
    line(plaster, deck - grid.ft * U, back, deck - grid.ft * U, false, 1.5) + text(back - 4, deck - grid.ft * U - 6, "GRID", "end") +
    line(back, floor, back, deck - grid.ft * U) +
    vdim(plaster - 28, deck - proH.ft * U, deck, lbl("PRO HEIGHT", proH)) +
    vdim(back + 28, deck - grid.ft * U, deck, lbl("GRID HEIGHT", grid)) +
    hdim(plaster, back, floor + 28, lbl("STAGE DEPTH", depth));
  return svgWrap(c.w, c.h + 40, body);
}

/* House plan: stage edge at the top, house outline below. */
function housePlan(m: M, heading: string): Out {
  const hw = dim(m, "houseWidth", 60), hd = dim(m, "houseDepth", 70), pro = dim(m, "proW", 40);
  const stripFt = 12;
  const wPx = hw.ft * U, dPx = hd.ft * U, sPx = stripFt * U;
  const c = canvas(wPx, dPx + sPx + 30);
  const x0 = c.ox, y0 = c.oy + 10, plaster = y0 + sPx, cx = x0 + wPx / 2, pw = Math.min(pro.ft * U, wPx);
  const body =
    title(heading) +
    rect(x0, y0, wPx, sPx, true) + text(x0 + 8, y0 + 16, "STAGE", "start") +
    line(x0 - 20, plaster, x0 + wPx + 20, plaster, false, 1.5) + text(x0 - 24, plaster - 5, "PLASTER LINE", "end") +
    line(cx - pw / 2, plaster - 6, cx - pw / 2, plaster + 6, false, 3) + line(cx + pw / 2, plaster - 6, cx + pw / 2, plaster + 6, false, 3) +
    rect(x0, plaster, wPx, dPx) + text(cx, plaster + dPx / 2, "HOUSE") +
    line(cx, y0 - 10, cx, plaster + dPx + 14, true) + text(cx + 6, y0 - 12, "CL", "start") +
    hdim(x0, x0 + wPx, plaster + dPx + 34, lbl("HOUSE WIDTH", hw)) +
    vdim(x0 + wPx + 28, plaster, plaster + dPx, lbl("HOUSE DEPTH", hd));
  return svgWrap(c.w, c.h + 40, body);
}

/* House section: stage end (plaster line) at the left, floor, ceiling and a catwalk / FOH line. */
function houseSection(m: M, heading: string): Out {
  const hd = dim(m, "houseDepth", 70), hh = dim(m, "houseH", 30), cat = dim(m, "catwalkH", 0);
  const catH = cat.measured ? cat.ft : hh.ft * 0.8;
  const wPx = hd.ft * U, hPx = hh.ft * U;
  const c = canvas(wPx, hPx + 30);
  const x0 = c.ox, floor = c.oy + hPx + 10, ceil = floor - hPx;
  const body =
    title(heading) +
    line(x0, floor, x0 + wPx, floor, false, 1.5) + text(x0 + wPx - 4, floor + 14, "FLOOR", "end") +
    line(x0, ceil, x0 + wPx, ceil, false, 1.5) + text(x0 + wPx - 4, ceil - 6, "CEILING", "end") +
    line(x0, ceil - 10, x0, floor + 10, true) + text(x0, ceil - 16, "PLASTER LINE") +
    line(x0 + wPx, ceil, x0 + wPx, floor) +
    line(x0, floor - catH * U, x0 + wPx, floor - catH * U, true) + text(x0 + 8, floor - catH * U - 6, lbl("CATWALK / FOH", cat), "start") +
    hdim(x0, x0 + wPx, floor + 34, lbl("HOUSE DEPTH", hd)) +
    vdim(x0 - 28, ceil, floor, lbl("CEILING HEIGHT", hh));
  return svgWrap(c.w, c.h + 40, body);
}

function gridSheet(heading: string, cols: number, rows: number, cell: number): Out {
  const gw = cols * cell, gh = rows * cell;
  const w = Math.max(MIN_W, gw + MARGIN * 2), h = Math.max(MIN_H, gh + MARGIN * 2);
  const x0 = Math.round((w - gw) / 2), y0 = Math.round((h - gh) / 2) + 10;
  let g = "";
  for (let i = 0; i <= cols; i++) g += line(x0 + i * cell, y0, x0 + i * cell, y0 + gh, false, 0.5);
  for (let j = 0; j <= rows; j++) g += line(x0, y0 + j * cell, x0 + gw, y0 + j * cell, false, 0.5);
  return svgWrap(w, h, text(w / 2, y0 - 16, heading) + g);
}

const COL_W = [50, 90, 150, 50, 70, 70, 120, 100, 90, 80, 80, 80, 220];

function linesetSheet(page: number, rowsOnPage: number): Out {
  const rows = Math.max(1, Math.min(LINESET_ROWS_PER_PAGE, Math.floor(rowsOnPage)));
  const rowH = 40, headH = 44, titleH = 40;
  const tw = COL_W.reduce((a, b) => a + b, 0);
  const w = tw + 40, h = titleH + headH + rows * rowH + 30;
  let body = text(20, 26, `LINE SET SCHEDULE — PAGE ${page}`, "start");
  const y0 = titleH, x0 = 20;
  body += rect(x0, y0, tw, headH + rows * rowH);
  let x = x0;
  COL_W.forEach((cw, i) => {
    if (i > 0) body += line(x, y0, x, y0 + headH + rows * rowH);
    body += text(x + cw / 2, y0 + headH / 2 + 4, LINESET_SHEET_COLUMNS[i]);
    x += cw;
  });
  body += line(x0, y0 + headH, x0 + tw, y0 + headH, false, 1.5);
  for (let r = 0; r < rows; r++) {
    const y = y0 + headH + r * rowH;
    if (r > 0) body += line(x0, y, x0 + tw, y, false, 0.5);
    body += text(x0 + COL_W[0] / 2, y + rowH / 2 + 4, String((page - 1) * LINESET_ROWS_PER_PAGE + r + 1));
  }
  return svgWrap(w, h, body);
}

export function backgroundFor(key: SketchKey, m: M, opts?: { linesetRows?: number; page?: number }): Out {
  const ls = /^linesetSheet(\d*)$/.exec(key);
  if (ls) {
    const fromKey = ls[1] ? parseInt(ls[1], 10) : 1;
    const page = Math.max(1, Math.floor(opts?.page ?? fromKey) || 1);
    return linesetSheet(page, opts?.linesetRows ?? LINESET_ROWS_PER_PAGE);
  }
  switch (key) {
    case "beams": return stagePlan(m, "BEAMS & RIGGING — STAGE PLAN");
    case "stagePlan": return stagePlan(m, "STAGE PLAN");
    case "stageSection": return stageSection(m, "STAGE SECTION");
    case "housePlan": return housePlan(m, "HOUSE PLAN");
    case "houseSection": return houseSection(m, "HOUSE SECTION");
    case "cwElevation": return gridSheet("CW ELEVATION SHEET (placeholder — Jeff's sheet replaces this)", 24, 12, 40);
    case "brick": return gridSheet("BRICK DRAWING", 40, 28, 20);
    default: return gridSheet("SKETCH", 40, 28, 20);
  }
}
