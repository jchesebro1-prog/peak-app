import { after } from "next/server";
import { blobEnabled, getBlobStream, putBlobAt } from "@/lib/blob";
import { buildClientPackageManifest, packageNeedsFixtures } from "@/lib/client-package";
import { CutSheetDeadlineError } from "@/lib/curtain-cut-sheets/deadline";
import { ensureOptions, resolveOptionId } from "@/lib/design/grid-options";
import { attachmentDisposition } from "@/lib/document-files";
import { displayQuoteNumber } from "@/lib/estimate-number";
import { specPackageDocs } from "@/lib/estimate-output/package-docs-server";
import { PACKAGE_ZIP_DOC_MAX_BYTES, PACKAGE_ZIP_TOTAL_MAX_BYTES, packageZipCacheDir, packageZipCacheOn } from "@/lib/estimate-output/package-zip";
import type { Letterhead } from "@/lib/letterhead";
import { resolvePeakHeader } from "@/lib/letterhead";
import { loadDocumentLetterhead, loadPeakHeaderDefault } from "@/lib/letterhead-server";
import type { CoverageIndex } from "@/lib/part-docs/coverage";
import { loadPartDocsState } from "@/lib/part-docs/load";
import { resolvePackageDocs } from "@/lib/part-docs/package";
import { readCapped } from "@/lib/rack/submittal-server";
import type { SharedPackage } from "@/lib/quote-share/links";
import { sentDocumentStamp } from "@/lib/quote-share/view";
import { list as listCatalog } from "@/lib/stores/catalog";
import { listFixtures } from "@/lib/stores/fixtures";
import { getProject } from "@/lib/stores/grid-projects";
import { get as getQuote, type Quote, type QuoteRevision } from "@/lib/stores/quotes";
import { zipStream } from "@/lib/zip";
import { BOOK_REASON, bookPartOf, planDatasheetBook, withCanonicalMfrs, type BookPart, type BookPlan, type CanonicalMfr } from "./datasheet-book";
import { buildDatasheetBook, loadCanonicalMfr, type BookDoc, type BuiltBook } from "./datasheet-book-server";
import { BOOK_COVER_COPY, bookCachePath, bookDownloadName, type BookCover } from "./datasheet-book-cover";
import { bookCoverFingerprint, gridBookCover, quoteBookCover } from "./datasheet-book-cover-server";

/**
 * Grid notes #8 — "Download all datasheets": the #329 datasheet book (the
 * ONE combined PDF — A→Z, index, page stamps) with the job cover, on its own:
 * the live estimate (staff, Build package), a Grid design option (staff,
 * Outputs) and a SENT revision (the customer's package page, cached per
 * revision beside the package zip, keyed by the cover). SERVER ONLY.
 *
 * Every download goes through loadBookInputs (the book's parts + plan, in
 * one place) and buildBookDownload (the reads + the build), so a later
 * change to how the book plans — e.g. #329b's canonical-manufacturer
 * resolver — is a one-line change here.
 */

/**
 * The time budget, from ROUTE ENTRY (`startedAt` — every route passes the
 * first thing it did): the prelude (a 37k-part catalog read, coverage) and
 * the reads must finish by +45 s, the merge by +90 s, leaving 30 s of the
 * route's 120 s to stream the response. A prelude that has already eaten the
 * read budget answers 503 with BOOK_COVER_COPY.late, never a half-built book.
 */
export const BOOK_DOWNLOAD_READ_MS = 45_000;
export const BOOK_DOWNLOAD_MERGE_MS = 45_000;
/** The download routes' maxDuration (seconds): the read + merge budgets fit inside it. */
export const BOOK_DOWNLOAD_MAX_DURATION_S = 120;

export type BookInputs = { parts: BookPart[]; plan: BookPlan; canonicalMfr: CanonicalMfr | null };

/**
 * The book's rows for one BOM (one per part, the package's own coverage —
 * #207) and its plan, under the #298 manufacturer merges (#329b,
 * `loadCanonicalMfr()` — null = each part's own manufacturer). THE place a
 * planning option is added for every download.
 */
export function loadBookInputs(input: {
  rows: ReadonlyArray<{ sku: string; desc: string }>;
  partOf: (sku: string) => Parameters<typeof bookPartOf>[1];
  docsOf: (sku: string) => Parameters<typeof bookPartOf>[2];
  canonicalMfr: CanonicalMfr | null;
}): BookInputs {
  const parts = withCanonicalMfrs(input.rows.map((row) => bookPartOf(row, input.partOf(row.sku), input.docsOf(row.sku))), input.canonicalMfr);
  return { parts, plan: planDatasheetBook(parts, input.canonicalMfr), canonicalMfr: input.canonicalMfr };
}

export type ReadDeps = { read: (blobKey: string, signal: AbortSignal) => Promise<ReadableStream | null>; now: () => number };
export const liveReadDeps: ReadDeps = { read: (blobKey, signal) => getBlobStream(blobKey, { signal }), now: Date.now };

/**
 * Each planned datasheet read once, in book order, under the package zip's
 * caps (25 MB a file, 60 MB together → "package size limit") and the read
 * deadline. `clean` is false when a read was late, unreadable or missing —
 * outcomes that may change (the zip's cache rule, zipCacheable).
 */
export async function readBookDocs(plan: BookPlan, index: Pick<CoverageIndex, "docsById">, readsBy: number, deps: ReadDeps = liveReadDeps): Promise<{ docs: Map<string, BookDoc>; clean: boolean }> {
  const docs = new Map<string, BookDoc>();
  let clean = true;
  let total = 0;
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(new CutSheetDeadlineError()), Math.max(0, readsBy - deps.now()));
  try {
    for (const id of plan.docOrder) {
      const skip = (reason: string) => {
        docs.set(id, { bytes: null, reason });
        if (reason !== BOOK_REASON.tooBig) clean = false;
      };
      const meta = index.docsById.get(id);
      if (!meta?.blobKey) {
        skip(BOOK_REASON.missing);
        continue;
      }
      if (meta.size > PACKAGE_ZIP_DOC_MAX_BYTES || total + meta.size > PACKAGE_ZIP_TOTAL_MAX_BYTES) {
        skip(BOOK_REASON.tooBig);
        continue;
      }
      if (deps.now() >= readsBy || abort.signal.aborted) {
        skip(BOOK_REASON.late);
        continue;
      }
      try {
        const stream = await deps.read(meta.blobKey, abort.signal);
        if (!stream) {
          skip(BOOK_REASON.missing);
          continue;
        }
        const bytes = await readCapped(stream as ReadableStream<Uint8Array>, Math.min(PACKAGE_ZIP_DOC_MAX_BYTES, PACKAGE_ZIP_TOTAL_MAX_BYTES - total));
        if (bytes === "too-big") {
          skip(BOOK_REASON.tooBig);
          continue;
        }
        total += bytes.length;
        docs.set(id, { bytes });
      } catch (e) {
        console.warn(`[datasheets] ${id}: ${e instanceof Error ? e.message : String(e)}`);
        skip(abort.signal.aborted ? BOOK_REASON.late : BOOK_REASON.unreadable);
      }
    }
  } finally {
    clearTimeout(timer);
  }
  return { docs, clean };
}

export type BookDownload =
  | { ok: true; pdf: Buffer; fileName: string; pageCount: number; cacheable: boolean }
  | { ok: false; status: 404 | 413 | 500 | 503; error: string };

/** Read + build one book, on the budget from `startedAt` (route entry). No datasheet on the plan → 404 (nothing to combine). */
export async function buildBookDownload(input: {
  inputs: BookInputs;
  /** Epoch ms the route started (BOOK_DOWNLOAD_*_MS count from here). */
  startedAt: number;
  index: Pick<CoverageIndex, "docsById">;
  cover: BookCover;
  letterhead: Letterhead | null;
  fileName: string;
  logTag: string;
  deps?: ReadDeps;
  build?: (i: Parameters<typeof buildDatasheetBook>[0]) => Promise<BuiltBook>;
}): Promise<BookDownload> {
  const deps = input.deps ?? liveReadDeps;
  if (!input.inputs.plan.docOrder.length) return { ok: false, status: 404, error: BOOK_COVER_COPY.nothing };
  const readsBy = input.startedAt + BOOK_DOWNLOAD_READ_MS;
  // The prelude (catalog, coverage, cover) already spent the read budget: say so rather than run past maxDuration.
  if (deps.now() >= readsBy) {
    console.warn(`${input.logTag} book not built: the prelude ran past the read budget`);
    return { ok: false, status: 503, error: BOOK_COVER_COPY.late };
  }
  const { docs, clean } = await readBookDocs(input.inputs.plan, input.index, readsBy, deps);
  const built = await (input.build ?? buildDatasheetBook)({
    subtitleLines: [],
    parts: input.inputs.parts,
    docs,
    letterhead: input.letterhead,
    cover: input.cover,
    canonicalMfr: input.inputs.canonicalMfr,
    // Never past route entry + read + merge budgets (the stream keeps the rest of maxDuration).
    deadline: readsBy + BOOK_DOWNLOAD_MERGE_MS,
    now: deps.now,
    logTag: input.logTag,
  });
  if (!built.ok) {
    console.warn(`${input.logTag} book not built (${built.cause}): ${built.detail}`);
    if (built.cause === "too-big") return { ok: false, status: 413, error: BOOK_COVER_COPY.tooBig };
    if (built.cause === "late") return { ok: false, status: 503, error: BOOK_COVER_COPY.late };
    // No datasheet could be read or merged.
    return { ok: false, status: [...docs.values()].some((d) => d.bytes) ? 500 : 404, error: [...docs.values()].some((d) => d.bytes) ? BOOK_COVER_COPY.failed : BOOK_COVER_COPY.nothing };
  }
  return { ok: true, pdf: built.bytes, fileName: input.fileName, pageCount: built.pageCount, cacheable: clean };
}

/** Staff: the LIVE estimate's book (Build package), with the estimate's own Peak-header choice. */
export async function quoteBookPdf(quoteId: string, opts: { startedAt: number; deps?: ReadDeps }): Promise<BookDownload> {
  const { deps, startedAt } = opts;
  const q = await getQuote(quoteId);
  if (!q) return { ok: false, status: 404, error: "Estimate not found." };
  const docs = await specPackageDocs(q.spec);
  const partBySku = new Map(docs.parts.map((p) => [p.sku, p] as const));
  const [cover, letterhead, canonicalMfr] = await Promise.all([quoteBookCover(q), loadDocumentLetterhead(q.packagePeakHeader), loadCanonicalMfr(undefined, "[datasheets]")]);
  return buildBookDownload({
    startedAt,
    inputs: loadBookInputs({ rows: docs.bom, partOf: (sku) => partBySku.get(sku), docsOf: (sku) => docs.bySku.get(sku), canonicalMfr }),
    index: docs.index,
    cover,
    letterhead,
    fileName: bookDownloadName(q.name, displayQuoteNumber(q)),
    logTag: `[datasheets] quote ${q.id}`,
    deps,
  });
}

/**
 * Staff: one Grid design option's book (Outputs) — the Grid client package's
 * own documents, with the Outputs menu's "Include Peak header" choice
 * (`peakHeader`; undefined = the company default), as its package build.
 */
export async function gridBookPdf(projectId: string, optionId: string | null, by: string, opts: { startedAt: number; peakHeader?: boolean; deps?: ReadDeps }): Promise<BookDownload> {
  const { deps, startedAt } = opts;
  const project = await getProject(projectId);
  if (!project) return { ok: false, status: 404, error: "Design not found." };
  const optId = resolveOptionId(project, optionId);
  const catalog = await listCatalog();
  const { index } = await loadPartDocsState(catalog);
  const fixtures = packageNeedsFixtures(project.placements || []) ? new Map((await listFixtures()).map((f) => [f.id, f] as const)) : null;
  const manifest = buildClientPackageManifest(project, catalog, optId, index, (id) => fixtures?.get(id));
  const partBySku = new Map(catalog.map((p) => [p.sku, p] as const));
  const coverage = resolvePackageDocs(index, manifest.items.filter((i) => !!i.catalogId).map((i) => i.sku));
  const quoteId = ensureOptions(project).options.find((o) => o.id === optId)?.quoteId ?? null;
  const [cover, letterhead, canonicalMfr] = await Promise.all([gridBookCover(project, { quoteId, by }), loadDocumentLetterhead(opts.peakHeader), loadCanonicalMfr(undefined, "[datasheets]")]);
  const catalogIds = new Set(manifest.items.filter((i) => !!i.catalogId).map((i) => i.sku));
  return buildBookDownload({
    startedAt,
    inputs: loadBookInputs({
      rows: manifest.items.map((i) => ({ sku: i.sku, desc: i.description })),
      partOf: (sku) => (catalogIds.has(sku) ? partBySku.get(sku) : null),
      docsOf: (sku) => coverage.bySku.get(sku),
      canonicalMfr,
    }),
    index,
    cover,
    letterhead,
    fileName: bookDownloadName(project.name || project.id, project.id),
    logTag: `[datasheets] grid ${project.id}`,
    deps,
  });
}

/** The customer's package page: a SENT revision's book, with its cover + letterhead already resolved (the cache key). */
export async function revisionBookPdf(q: Quote, rev: QuoteRevision, cover: BookCover, letterhead: Letterhead | null, opts: { startedAt: number; deps?: ReadDeps }): Promise<BookDownload> {
  const { deps, startedAt } = opts;
  const docs = await specPackageDocs(rev.spec);
  const partBySku = new Map(docs.parts.map((p) => [p.sku, p] as const));
  const { revNo } = sentDocumentStamp(q, rev);
  const canonicalMfr = await loadCanonicalMfr(undefined, "[datasheets]");
  return buildBookDownload({
    startedAt,
    inputs: loadBookInputs({ rows: docs.bom, partOf: (sku) => partBySku.get(sku), docsOf: (sku) => docs.bySku.get(sku), canonicalMfr }),
    index: docs.index,
    cover,
    letterhead,
    fileName: bookDownloadName(rev.name || q.name, `${displayQuoteNumber(q)} Rev ${revNo}`),
    logTag: `[datasheets] ${q.id} rev ${rev.rev}`,
    deps,
  });
}

/** `?header=` on the Grid download: "1" on, "0" off, absent = the company default; anything else is "bad" (400). */
export function parsePeakHeaderParam(v: string | null): boolean | undefined | "bad" {
  if (v === null) return undefined;
  if (v === "1") return true;
  if (v === "0") return false;
  return "bad";
}

const PDF_HEADERS = (fileName: string) => ({
  "content-type": "application/pdf",
  "content-disposition": attachmentDisposition(fileName),
  "x-content-type-options": "nosniff",
  "cache-control": "private, no-store",
});

/** The PDF as a STREAMED body (chunked) — never one large buffered response. */
export function bookPdfResponse(pdf: Buffer, fileName: string): Response {
  return new Response(zipStream(pdf), { headers: PDF_HEADERS(fileName) });
}

export const bookTextResponse = (body: string, status: number) =>
  new Response(body, { status, headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "private, no-store" } });

type ServeDeps = {
  cacheOn: boolean;
  get: (path: string) => Promise<ReadableStream | null>;
  put: (path: string, bytes: Buffer) => Promise<void>;
  defer: (task: () => Promise<void>) => void;
  /** The cover as it would print now (frozen revision facts, live logo/contact/roster). */
  cover: (q: Quote, rev: QuoteRevision) => Promise<BookCover>;
  /** The letterhead this download prints — the estimate's Peak-header choice ?? the company default (as the zip). */
  letterhead: (q: Quote) => Promise<Letterhead | null>;
  build: (q: Quote, rev: QuoteRevision, cover: BookCover, letterhead: Letterhead | null, startedAt: number) => Promise<BookDownload>;
};

function deferTask(task: () => Promise<void>): void {
  try {
    after(task);
  } catch {
    void task().catch(() => {});
  }
}

/**
 * The share page's download: the revision's cached book when there is one
 * (`estimate-package/<q>/rev-<n>-<cover>-Datasheets.pdf`, beside the zip —
 * Rebuild package clears both; `<cover>` = bookCoverFingerprint), else build,
 * cache a clean build (the zip's rule: nothing left out but for the size
 * cap) after the response, and stream. The cache follows the zip's gate
 * (production only).
 */
export async function serveSharedBook(pkg: SharedPackage, deps: Partial<ServeDeps> = {}, startedAt: number = Date.now()): Promise<Response> {
  const d: ServeDeps = {
    cacheOn: packageZipCacheOn(process.env, blobEnabled()),
    get: (path) => getBlobStream(path),
    put: async (path, bytes) => {
      await putBlobAt(path, bytes, "application/pdf");
    },
    defer: deferTask,
    cover: (q, rev) => quoteBookCover(q, { rev }),
    letterhead: async (q) => loadDocumentLetterhead(resolvePeakHeader(q.packagePeakHeader, await loadPeakHeaderDefault())),
    build: (q, rev, cover, letterhead, t0) => revisionBookPdf(q, rev, cover, letterhead, { startedAt: t0 }),
    ...deps,
  };
  const { revNo } = sentDocumentStamp(pkg.q, pkg.rev);
  const fileName = bookDownloadName(pkg.rev.name || pkg.q.name, `${displayQuoteNumber(pkg.q)} Rev ${revNo}`);
  // The front matter reads live data: load it first, and key the cache by what it would print.
  const [cover, letterhead] = await Promise.all([d.cover(pkg.q, pkg.rev), d.letterhead(pkg.q)]);
  const path = bookCachePath(packageZipCacheDir(pkg.q.id), pkg.rev.rev, bookCoverFingerprint(cover, letterhead));
  if (d.cacheOn) {
    try {
      const cached = await d.get(path);
      if (cached) return new Response(cached, { headers: PDF_HEADERS(fileName) });
    } catch (e) {
      console.warn("[datasheets] cache read failed", e instanceof Error ? e.message : e);
    }
  }
  const built = await d.build(pkg.q, pkg.rev, cover, letterhead, startedAt);
  if (!built.ok) return bookTextResponse(built.error, built.status);
  if (d.cacheOn && built.cacheable) {
    const pdf = built.pdf;
    d.defer(async () => {
      try {
        await d.put(path, pdf);
      } catch (e) {
        console.warn("[datasheets] cache write failed", e instanceof Error ? e.message : e);
      }
    });
  }
  return bookPdfResponse(built.pdf, fileName);
}
