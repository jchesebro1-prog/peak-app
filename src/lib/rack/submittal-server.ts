/**
 * #296 — the rack submittal files (Task 12): the three printed sheets as
 * PDFs through the signed print route and headless Chrome, the schedule CSV,
 * and every placed part's datasheet merged into one datasheets.pdf — #329:
 * the shared datasheet book (cover + index, manufacturer A→Z, page stamps).
 * SERVER ONLY (stores, Blob, Chrome).
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
import { getBlobStream, safeName } from "@/lib/blob";
import { CutSheetDeadlineError, rejectAfter } from "@/lib/curtain-cut-sheets/deadline";
import { renderTimeoutMs, type PrintWhere } from "@/lib/curtain-cut-sheets/package-sheets";
import { loadPartDocsState } from "@/lib/part-docs/load";
import { BOOK_REASON, bookDate, bookPartOf, planDatasheetBook } from "@/lib/part-docs/datasheet-book";
import { buildDatasheetBook, type BookDoc } from "@/lib/part-docs/datasheet-book-server";
import { resolvePackageDocs } from "@/lib/part-docs/package";
import { PdfRenderUnavailable, renderPrintRouteToPdf } from "@/lib/quote-pdf/render";
import { signPrintToken } from "@/lib/quote-pdf/token";
import { getMany } from "@/lib/stores/catalog";
import type { Letterhead } from "@/lib/letterhead";
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
/** After the datasheet reads: the merge, the zip and the first response bytes. */
export const RACK_SUBMITTAL_FINISH_ALLOWANCE_MS = 10_000;
/** The route's maxDuration (120 s); the harness checks the budgets above fit inside it. */
export const RACK_SUBMITTAL_MAX_DURATION_MS = 120_000;
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
export const DATASHEET_BOOK_FAILED = "The merged datasheets PDF could not be built — the datasheets are on each part.";

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
    /** Grid notes #9 — the Peak letterhead atop the datasheet index (null/absent = none, as before). */
    letterhead?: Letterhead | null;
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
    const book = await datasheetsPdf(submittal, gaps, opts.deadline + RACK_DATASHEET_ALLOWANCE_MS, now, { letterhead: opts.letterhead ?? null, at: loaded.now });
    if (book) files.push({ name: "datasheets.pdf", data: book });
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

/** Shared with the estimate package zip (#301 slice C). */
export async function readCapped(stream: ReadableStream<Uint8Array>, cap: number): Promise<Buffer | "too-big"> {
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

/** The book's customer-facing reason for a staff gap detail. */
const BOOK_REASON_OF: Record<string, string> = {
  [DATASHEET_MISSING]: BOOK_REASON.noDatasheet,
  [DATASHEET_UNREADABLE]: BOOK_REASON.unreadable,
  [DATASHEET_TOO_BIG]: BOOK_REASON.tooBig,
  [DATASHEET_LATE]: BOOK_REASON.late,
};

/**
 * #329 — the rack's datasheets.pdf is the shared datasheet book
 * (datasheet-book-server.ts): cover + index, manufacturer A→Z, each
 * datasheet once, "Page N of M" on every page. Null (and a gap) only when
 * the book itself couldn't be built.
 */
async function datasheetsPdf(
  submittal: RackSubmittal,
  gaps: RackSubmittalGap[],
  readsBy: number,
  now: () => number,
  cover: { letterhead: Letterhead | null; at: number },
): Promise<Buffer | null> {
  const missingCatalog = new Map(submittal.gaps.filter((g) => g.kind === "missing-catalog").map((g) => [g.sku, g] as const));
  const skus = submittal.datasheetSkus.filter((s) => !missingCatalog.has(s));
  const parts = skus.length ? await getMany(skus) : [];
  const { index } = await loadPartDocsState(parts);
  const { bySku } = resolvePackageDocs(index, skus);
  const partBySku = new Map(parts.map((p) => [p.sku, p] as const));
  const nameOf = new Map<string, string>();
  for (const r of [...submittal.schedule, ...submittal.rackLevel]) if (r.sku && !nameOf.has(r.sku)) nameOf.set(r.sku, r.desc || r.sku);
  for (const p of parts) if (p.desc) nameOf.set(p.sku, p.desc);
  const name = (sku: string) => nameOf.get(sku) || sku;
  const gapFor = (skuList: string[], detail: string) => {
    for (const sku of skuList) gaps.push({ sku, label: name(sku), kind: "missing-datasheet", detail });
  };
  const bookParts = submittal.datasheetSkus.map((sku) => bookPartOf({ sku, desc: missingCatalog.get(sku)?.label ?? name(sku) }, partBySku.get(sku), bySku.get(sku)));
  for (const p of bookParts) if (!p.docId && p.reason === BOOK_REASON.noDatasheet) gapFor([p.sku], DATASHEET_MISSING);
  const plan = planDatasheetBook(bookParts);
  const skusOf = new Map<string, string[]>();
  for (const p of plan.parts) if (p.docId) skusOf.set(p.docId, [...(skusOf.get(p.docId) ?? []), p.sku]);

  // Manufacturer A→Z: each distinct document read once, at the first part it serves.
  const docs = new Map<string, BookDoc>();
  const abort = new AbortController();
  const abortTimer = setTimeout(() => abort.abort(new CutSheetDeadlineError()), Math.max(0, readsBy - Date.now()));
  let total = 0;
  try {
    for (const id of plan.docOrder) {
      const served = skusOf.get(id) ?? [];
      const leaveOut = (detail: string) => {
        gapFor(served, detail);
        docs.set(id, { bytes: null, reason: BOOK_REASON_OF[detail] ?? BOOK_REASON.unreadable });
      };
      const meta = index.docsById.get(id);
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
        docs.set(id, { bytes });
      } catch (e) {
        console.warn(`[rack] datasheet ${id} (${served.join(", ")}): ${e instanceof Error ? e.message : String(e)}`);
        leaveOut(abort.signal.aborted ? DATASHEET_LATE : DATASHEET_UNREADABLE);
      }
    }
  } finally {
    clearTimeout(abortTimer);
  }

  const book = await buildDatasheetBook({
    subtitleLines: [`${submittal.title} — rack submittal`, submittal.scope ?? "", bookDate(cover.at)],
    parts: bookParts,
    docs,
    letterhead: cover.letterhead,
    logTag: "[rack]",
    emptyOk: true,
  });
  if (!book.ok) {
    console.warn(`[rack] datasheets.pdf not built (${book.cause}): ${book.detail}`);
    gaps.push({ sku: "", label: "Datasheets", kind: "missing-data", detail: `${DATASHEET_BOOK_FAILED} (${book.cause})` });
    return null;
  }
  for (const id of book.unmergeable) gapFor(skusOf.get(id) ?? [], DATASHEET_UNMERGEABLE);
  return book.bytes;
}
