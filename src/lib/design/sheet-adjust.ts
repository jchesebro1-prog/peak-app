/**
 * #318 — Grid sheet crop + rotate: the pure rules (types, sanitize, the
 * crop ↔ PDF-box and crop ↔ pixel math, the content gate, and the reference
 * remap a derived sheet needs). Client-safe: the Adjust sheet dialog, the
 * store and the byte transforms all read this one module.
 *
 * The model (spec 2026-10-09): an adjusted sheet is a NEW grid_sheets doc
 * derived from its ROOT (the original upload) — `adjust.fromSheetId` is
 * always the root, never a chain. Per page, `rotate` is the quarter turns
 * ADDED to the root page's own rotation and `crop` is normalized 0..1 in the
 * root page as displayed after that rotation (top-left origin, y down).
 * Identity ({rotate:0, crop:{0,0,1,1}}) is never stored.
 */

export type QuarterTurn = 0 | 90 | 180 | 270;
export type CropRect = { x: number; y: number; w: number; h: number };
export type PageAdjust = { rotate: QuarterTurn; crop: CropRect };
/** Keys are 1-based page numbers as strings ("1", "2", …). */
export type AdjustPages = Record<string, PageAdjust>;
export type SheetAdjust = { fromSheetId: string; pages: AdjustPages };

export const IDENTITY_CROP: CropRect = { x: 0, y: 0, w: 1, h: 1 };
export const IDENTITY_ADJUST: PageAdjust = { rotate: 0, crop: IDENTITY_CROP };
/** Smallest crop side, as a fraction of the page side (2 %). */
export const MIN_CROP = 0.02;
/** Most pages one adjust may carry (a 500-page plan set is not a plan sheet). */
export const MAX_ADJUST_PAGES = 500;
const PAGE_KEY_RE = /^[1-9]\d{0,3}$/;

const round4 = (v: number): number => Math.round(v * 10000) / 10000;
const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

/** Any angle → the nearest quarter turn in 0..270 (user input: snapped). */
export function snapTurn(raw: unknown): QuarterTurn {
  const n = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(n)) return 0;
  return ((((Math.round(n / 90) * 90) % 360) + 360) % 360) as QuarterTurn;
}

/** A PDF page's own /Rotate the way pdf.js reads it: not a multiple of 90 → 0; else 0..270. */
export function pdfPageTurn(raw: unknown): QuarterTurn {
  const n = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(n) || n % 90 !== 0) return 0;
  return (((n % 360) + 360) % 360) as QuarterTurn;
}

/** A crop clamped to the unit square, each side ≥ MIN_CROP, rounded to 4 places. */
export function sanitizeCrop(raw: unknown): CropRect {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const num = (v: unknown, d: number): number => (typeof v === "number" && Number.isFinite(v) ? v : d);
  const w = round4(clamp(num(r.w, 1), MIN_CROP, 1));
  const h = round4(clamp(num(r.h, 1), MIN_CROP, 1));
  const x = Math.min(round4(clamp(num(r.x, 0), 0, 1)), round4(1 - w));
  const y = Math.min(round4(clamp(num(r.y, 0), 0, 1)), round4(1 - h));
  return { x, y, w, h };
}

export function sanitizePageAdjust(raw: unknown): PageAdjust {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  return { rotate: snapTurn(r.rotate), crop: sanitizeCrop(r.crop) };
}

export function isIdentity(a: PageAdjust | null | undefined): boolean {
  if (!a) return true;
  const c = a.crop;
  return a.rotate === 0 && c.x === 0 && c.y === 0 && c.w === 1 && c.h === 1;
}

/** Page → adjust, sanitized; identity pages and junk keys dropped; at most MAX_ADJUST_PAGES. */
export function sanitizeAdjustPages(raw: unknown): AdjustPages {
  const out: AdjustPages = {};
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
  const keys = Object.keys(raw as Record<string, unknown>)
    .filter((k) => PAGE_KEY_RE.test(k))
    .sort((a, b) => Number(a) - Number(b))
    .slice(0, MAX_ADJUST_PAGES);
  for (const k of keys) {
    const a = sanitizePageAdjust((raw as Record<string, unknown>)[k]);
    if (!isIdentity(a)) out[k] = a;
  }
  return out;
}

export function pageAdjustOf(pages: AdjustPages | null | undefined, page: number): PageAdjust {
  return pages?.[String(page)] ?? IDENTITY_ADJUST;
}

export function samePageAdjust(a: PageAdjust, b: PageAdjust): boolean {
  return a.rotate === b.rotate && a.crop.x === b.crop.x && a.crop.y === b.crop.y && a.crop.w === b.crop.w && a.crop.h === b.crop.h;
}

/** Pages whose adjust differs between two (sanitized) maps — ascending. */
export function changedPages(before: AdjustPages | null | undefined, after: AdjustPages | null | undefined): number[] {
  const keys = new Set([...Object.keys(before || {}), ...Object.keys(after || {})]);
  return [...keys]
    .map(Number)
    .filter((n) => !samePageAdjust(pageAdjustOf(before, n), pageAdjustOf(after, n)))
    .sort((a, b) => a - b);
}

/** Width × height after a quarter turn. */
export function rotatedSize(w: number, h: number, turn: QuarterTurn): [number, number] {
  return turn === 90 || turn === 270 ? [h, w] : [w, h];
}

/** The crop as seen after turning the page one quarter clockwise ("cw") or counter-clockwise. */
export function rotateCrop(c: CropRect, dir: "cw" | "ccw"): CropRect {
  return dir === "cw"
    ? { x: round4(1 - (c.y + c.h)), y: round4(c.x), w: c.h, h: c.w }
    : { x: round4(c.y), y: round4(1 - (c.x + c.w)), w: c.h, h: c.w };
}

/** ⟳ / ⟲ — the page and its crop box turn together. */
export function turnAdjust(a: PageAdjust, dir: "cw" | "ccw"): PageAdjust {
  return { rotate: snapTurn(a.rotate + (dir === "cw" ? 90 : -90)), crop: rotateCrop(a.crop, dir) };
}

export type CropHandle = "move" | "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";

/** One crop-box drag: `dx`/`dy` are the pointer's travel as fractions of the displayed page. */
export function dragCrop(c: CropRect, handle: CropHandle, dx: number, dy: number): CropRect {
  if (handle === "move") {
    return { x: round4(clamp(c.x + dx, 0, 1 - c.w)), y: round4(clamp(c.y + dy, 0, 1 - c.h)), w: c.w, h: c.h };
  }
  let { x, y } = c;
  let r = c.x + c.w;
  let b = c.y + c.h;
  if (handle.includes("w")) x = clamp(c.x + dx, 0, r - MIN_CROP);
  if (handle.includes("e")) r = clamp(r + dx, x + MIN_CROP, 1);
  if (handle.includes("n")) y = clamp(c.y + dy, 0, b - MIN_CROP);
  if (handle.includes("s")) b = clamp(b + dy, y + MIN_CROP, 1);
  return sanitizeCrop({ x, y, w: r - x, h: b - y });
}

/* ------------------------------ PDF geometry ------------------------------ */

/** [llx, lly, urx, ury] in PDF user space, ll < ur. */
export type PdfBox = [number, number, number, number];

export function normalizeBox(b: readonly number[]): PdfBox {
  return [Math.min(b[0], b[2]), Math.min(b[1], b[3]), Math.max(b[0], b[2]), Math.max(b[1], b[3])];
}

/** What pdf.js draws (its `page.view`): CropBox ∩ MediaBox, or the MediaBox when that is empty. */
export function effectiveBox(media: readonly number[], crop?: readonly number[] | null): PdfBox {
  const m = normalizeBox(media);
  if (!crop) return m;
  const c = normalizeBox(crop);
  const box: PdfBox = [Math.max(m[0], c[0]), Math.max(m[1], c[1]), Math.min(m[2], c[2]), Math.min(m[3], c[3])];
  return box[2] - box[0] > 0 && box[3] - box[1] > 0 ? box : m;
}

/**
 * A point of the page as DISPLAYED at total clockwise rotation `turn`
 * (u, v in 0..1 of the displayed width/height, top-left origin, y down) → PDF
 * user space. pdf.js: at 0 the display's top-left is the box's top-left
 * (x0, y1); each clockwise quarter moves the box corner shown there
 * counter-clockwise: 90 → (x0, y0), 180 → (x1, y0), 270 → (x1, y1).
 */
export function displayToPdf(box: PdfBox, turn: QuarterTurn, u: number, v: number): [number, number] {
  const [x0, y0, x1, y1] = box;
  const W = x1 - x0;
  const H = y1 - y0;
  switch (turn) {
    case 90:
      return [x0 + v * W, y0 + u * H];
    case 180:
      return [x1 - u * W, y0 + v * H];
    case 270:
      return [x1 - v * W, y1 - u * H];
    default:
      return [x0 + u * W, y1 - v * H];
  }
}

/** The CropBox and /Rotate that show `view` (the root page's effective box, own rotation `rootTurn`) cropped and turned by `a`. */
export function cropToPdfBox(view: PdfBox, rootTurn: number, a: PageAdjust): { box: PdfBox; rotate: QuarterTurn } {
  const turn = snapTurn(pdfPageTurn(rootTurn) + a.rotate);
  const [ax, ay] = displayToPdf(view, turn, a.crop.x, a.crop.y);
  const [bx, by] = displayToPdf(view, turn, a.crop.x + a.crop.w, a.crop.y + a.crop.h);
  return { box: normalizeBox([ax, ay, bx, by]), rotate: turn };
}

/** The pixel region to extract from an image of (EXIF-oriented) size w × h after turning it by `a.rotate`. */
export function cropToPixels(w: number, h: number, a: PageAdjust): { width: number; height: number; left: number; top: number } {
  const [W, H] = rotatedSize(w, h, a.rotate);
  const left = clamp(Math.round(a.crop.x * W), 0, W - 1);
  const top = clamp(Math.round(a.crop.y * H), 0, H - 1);
  const right = clamp(Math.round((a.crop.x + a.crop.w) * W), left + 1, W);
  const bottom = clamp(Math.round((a.crop.y + a.crop.h) * H), top + 1, H);
  return { left, top, width: right - left, height: bottom - top };
}

/* ------------------------- the gate and the remap ------------------------- */

/** The parts of a Grid project that name a sheet (structural, so this module stays store-free). */
export type SheetRefsDoc = {
  sheetIds?: string[];
  placements?: Array<{ sheetId: string; page: number }>;
  spaces?: Array<{ sheetId: string; page: number }>;
  routes?: Array<{ sheetId: string; page: number }>;
  calibrations?: Array<{ docId: string; page: number }>;
  intake?: { planSheetId?: string; baseSheetId?: string } | null;
  drawingSet?: { excluded?: string[] } | null;
};

export type PageContent = { devices: number; spaces: number; wires: number; scale: boolean };

/** What sits on each page of one sheet, across every option. Pages with nothing are absent. */
export function pageContents(p: SheetRefsDoc, sheetId: string): Map<number, PageContent> {
  const out = new Map<number, PageContent>();
  const at = (page: number): PageContent => {
    let c = out.get(page);
    if (!c) out.set(page, (c = { devices: 0, spaces: 0, wires: 0, scale: false }));
    return c;
  };
  for (const pl of p.placements || []) if (pl.sheetId === sheetId) at(pl.page).devices++;
  for (const sp of p.spaces || []) if (sp.sheetId === sheetId) at(sp.page).spaces++;
  for (const r of p.routes || []) if (r.sheetId === sheetId) at(r.page).wires++;
  for (const c of p.calibrations || []) if (c.docId === sheetId) at(c.page).scale = true;
  return out;
}

/** Of `pages`, the ones that have anything on them (the adjust gate) — ascending. */
export function blockedPages(p: SheetRefsDoc, sheetId: string, pages: readonly number[]): number[] {
  const on = pageContents(p, sheetId);
  return [...new Set(pages)].filter((n) => on.has(n)).sort((a, b) => a - b);
}

const plural = (n: number, one: string): string => `${n} ${one}${n === 1 ? "" : "s"}`;

/** "This page has 3 devices, 1 space and a scale on it — …" (the dialog's locked-page note). */
export function lockReason(c: PageContent): string {
  const parts = [
    c.devices ? plural(c.devices, "device") : "",
    c.spaces ? plural(c.spaces, "space") : "",
    c.wires ? plural(c.wires, "wire") : "",
    c.scale ? "a scale" : "",
  ].filter(Boolean);
  const list = parts.length > 1 ? `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}` : parts[0] || "something";
  return `This page has ${list} on it — crop and rotate only work on an empty page.`;
}

/** Page number → lock reason, for every page of `sheetId` that has content. */
export function pageLocks(p: SheetRefsDoc, sheetId: string): Record<number, string> {
  const out: Record<number, string> = {};
  for (const [page, c] of pageContents(p, sheetId)) out[page] = lockReason(c);
  return out;
}

/** Is every one of `pageCount` pages locked? (Crop & rotate… is disabled then.) */
export function allPagesLocked(locks: Record<number, string>, pageCount: number): boolean {
  if (!(pageCount >= 1)) return false;
  for (let n = 1; n <= pageCount; n++) if (!locks[n]) return false;
  return true;
}

/**
 * Point every stored reference to `oldId` at `newId`, in place, on a doc
 * patchDoc just read: the sheet order (same position), placements, spaces,
 * routes, calibrations (`docId`), the intake's plan view and drawing-set
 * exclusion keys `plan:<system>:<sheetId>:<page>`. The adjust gate has
 * already guaranteed nothing sits on a page whose frame changed, so every
 * reference moves. Revisions are history and are never touched; the base
 * sheet id is never remapped (the base sheet is never adjusted).
 */
export function remapSheetRefs(p: SheetRefsDoc, oldId: string, newId: string): void {
  p.sheetIds = (p.sheetIds || []).map((id) => (id === oldId ? newId : id));
  const move = <T extends { sheetId: string }>(list: T[] | undefined): T[] | undefined =>
    list?.map((x) => (x.sheetId === oldId ? { ...x, sheetId: newId } : x));
  if (p.placements) p.placements = move(p.placements);
  if (p.spaces) p.spaces = move(p.spaces);
  if (p.routes) p.routes = move(p.routes);
  if (p.calibrations) p.calibrations = p.calibrations.map((c) => (c.docId === oldId ? { ...c, docId: newId } : c));
  if (p.intake?.planSheetId === oldId) p.intake.planSheetId = newId;
  if (p.drawingSet?.excluded) {
    p.drawingSet.excluded = p.drawingSet.excluded.map((k) => {
      const parts = k.split(":");
      return parts[0] === "plan" && parts.length === 4 && parts[2] === oldId ? [parts[0], parts[1], newId, parts[3]].join(":") : k;
    });
  }
}

/** Is this the generated base sheet (never cropped or rotated)? */
export function isBaseSheet(sheet: { id: string; mime: string }, intake?: { baseSheetId?: string } | null): boolean {
  return sheet.id === intake?.baseSheetId || /svg/i.test(sheet.mime || "");
}

/* --------------------------------- copy --------------------------------- */

export type AdjustRefusal = "not-found" | "no-such-sheet" | "base-sheet" | "in-use" | "unsupported" | "encrypted" | "unreadable" | "too-big" | "failed";

export function adjustRefusalText(reason: AdjustRefusal, pages: readonly number[] = []): string {
  switch (reason) {
    case "not-found":
      return "That design could not be found.";
    case "no-such-sheet":
      return "That sheet could not be found.";
    case "base-sheet":
      return "The generated base plan can't be cropped or rotated.";
    case "in-use":
      return pages.length > 1
        ? `Pages ${pages.join(", ")} have devices, spaces, wires or a scale on them — crop and rotate only work on an empty page.`
        : `Page ${pages[0] ?? ""} has devices, spaces, wires or a scale on it — crop and rotate only work on an empty page.`;
    case "unsupported":
      return "This sheet's file type can't be cropped — upload it as a PDF, PNG, JPEG, WebP or GIF.";
    case "encrypted":
      return "This PDF is password-protected — print it to a new PDF and upload that.";
    case "unreadable":
      return "Couldn't read this sheet's file — upload it again and try once more.";
    case "too-big":
      return "The adjusted sheet is too large to store without file storage — crop it tighter or use a smaller file.";
    default:
      return "Couldn't save the adjusted sheet — try again.";
  }
}
