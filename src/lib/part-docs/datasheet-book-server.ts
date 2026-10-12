/**
 * #329 — the datasheet book PDF (pdf-lib, no Chrome): a Letter cover with
 * the Peak letterhead (Grid notes #9 — image, or the company name in type;
 * none when the header is off), title, job lines and summary, the index table (Manufacturer |
 * Model / Part # | Description | Page, then "Not included" with reasons),
 * every datasheet once in manufacturer A→Z order, and "Page N of M" in the
 * bottom margin of every page — the cover's and each manufacturer page's own
 * size and rotation. Shared by the Grid and quote client packages, the
 * estimate package zip and the rack submittal (which moved its merge here).
 *
 * Never throws: a datasheet that can't be loaded (corrupt, encrypted, empty)
 * becomes a "Could not be read" index row; a book that runs past its
 * deadline, outgrows BOOK_MAX_BYTES or fails outright comes back
 * `{ ok: false }` and the caller ships the loose files with a note.
 * SERVER ONLY (pdf-lib).
 */
import { PDFDocument, StandardFonts, degrees, rgb, type PDFFont, type PDFImage, type PDFPage } from "pdf-lib";
import { letterheadBoxPx, type Letterhead } from "@/lib/letterhead";
import {
  BOOK_MAX_BYTES, BOOK_REASON, BOOK_TITLE, bookIndex, bookSummary, planDatasheetBook,
  type BookIndex, type BookIndexRow, type BookPart, type BookPlan,
} from "./datasheet-book";

export type BookDoc = { bytes: Uint8Array | null; reason?: string };

export type BuildBookInput = {
  title?: string;
  /** Project / customer / venue / estimate / date — one line each, blanks dropped. */
  subtitleLines: string[];
  parts: readonly BookPart[];
  /** Document id → its bytes (null + reason when it wasn't read). */
  docs: ReadonlyMap<string, BookDoc>;
  /** Grid notes #9 — the Peak letterhead atop the cover (null/absent = none). */
  letterhead?: Letterhead | null;
  /** Epoch ms: a book still merging past it is skipped (`late`). */
  deadline?: number;
  now?: () => number;
  maxBytes?: number;
  /** Log prefix, e.g. "[package] quote Q-1". */
  logTag?: string;
  /** Build even when no datasheet merged (the rack's cover-only index, #296). Default false: no merged page → `failed`. */
  emptyOk?: boolean;
};

export type BuiltBook =
  | { ok: true; bytes: Buffer; pageCount: number; frontPages: number; index: BookIndex; plan: BookPlan; unmergeable: string[] }
  | { ok: false; cause: "too-big" | "late" | "failed"; detail: string };

/** What a skipped book's note says, by cause (customer-safe). */
export const BOOK_SKIPPED_REASON: Record<"too-big" | "late" | "failed", string> = {
  "too-big": BOOK_REASON.tooBig,
  late: BOOK_REASON.late,
  failed: "Left out — the combined datasheet book couldn't be built",
};

/* ---------- text helpers (moved from the rack submittal) ---------- */

/** Text Helvetica (WinAnsi) can't encode becomes "?", so drawing never throws. */
const charSets = new WeakMap<PDFFont, Set<number>>();
export function encodable(font: PDFFont, text: string): string {
  let set = charSets.get(font);
  if (!set) charSets.set(font, (set = new Set(font.getCharacterSet())));
  let out = "";
  for (const ch of String(text ?? "")) out += set.has(ch.codePointAt(0)!) ? ch : "?";
  return out;
}

export function wrap(font: PDFFont, text: string, size: number, width: number): string[] {
  if (!text) return [""];
  const out: string[] = [];
  let line = "";
  for (const word of text.split(/\s+/)) {
    if (!word) continue;
    const next = line ? `${line} ${word}` : word;
    if (font.widthOfTextAtSize(next, size) <= width) {
      line = next;
      continue;
    }
    if (line) out.push(line);
    // A single word wider than the line breaks by character.
    let w = word;
    while (font.widthOfTextAtSize(w, size) > width && w.length > 1) {
      let cut = w.length - 1;
      while (cut > 1 && font.widthOfTextAtSize(w.slice(0, cut), size) > width) cut--;
      out.push(w.slice(0, cut));
      w = w.slice(cut);
    }
    line = w;
  }
  if (line) out.push(line);
  return out.length ? out : [""];
}

/** Wrapped to at most `max` lines; the last one ends in "…" when text was cut. */
function clamp(font: PDFFont, text: string, size: number, width: number, max: number): string[] {
  const lines = wrap(font, encodable(font, text), size, width);
  if (lines.length <= max) return lines;
  const kept = lines.slice(0, max);
  let last = kept[max - 1];
  while (last && font.widthOfTextAtSize(`${last}…`, size) > width) last = last.slice(0, -1);
  kept[max - 1] = `${last.trimEnd()}…`;
  return kept;
}

/* ---------- page stamp ---------- */

export const STAMP_SIZE = 8;
export const STAMP_INSET = 18;

/** "Page N of M", ~8 pt gray Helvetica, centered 18 pt above the page's VISUAL bottom edge (crop box + /Rotate respected). */
export function stampPage(page: PDFPage, text: string, font: PDFFont): void {
  const box = page.getCropBox();
  const x0 = Math.min(box.x, box.x + box.width), y0 = Math.min(box.y, box.y + box.height);
  const W = Math.abs(box.width), H = Math.abs(box.height);
  const w = font.widthOfTextAtSize(text, STAMP_SIZE);
  const rot = ((Math.round((page.getRotation().angle || 0) / 90) * 90) % 360 + 360) % 360;
  const o = { size: STAMP_SIZE, font, color: rgb(0.42, 0.42, 0.42) };
  // /Rotate turns the page clockwise for display, so the visual bottom is
  // y-min at 0°, x-max at 90°, y-max at 180°, x-min at 270°; the text turns
  // with it so it reads upright left-to-right.
  if (rot === 90) page.drawText(text, { ...o, x: x0 + W - STAMP_INSET, y: y0 + H / 2 - w / 2, rotate: degrees(90) });
  else if (rot === 180) page.drawText(text, { ...o, x: x0 + W / 2 + w / 2, y: y0 + H - STAMP_INSET, rotate: degrees(180) });
  else if (rot === 270) page.drawText(text, { ...o, x: x0 + STAMP_INSET, y: y0 + H / 2 + w / 2, rotate: degrees(270) });
  else page.drawText(text, { ...o, x: x0 + W / 2 - w / 2, y: y0 + STAMP_INSET });
}

/* ---------- cover + index layout ---------- */

const PAGE_W = 612;
const PAGE_H = 792;
const MARGIN = 54;
/** The index never runs into the stamp's band. */
const BOTTOM = MARGIN;
const BODY = 9;
const LEAD = 11.5;
const PAD = 4;
const INK = rgb(0.13, 0.13, 0.13);
const MUTED = rgb(0.42, 0.42, 0.42);
const RULE = rgb(0.82, 0.82, 0.82);

type Col = { label: string; width: number; align?: "right" };
const INCLUDED_COLS: Col[] = [
  { label: "Manufacturer", width: 112 },
  { label: "Model / Part #", width: 118 },
  { label: "Description", width: 228 },
  { label: "Page", width: 46, align: "right" },
];
const MISSING_COLS: Col[] = [
  { label: "Manufacturer", width: 112 },
  { label: "Model / Part #", width: 118 },
  { label: "Description", width: 152 },
  { label: "Reason", width: 122 },
];
const GUTTER = 8;

type Fonts = { regular: PDFFont; bold: PDFFont };

/** One laid-out thing on a front page, top-down. */
type Op =
  | { k: "logo"; y: number; w: number; h: number }
  | { k: "company"; y: number; text: string }
  | { k: "text"; y: number; x: number; text: string; size: number; bold?: boolean; muted?: boolean }
  | { k: "rule"; y: number; light?: boolean }
  | { k: "head"; y: number; cols: Col[] }
  | { k: "row"; y: number; cols: Col[]; cells: string[][]; boldFirst: boolean; groupRule: boolean; height: number };

type FrontInput = {
  title: string;
  subtitleLines: string[];
  logo: { w: number; h: number } | null;
  /** The letterhead in type (no image), or null. */
  company: string | null;
  index: BookIndex;
  parts: number;
};

/**
 * Lays the cover + index out into pages of ops. The layout never depends on
 * the page numbers it prints (fixed-height rows, a fixed Page column), so the
 * front-page count is known before any number is drawn.
 */
function layoutFront(input: FrontInput, f: Fonts): Op[][] {
  const pages: Op[][] = [[]];
  let y = PAGE_H - MARGIN;
  const ops = () => pages[pages.length - 1];
  const newPage = (cols: Col[] | null) => {
    pages.push([]);
    y = PAGE_H - MARGIN;
    y -= 9;
    ops().push({ k: "text", y, x: MARGIN, text: `${input.title} — index (continued)`, size: 9, muted: true });
    y -= 14;
    if (cols) pushHead(cols);
  };
  const pushHead = (cols: Col[]) => {
    y -= 10;
    ops().push({ k: "head", y, cols });
    y -= 5;
    ops().push({ k: "rule", y });
  };
  // --- cover block
  if (input.logo) {
    ops().push({ k: "logo", y: y - input.logo.h, w: input.logo.w, h: input.logo.h });
    y -= input.logo.h + 22;
  } else if (input.company) {
    y -= 16;
    ops().push({ k: "company", y, text: input.company });
    y -= 22;
  }
  y -= 24;
  ops().push({ k: "text", y, x: MARGIN, text: input.title, size: 24, bold: true });
  y -= 10;
  for (const line of input.subtitleLines) {
    for (const l of clamp(f.regular, line, 11.5, PAGE_W - 2 * MARGIN, 2)) {
      y -= 16;
      ops().push({ k: "text", y, x: MARGIN, text: l, size: 11.5 });
    }
  }
  y -= 18;
  ops().push({ k: "text", y, x: MARGIN, text: bookSummary(input.parts, input.index.datasheets, input.index.totalPages), size: 10, muted: true });
  y -= 14;
  ops().push({ k: "rule", y });
  y -= 26;
  ops().push({ k: "text", y, x: MARGIN, text: "Index", size: 13, bold: true });
  y -= 6;

  const section = (rows: BookIndexRow[], cols: Col[], cellsOf: (r: BookIndexRow) => string[], empty: string) => {
    pushHead(cols);
    if (!rows.length) {
      y -= LEAD + 2;
      ops().push({ k: "text", y, x: MARGIN, text: empty, size: BODY, muted: true });
      return;
    }
    let firstOnPage = true;
    for (const r of rows) {
      const raw = cellsOf(r);
      const cells = cols.map((c, i) => clamp(i === 0 && r.groupStart ? f.bold : f.regular, raw[i], BODY, c.width - GUTTER, i === 2 ? 3 : 2));
      const height = Math.max(...cells.map((c) => c.length)) * LEAD + PAD;
      if (y - height < BOTTOM) {
        newPage(cols);
        firstOnPage = true;
      }
      // The manufacturer prints on a group's first row and again at the top of a page.
      const showMfr = r.groupStart || firstOnPage;
      if (!showMfr) cells[0] = [""];
      ops().push({ k: "row", y, cols, cells, boldFirst: r.groupStart, groupRule: r.groupStart && !firstOnPage, height });
      y -= height;
      firstOnPage = false;
    }
  };
  section(input.index.included, INCLUDED_COLS, (r) => [r.mfr, r.model || "—", r.desc, String(r.page ?? "")], "No datasheets are included.");
  if (input.index.notIncluded.length) {
    if (y - 60 < BOTTOM) newPage(null);
    y -= 26;
    ops().push({ k: "text", y, x: MARGIN, text: "Not included", size: 11, bold: true });
    y -= 4;
    section(input.index.notIncluded, MISSING_COLS, (r) => [r.mfr, r.model || "—", r.desc, r.reason ?? ""], "");
  }
  return pages;
}

function drawFront(page: PDFPage, ops: Op[], f: Fonts, logo: PDFImage | null): void {
  for (const op of ops) {
    if (op.k === "logo" && logo) page.drawImage(logo, { x: MARGIN, y: op.y, width: op.w, height: op.h });
    else if (op.k === "company") page.drawText(encodable(f.bold, op.text), { x: MARGIN, y: op.y, size: 16, font: f.bold, color: INK });
    else if (op.k === "text") {
      const font = op.bold ? f.bold : f.regular;
      page.drawText(encodable(font, op.text), { x: op.x, y: op.y, size: op.size, font, color: op.muted ? MUTED : INK });
    } else if (op.k === "rule") {
      page.drawLine({ start: { x: MARGIN, y: op.y }, end: { x: PAGE_W - MARGIN, y: op.y }, thickness: op.light ? 0.4 : 0.6, color: op.light ? RULE : MUTED });
    } else if (op.k === "head") {
      let x = MARGIN;
      for (const c of op.cols) {
        const t = c.label.toUpperCase();
        const w = f.bold.widthOfTextAtSize(t, 7.5);
        page.drawText(t, { x: c.align === "right" ? x + c.width - w : x, y: op.y, size: 7.5, font: f.bold, color: MUTED });
        x += c.width;
      }
    } else if (op.k === "row") {
      if (op.groupRule) page.drawLine({ start: { x: MARGIN, y: op.y - 1 }, end: { x: PAGE_W - MARGIN, y: op.y - 1 }, thickness: 0.4, color: RULE });
      let x = MARGIN;
      op.cols.forEach((c, i) => {
        const font = i === 0 && op.boldFirst ? f.bold : f.regular;
        op.cells[i].forEach((t, li) => {
          const ty = op.y - PAD / 2 - BODY - li * LEAD + 1;
          const w = font.widthOfTextAtSize(t, BODY);
          page.drawText(t, { x: c.align === "right" ? x + c.width - w : x, y: ty, size: BODY, font, color: i === 3 && op.cols === MISSING_COLS ? MUTED : INK });
        });
        x += c.width;
      });
    }
  }
}

const tick = () => new Promise<void>((r) => setImmediate(r));

/**
 * Build the book. Documents are merged in the plan's order (manufacturer
 * A→Z, each once); the index's page numbers count the front pages.
 */
export async function buildDatasheetBook(input: BuildBookInput): Promise<BuiltBook> {
  const tag = input.logTag ?? "[datasheet-book]";
  const now = input.now ?? Date.now;
  const maxBytes = input.maxBytes ?? BOOK_MAX_BYTES;
  try {
    const plan = planDatasheetBook(input.parts);
    let inBytes = 0;
    for (const id of plan.docOrder) inBytes += input.docs.get(id)?.bytes?.byteLength ?? 0;
    if (inBytes > maxBytes) return { ok: false, cause: "too-big", detail: `${inBytes} bytes of datasheets` };

    const out = await PDFDocument.create();
    const pages = new Map<string, number>();
    const reasons = new Map<string, string>();
    const unmergeable: string[] = [];
    for (const id of plan.docOrder) {
      if (input.deadline !== undefined && now() >= input.deadline) return { ok: false, cause: "late", detail: "the merge ran past its deadline" };
      const d = input.docs.get(id);
      if (!d?.bytes) {
        reasons.set(id, d?.reason ?? BOOK_REASON.missing);
        continue;
      }
      try {
        const src = await PDFDocument.load(d.bytes, { ignoreEncryption: true, updateMetadata: false });
        if (src.isEncrypted) throw new Error("encrypted PDF");
        const copied = await out.copyPages(src, src.getPageIndices());
        if (!copied.length) throw new Error("PDF has no pages");
        for (const p of copied) out.addPage(p);
        pages.set(id, copied.length);
      } catch (err) {
        console.warn(`${tag} datasheet ${id} not merged: ${err instanceof Error ? err.message : String(err)}`);
        reasons.set(id, BOOK_REASON.unreadable);
        unmergeable.push(id);
      }
      await tick(); // let a concurrent render's I/O through between documents
    }

    if (!pages.size && !input.emptyOk) return { ok: false, cause: "failed", detail: "no datasheet could be merged" };

    const f: Fonts = { regular: await out.embedFont(StandardFonts.Helvetica), bold: await out.embedFont(StandardFonts.HelveticaBold) };
    // Grid notes #9 — the letterhead: a PNG (lossless) or JPEG image sized like the rack index's, else the name in type.
    const lh = input.letterhead ?? null;
    let logo: PDFImage | null = null;
    let logoBox: { w: number; h: number } | null = null;
    if (lh?.image) {
      try {
        logo = lh.image.png ? await out.embedPng(lh.image.png) : await out.embedJpg(lh.image.jpeg);
        // letterheadBoxPx is in 96-dpi pixels; PDF points are 72 per inch.
        const px = letterheadBoxPx(lh.image, ((PAGE_W - 2 * MARGIN) * 96) / 72);
        logoBox = { w: (px.width * 72) / 96, h: (px.height * 72) / 96 };
      } catch (err) {
        console.warn(`${tag} letterhead not embedded: ${err instanceof Error ? err.message : String(err)}`);
        logo = null;
      }
    }
    const company = lh && !logo ? lh.companyName || null : null;
    const title = input.title || BOOK_TITLE;
    const subtitleLines = input.subtitleLines.map((s) => String(s ?? "").trim()).filter(Boolean);
    // The front-page count feeds the page numbers, which never change the layout: settle once more to be sure.
    let front = 1;
    let index = bookIndex(plan, pages, reasons, front);
    let laid = layoutFront({ title, subtitleLines, logo: logoBox, company, index, parts: plan.parts.length }, f);
    for (let i = 0; i < 4 && laid.length !== front; i++) {
      front = laid.length;
      index = bookIndex(plan, pages, reasons, front);
      laid = layoutFront({ title, subtitleLines, logo: logoBox, company, index, parts: plan.parts.length }, f);
    }
    laid.forEach((ops, i) => drawFront(out.insertPage(i, [PAGE_W, PAGE_H]), ops, f, logo));
    const all = out.getPages();
    all.forEach((p, i) => stampPage(p, `Page ${i + 1} of ${all.length}`, f.regular));
    out.setTitle(subtitleLines[0] ? `${title} — ${subtitleLines[0]}` : title);
    out.setCreator("Peak Systems Group");
    out.setProducer("Quartzite");
    if (input.deadline !== undefined && now() >= input.deadline) return { ok: false, cause: "late", detail: "the merge ran past its deadline" };
    const bytes = Buffer.from(await out.save());
    if (bytes.length > maxBytes) return { ok: false, cause: "too-big", detail: `${bytes.length} bytes` };
    return { ok: true, bytes, pageCount: all.length, frontPages: front, index, plan, unmergeable };
  } catch (err) {
    console.warn(`${tag} datasheet book failed: ${err instanceof Error ? err.message : String(err)}`);
    return { ok: false, cause: "failed", detail: err instanceof Error ? err.message : String(err) };
  }
}
