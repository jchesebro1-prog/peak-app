/**
 * #296 — the rack submittal files (Task 12): the three printed sheets as
 * PDFs through the signed print route and headless Chrome, the schedule CSV,
 * and every placed part's datasheet merged into one datasheets.pdf behind a
 * cover index that lists what is missing. SERVER ONLY (stores, Blob, Chrome).
 *
 * Time: the caller passes a deadline (route: start + RACK_SUBMITTAL_DEADLINE_MS).
 * The sheets render sequentially, each signed right before its own render;
 * none starts with less than RACK_MIN_RENDER_MS left, each gets Chrome step
 * caps of at most the time left, an AbortSignal that fires at the deadline,
 * and our wait is cut at the deadline (rejectAfter) — the cut-sheet pattern
 * (#292). Datasheet reads come after and stop RACK_DATASHEET_ALLOWANCE_MS
 * past the deadline (a read not started by then is a gap; one in flight is
 * aborted), leaving the merge and the zip inside the route's 120 s.
 *
 * This zip is staff-facing, so a gap's detail can be specific.
 */
import { PDFDocument, StandardFonts, type PDFFont } from "pdf-lib";
import { getBlobStream, safeName } from "@/lib/blob";
import { CutSheetDeadlineError, rejectAfter } from "@/lib/curtain-cut-sheets/deadline";
import { renderTimeoutMs, type PrintWhere } from "@/lib/curtain-cut-sheets/package-sheets";
import { loadPartDocsState } from "@/lib/part-docs/load";
import { resolvePackageDocs } from "@/lib/part-docs/package";
import { PdfRenderUnavailable, renderPrintRouteToPdf } from "@/lib/quote-pdf/render";
import { signPrintToken } from "@/lib/quote-pdf/token";
import { getMany } from "@/lib/stores/catalog";
import type { ZipFile } from "@/lib/zip";
import { loadRackForSheets } from "./load";
import type { RackSheetKind } from "./sheet-format";
import { scheduleCsv, type RackSubmittal, type RackSubmittalGap } from "./submittal";

/** From the start of the request: no sheet render runs past it. */
export const RACK_SUBMITTAL_DEADLINE_MS = 90_000;
/** A render needs at least this much time left to be worth starting. */
export const RACK_MIN_RENDER_MS = 5_000;
/** Datasheet reads may run this long past the render deadline. */
export const RACK_DATASHEET_ALLOWANCE_MS = 15_000;
/** One datasheet file over this is left out. */
export const RACK_DATASHEET_MAX_BYTES = 25 * 1024 * 1024;
/** All datasheet files together; past it the rest are left out. */
export const RACK_DATASHEETS_TOTAL_BYTES = 60 * 1024 * 1024;

export const RACK_NOT_FOUND = "Rack not found.";
export const DATASHEET_MISSING = "No datasheet on file.";
export const DATASHEET_UNREADABLE = "Datasheet file could not be read.";
export const DATASHEET_UNMERGEABLE = "Datasheet PDF could not be merged.";
export const DATASHEET_TOO_BIG = "Left out — package size limit";
export const DATASHEET_LATE = "Left out — ran out of time";

const SHEETS: ReadonlyArray<{ kind: RackSheetKind; file: string; name: string }> = [
  { kind: "elevation", file: "elevation.pdf", name: "Elevation" },
  { kind: "schedule", file: "schedule.pdf", name: "Schedule" },
  { kind: "power", file: "power-heat.pdf", name: "Power and heat" },
];

type Render = (url: string, o: { timeoutMs: number; signal?: AbortSignal }) => Promise<Buffer>;

export type RackSubmittalFiles =
  | { ok: true; folder: string; files: ZipFile[]; gaps: RackSubmittalGap[] }
  | { ok: false; error: string };

export async function rackSubmittalFiles(
  id: string,
  where: PrintWhere,
  opts: {
    /** Epoch ms — no sheet render runs past it. */
    deadline: number;
    /** Harness seams; production uses the real renderer and clock. */
    render?: Render;
    now?: () => number;
    /** Default true; the client package (Task 13) passes false. */
    datasheets?: boolean;
  },
): Promise<RackSubmittalFiles> {
  const now = opts.now ?? Date.now;
  const loaded = await loadRackForSheets(id, now());
  if (!loaded) return { ok: false, error: RACK_NOT_FOUND };
  const { rec, submittal } = loaded;
  const files: ZipFile[] = [];
  const gaps: RackSubmittalGap[] = [...submittal.gaps];
  await addSheetPdfs(id, where, files, gaps, { deadline: opts.deadline, render: opts.render ?? renderPrintRouteToPdf, now });
  files.push({ name: "schedule.csv", data: Buffer.from(scheduleCsv(submittal), "utf8") });
  if (opts.datasheets !== false) {
    files.push({ name: "datasheets.pdf", data: await datasheetsPdf(submittal, gaps, opts.deadline + RACK_DATASHEET_ALLOWANCE_MS, now) });
  }
  return { ok: true, folder: safeName(rec.label || rec.id), files, gaps };
}

/* ---------- the three sheets ---------- */

async function addSheetPdfs(
  id: string,
  where: PrintWhere,
  files: ZipFile[],
  gaps: RackSubmittalGap[],
  o: { deadline: number; render: Render; now: () => number },
): Promise<void> {
  const log = (what: string, detail: string) => console.warn(`[rack] submittal ${id} ${what}: ${detail}`);
  const abort = new AbortController();
  // A real timer on the real clock (the `now` seam only steers the per-render decisions).
  const abortTimer = setTimeout(() => abort.abort(new CutSheetDeadlineError()), Math.max(0, o.deadline - Date.now()));
  let unavailable: string | null = "error" in where ? where.error : null;
  try {
    for (const sheet of SHEETS) {
      const gap = (why: string) => {
        log(sheet.kind, why);
        gaps.push({ sku: "", label: sheet.name, kind: "missing-data", detail: `${sheet.name} PDF could not be rendered — open the preview page and use Print.` });
      };
      if (unavailable) {
        gap(unavailable);
        continue;
      }
      if (o.deadline - o.now() < RACK_MIN_RENDER_MS || abort.signal.aborted) {
        gap("not started — too little time left before the deadline");
        continue;
      }
      try {
        // Signed right before its own render, so a token never ages in the loop.
        const t = signPrintToken(process.env.AUTH_SECRET || "", "rack", id, o.now());
        const url = `${(where as { origin: string }).origin}/print/rack/${encodeURIComponent(id)}?sheet=${sheet.kind}&t=${encodeURIComponent(t)}`;
        const data = await rejectAfter(o.render(url, { timeoutMs: renderTimeoutMs(o.deadline, o.now()), signal: abort.signal }), o.deadline - o.now());
        files.push({ name: sheet.file, data });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        // No Chrome on this server: the other sheets would fail the same way.
        if (e instanceof PdfRenderUnavailable) unavailable = msg;
        gap(msg);
      }
    }
  } finally {
    clearTimeout(abortTimer);
    abort.abort(new CutSheetDeadlineError());
  }
}

/* ---------- datasheets ---------- */

export type DatasheetEntry = { sku: string; label: string; bytes: Buffer | null; reason?: string };
export type CoverEntry = { sku: string; label: string; pageCount: number | null; reason?: string };

async function readCapped(stream: ReadableStream<Uint8Array>, cap: number): Promise<Buffer | "too-big"> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let n = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    n += value.byteLength;
    if (n > cap) {
      await reader.cancel().catch(() => {});
      return "too-big";
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}

async function datasheetsPdf(submittal: RackSubmittal, gaps: RackSubmittalGap[], readsBy: number, now: () => number): Promise<Buffer> {
  const missingCatalog = new Map(submittal.gaps.filter((g) => g.kind === "missing-catalog").map((g) => [g.sku, g] as const));
  const skus = submittal.datasheetSkus.filter((s) => !missingCatalog.has(s));
  const parts = skus.length ? await getMany(skus) : [];
  const { index } = await loadPartDocsState(parts);
  const { bySku, documents } = resolvePackageDocs(index, skus);
  const nameOf = new Map<string, string>();
  for (const r of [...submittal.schedule, ...submittal.rackLevel]) if (r.sku && !nameOf.has(r.sku)) nameOf.set(r.sku, r.desc || r.sku);
  for (const p of parts) if (p.desc) nameOf.set(p.sku, p.desc);
  const name = (sku: string) => nameOf.get(sku) || sku;
  const listed: Array<DatasheetEntry & { skus: string[] }> = [];
  const gapFor = (skuList: string[], detail: string) => {
    for (const sku of skuList) gaps.push({ sku, label: name(sku), kind: "missing-datasheet", detail });
  };
  const docById = new Map(documents.filter((d) => d.kind === "datasheet").map((d) => [d.documentId, d] as const));
  const done = new Set<string>();

  // In schedule order: each distinct document once, at the first SKU it serves.
  const abort = new AbortController();
  const abortTimer = setTimeout(() => abort.abort(new CutSheetDeadlineError()), Math.max(0, readsBy - Date.now()));
  let total = 0;
  try {
    for (const sku of submittal.datasheetSkus) {
      const cat = missingCatalog.get(sku);
      if (cat) {
        listed.push({ sku, label: cat.label, bytes: null, reason: cat.detail, skus: [sku] });
        continue;
      }
      const ref = bySku.get(sku);
      const doc = ref?.datasheet ? docById.get(ref.datasheet.documentId) : undefined;
      if (!doc) {
        // Marked not needed: no gap, not listed.
        if (ref?.datasheetOk) continue;
        gapFor([sku], DATASHEET_MISSING);
        listed.push({ sku, label: name(sku), bytes: null, reason: DATASHEET_MISSING, skus: [sku] });
        continue;
      }
      if (done.has(doc.documentId)) continue;
      done.add(doc.documentId);
      const entry = { sku: doc.skus.join(", "), label: doc.skus.map(name).join("; "), skus: doc.skus };
      const leaveOut = (reason: string) => {
        gapFor(doc.skus, reason);
        listed.push({ ...entry, bytes: null, reason });
      };
      const meta = index.docsById.get(doc.documentId);
      if (!meta?.blobKey) {
        leaveOut(DATASHEET_MISSING);
        continue;
      }
      if (meta.size > RACK_DATASHEET_MAX_BYTES || total + meta.size > RACK_DATASHEETS_TOTAL_BYTES) {
        leaveOut(DATASHEET_TOO_BIG);
        continue;
      }
      if (now() >= readsBy || abort.signal.aborted) {
        leaveOut(DATASHEET_LATE);
        continue;
      }
      try {
        const stream = await getBlobStream(meta.blobKey, { signal: abort.signal });
        if (!stream) {
          leaveOut(DATASHEET_UNREADABLE);
          continue;
        }
        const bytes = await readCapped(stream as ReadableStream<Uint8Array>, Math.min(RACK_DATASHEET_MAX_BYTES, RACK_DATASHEETS_TOTAL_BYTES - total));
        if (bytes === "too-big") {
          leaveOut(DATASHEET_TOO_BIG);
          continue;
        }
        total += bytes.length;
        listed.push({ ...entry, bytes });
      } catch (e) {
        console.warn(`[rack] datasheet ${doc.documentId} (${entry.sku}): ${e instanceof Error ? e.message : String(e)}`);
        leaveOut(abort.signal.aborted ? DATASHEET_LATE : DATASHEET_UNREADABLE);
      }
    }
  } finally {
    clearTimeout(abortTimer);
  }

  return mergeDatasheets(listed, `${submittal.title} — datasheets`, (e) => gapFor((e as (typeof listed)[number]).skus ?? [e.sku], DATASHEET_UNMERGEABLE));
}

/**
 * The cover's lines, pure: the title, then "Included" (`SKU — part — page N`,
 * page N counted from the first page of the merged file, cover included),
 * then "Not included" (`SKU — part — reason`). `None.` under an empty heading.
 */
export function datasheetCoverLines(entries: readonly CoverEntry[], title: string, coverPages = 1): string[] {
  const included: string[] = [];
  const missing: string[] = [];
  let page = coverPages + 1;
  for (const e of entries) {
    if (e.pageCount && e.pageCount > 0) {
      included.push(`${e.sku} — ${e.label} — page ${page}`);
      page += e.pageCount;
    } else {
      missing.push(`${e.sku} — ${e.label} — ${e.reason || DATASHEET_MISSING}`);
    }
  }
  return [title, "", "Included", ...(included.length ? included : ["None."]), "", "Not included", ...(missing.length ? missing : ["None."])];
}

const PAGE_W = 612;
const PAGE_H = 792;
const MARGIN = 54;
const TITLE_SIZE = 16;
const HEAD_SIZE = 12;
const BODY_SIZE = 10;
const LEAD = 1.45;

/** Text Helvetica (WinAnsi) can't encode becomes "?", so drawing never throws. */
const charSets = new WeakMap<PDFFont, Set<number>>();
function encodable(font: PDFFont, text: string): string {
  let set = charSets.get(font);
  if (!set) charSets.set(font, (set = new Set(font.getCharacterSet())));
  let out = "";
  for (const ch of text) out += set.has(ch.codePointAt(0)!) ? ch : "?";
  return out;
}

function wrap(font: PDFFont, text: string, size: number, width: number): string[] {
  if (!text) return [""];
  const out: string[] = [];
  let line = "";
  for (const word of text.split(/\s+/)) {
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
  return out;
}

type Laid = { text: string; size: number; font: PDFFont };

/** Lines → pages of positioned rows (title, headings bold, body wrapped). */
function layoutCover(lines: string[], regular: PDFFont, bold: PDFFont): Laid[][] {
  const width = PAGE_W - 2 * MARGIN;
  const pages: Laid[][] = [[]];
  let y = PAGE_H - MARGIN;
  const put = (row: Laid) => {
    const h = row.size * LEAD;
    if (y - h < MARGIN) {
      pages.push([]);
      y = PAGE_H - MARGIN;
    }
    pages[pages.length - 1].push(row);
    y -= h;
  };
  lines.forEach((raw, i) => {
    const isTitle = i === 0;
    const isHead = raw === "Included" || raw === "Not included";
    const font = isTitle || isHead ? bold : regular;
    const size = isTitle ? TITLE_SIZE : isHead ? HEAD_SIZE : BODY_SIZE;
    for (const t of wrap(font, encodable(font, raw), size, width)) put({ text: t, size, font });
  });
  return pages;
}

/**
 * One PDF: cover page(s) indexing every entry, then each datasheet's pages
 * in entry order. A PDF that can't be loaded or copied (corrupt, encrypted,
 * empty) is listed under Not included and reported through `onUnmergeable`.
 */
export async function mergeDatasheets(
  entries: readonly DatasheetEntry[],
  title: string,
  onUnmergeable?: (entry: DatasheetEntry) => void,
): Promise<Buffer> {
  const out = await PDFDocument.create();
  const cover: CoverEntry[] = [];
  for (const e of entries) {
    if (!e.bytes) {
      cover.push({ sku: e.sku, label: e.label, pageCount: null, reason: e.reason });
      continue;
    }
    try {
      const src = await PDFDocument.load(e.bytes, { ignoreEncryption: true });
      if (src.isEncrypted) throw new Error("encrypted PDF");
      const pages = await out.copyPages(src, src.getPageIndices());
      if (!pages.length) throw new Error("PDF has no pages");
      for (const p of pages) out.addPage(p);
      cover.push({ sku: e.sku, label: e.label, pageCount: pages.length });
    } catch (err) {
      console.warn(`[rack] datasheet ${e.sku} not merged: ${err instanceof Error ? err.message : String(err)}`);
      cover.push({ sku: e.sku, label: e.label, pageCount: null, reason: DATASHEET_UNMERGEABLE });
      onUnmergeable?.(e);
    }
  }
  const regular = await out.embedFont(StandardFonts.Helvetica);
  const bold = await out.embedFont(StandardFonts.HelveticaBold);
  // The index's page numbers depend on how many cover pages there are: settle it.
  let coverPages = 1;
  let laid = layoutCover(datasheetCoverLines(cover, title, coverPages), regular, bold);
  for (let i = 0; i < 4 && laid.length !== coverPages; i++) {
    coverPages = laid.length;
    laid = layoutCover(datasheetCoverLines(cover, title, coverPages), regular, bold);
  }
  laid.forEach((rows, i) => {
    const page = out.insertPage(i, [PAGE_W, PAGE_H]);
    let y = PAGE_H - MARGIN;
    for (const r of rows) {
      y -= r.size * LEAD;
      page.drawText(r.text, { x: MARGIN, y, size: r.size, font: r.font });
    }
  });
  return Buffer.from(await out.save());
}
