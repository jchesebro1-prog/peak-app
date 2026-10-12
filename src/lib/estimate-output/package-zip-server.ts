import { buildSpecDocx } from "@/lib/bid-spec-docx";
import type { SpecCatalogPart } from "@/lib/bid-spec";
import { after } from "next/server";
import { blobEnabled, deleteBlobsUnder, getBlobStream, putBlobAt, safeName } from "@/lib/blob";
import { quoteSpecParts } from "@/lib/client-package-server";
import { CutSheetDeadlineError } from "@/lib/curtain-cut-sheets/deadline";
import { attachmentDisposition } from "@/lib/document-files";
import { displayQuoteNumber } from "@/lib/estimate-number";
import { datasheetEntryName, packageEntryName } from "@/lib/part-docs/package";
import { BOOK_FILE_NAME, BOOK_REASON, bookByteBudget, bookDate, bookPartOf, planDatasheetBook, withCanonicalMfrs, type CanonicalMfr } from "@/lib/part-docs/datasheet-book";
import { BOOK_SKIPPED_REASON, buildDatasheetBook, loadCanonicalMfr, type BookDoc } from "@/lib/part-docs/datasheet-book-server";
import { readCapped } from "@/lib/rack/submittal-server";
import type { SharedPackage } from "@/lib/quote-share/links";
import { sentDocumentStamp } from "@/lib/quote-share/view";
import { allSections } from "@/lib/stores/spec-sections";
import type { Letterhead } from "@/lib/letterhead";
import { loadDocumentLetterhead, loadPeakHeaderDefault } from "@/lib/letterhead-server";
import { resolvePeakHeader } from "@/lib/letterhead";
import type { Quote, QuoteRevision } from "@/lib/stores/quotes";
import { createStoredZip, zipStream, type ZipFile } from "@/lib/zip";
import { revisionPackageDocs } from "./package-docs-server";
import {
  LEFT_OUT_NAME, LEFT_OUT_REASON, leftOutText, NOTHING_TO_DOWNLOAD, PACKAGE_BOOK_MS, PACKAGE_ZIP_DEADLINE_MS, PACKAGE_ZIP_DOC_MAX_BYTES,
  PACKAGE_ZIP_TOTAL_MAX_BYTES, packageZipCacheDir, packageZipCacheOn, packageZipCachePath, packageZipFileName, SPEC_DOCX_NAME, zipCacheable,
  type LeftOut,
} from "./package-zip";

/**
 * #301 slice C (D-l, R10) — the estimate package zip for one SENT revision:
 * Specifications.docx (the D94 assemble over the revision's own BOM), then
 * every datasheet and spec sheet the revision's package lists, read with the
 * rack submittal's caps and a 45 s deadline, plus LEFT OUT.txt for anything
 * skipped. #329: Datasheets.pdf at the root (cover + index + every datasheet
 * read, manufacturer A→Z; merged from the same bytes within PACKAGE_BOOK_MS
 * after the reads) and loose datasheets named `<Manufacturer> - <file>`. Built in memory; cached in private Blob per (quote, rev) on the
 * first download. Server-only. `deps` exists for the spec harness.
 */

export type BuiltPackageZip = { zip: Buffer; leftOut: LeftOut[]; datasheets: number; specsheets: number; specifications: boolean; book?: boolean } | null;

type ZipDeps = {
  read: (blobKey: string, signal: AbortSignal) => Promise<ReadableStream | null>;
  sections: () => Promise<Awaited<ReturnType<typeof allSections>>>;
  now: () => number;
  /** Grid notes #9 — the specification's first-page letterhead (null = none); #329: also the datasheet book's cover. */
  letterhead: (perDoc: boolean | null | undefined) => Promise<Letterhead | null>;
  /** #329b — the #298 manufacturer merges for the datasheet book (null = each part's own manufacturer). */
  canonicalMfr: () => Promise<CanonicalMfr | null>;
};

const liveZipDeps: ZipDeps = {
  read: (blobKey, signal) => getBlobStream(blobKey, { signal }),
  sections: allSections,
  now: Date.now,
  letterhead: loadDocumentLetterhead,
  canonicalMfr: () => loadCanonicalMfr(undefined, "[package]"),
};

/** `peakHeader` (Grid notes #9 review): the header value resolved by the caller (servePackageZip keys the
 *  cache by it, so the build must print exactly that value); absent = resolve the estimate's choice here. */
export async function buildRevisionPackageZip(q: Quote, rev: QuoteRevision, deps: Partial<ZipDeps> = {}, opts: { peakHeader?: boolean } = {}): Promise<BuiltPackageZip> {
  const d: ZipDeps = { ...liveZipDeps, ...deps };
  const deadline = d.now() + PACKAGE_ZIP_DEADLINE_MS;
  const docs = await revisionPackageDocs(rev);
  const files: ZipFile[] = [];
  const leftOut: LeftOut[] = [];

  const df = rev.docFields;
  const sp = quoteSpecParts({
    quote: { id: q.id, name: rev.name || q.name, customer: df?.customer ?? q.customer ?? "" },
    bom: docs.bom,
    catalog: docs.parts as SpecCatalogPart[],
    docIndex: docs.index,
    sections: await d.sections(),
    by: df?.preparedBy || df?.owner || q.owner || "Peak Systems Group",
    date: rev.at,
  });
  const specifications = sp.spec.sections.length > 0;
  // Grid notes #9 — the estimate's own "Include Peak header" (staff package panel) ?? the company default.
  // #329: the same letterhead heads the datasheet book's cover.
  const letterhead = await d.letterhead(typeof opts.peakHeader === "boolean" ? opts.peakHeader : q.packagePeakHeader);
  if (specifications) files.push({ name: SPEC_DOCX_NAME, data: await buildSpecDocx(sp.spec, { letterhead }) });

  // #329 — the book's rows: one per BOM part, manufacturer A→Z; datasheets are read in that order.
  const partBySku = new Map(docs.parts.map((p) => [p.sku, p] as const));
  // #329b — the #298 manufacturer merges, read once for this build (a failed read groups by each part's own text).
  const bookParts = withCanonicalMfrs(docs.bom.map((row) => bookPartOf(row, partBySku.get(row.sku), docs.bySku.get(row.sku))), await d.canonicalMfr());
  const bookPlan = planDatasheetBook(bookParts);
  const rank = new Map(bookPlan.docOrder.map((id, i) => [id, i] as const));
  const ordered = [
    ...docs.documents.filter((x) => x.kind === "datasheet").sort((a, b) => (rank.get(a.documentId) ?? 1e9) - (rank.get(b.documentId) ?? 1e9)),
    ...docs.documents.filter((x) => x.kind === "specsheet"),
  ];
  const bookDocs = new Map<string, BookDoc>();
  const BOOK_REASON_OF: Record<string, string> = {
    [LEFT_OUT_REASON.missing]: BOOK_REASON.missing,
    [LEFT_OUT_REASON.tooBig]: BOOK_REASON.tooBig,
    [LEFT_OUT_REASON.late]: BOOK_REASON.late,
    [LEFT_OUT_REASON.unreadable]: BOOK_REASON.unreadable,
  };

  const used = new Set<string>();
  let total = 0;
  let datasheets = 0;
  let specsheets = 0;
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(new CutSheetDeadlineError()), Math.max(0, deadline - d.now()));
  try {
    for (const doc of ordered) {
      const isDs = doc.kind === "datasheet";
      const name = isDs ? datasheetEntryName(doc, bookPlan.docMfr.get(doc.documentId) ?? "", used) : packageEntryName(doc, used, safeName);
      const skip = (reason: string) => {
        leftOut.push({ name, reason });
        if (isDs) bookDocs.set(doc.documentId, { bytes: null, reason: BOOK_REASON_OF[reason] ?? BOOK_REASON.unreadable });
      };
      const meta = docs.index.docsById.get(doc.documentId);
      if (!meta?.blobKey) {
        skip(LEFT_OUT_REASON.missing);
        continue;
      }
      if (meta.size > PACKAGE_ZIP_DOC_MAX_BYTES || total + meta.size > PACKAGE_ZIP_TOTAL_MAX_BYTES) {
        skip(LEFT_OUT_REASON.tooBig);
        continue;
      }
      if (d.now() >= deadline || abort.signal.aborted) {
        skip(LEFT_OUT_REASON.late);
        continue;
      }
      try {
        const stream = await d.read(meta.blobKey, abort.signal);
        if (!stream) {
          skip(LEFT_OUT_REASON.missing);
          continue;
        }
        const bytes = await readCapped(stream as ReadableStream<Uint8Array>, Math.min(PACKAGE_ZIP_DOC_MAX_BYTES, PACKAGE_ZIP_TOTAL_MAX_BYTES - total));
        if (bytes === "too-big") {
          skip(LEFT_OUT_REASON.tooBig);
          continue;
        }
        total += bytes.length;
        files.push({ name, data: bytes });
        if (isDs) {
          datasheets++;
          bookDocs.set(doc.documentId, { bytes, name });
        } else specsheets++;
      } catch (e) {
        console.warn(`[package] ${doc.documentId}: ${e instanceof Error ? e.message : String(e)}`);
        skip(abort.signal.aborted ? LEFT_OUT_REASON.late : LEFT_OUT_REASON.unreadable);
      }
    }
  } finally {
    clearTimeout(timer);
  }

  // #329 — Datasheets.pdf at the root, from the bytes just read. Skipped (with
  // a LEFT OUT line) when it can't be built in time or outgrows the cap.
  let book = false;
  if (datasheets > 0) {
    const { revNo, issuedAt } = sentDocumentStamp(q, rev);
    const built = await buildDatasheetBook({
      subtitleLines: [rev.name || q.name, df?.customer ?? q.customer ?? "", `Estimate ${displayQuoteNumber(q)} · Rev ${revNo}`, bookDate(issuedAt)],
      parts: bookParts,
      docs: bookDocs,
      letterhead,
      deadline: Math.max(deadline, d.now()) + PACKAGE_BOOK_MS,
      now: d.now,
      logTag: `[package] ${q.id} rev ${rev.rev}`,
      // #329 review: the loose datasheets + the book stay under BOOK_ZIP_CEILING_BYTES.
      maxBytes: bookByteBudget([...bookDocs.values()].reduce((n, x) => n + (x.bytes?.byteLength ?? 0), 0)),
    });
    if (built.ok) {
      files.splice(specifications ? 1 : 0, 0, { name: BOOK_FILE_NAME, data: built.bytes });
      book = true;
      // A datasheet the book couldn't read ships loose but isn't in the book: say so (deterministic — still cacheable).
      for (const id of built.unmergeable) leftOut.push({ name: bookDocs.get(id)?.name ?? "A datasheet", reason: LEFT_OUT_REASON.notInBook });
    } else {
      console.warn(`[package] ${q.id} rev ${rev.rev}: ${BOOK_FILE_NAME} skipped (${built.cause}): ${built.detail}`);
      leftOut.push({ name: BOOK_FILE_NAME, reason: built.cause === "too-big" ? LEFT_OUT_REASON.tooBig : built.cause === "late" ? LEFT_OUT_REASON.late : BOOK_SKIPPED_REASON.failed });
    }
  }
  if (!files.length && !leftOut.length) return null;
  if (leftOut.length) files.push({ name: LEFT_OUT_NAME, data: Buffer.from(leftOutText(leftOut), "utf8") });
  return { zip: createStoredZip(files), leftOut, datasheets, specsheets, specifications, book };
}

type ServeDeps = {
  cacheOn: boolean;
  get: (path: string) => Promise<ReadableStream | null>;
  put: (path: string, bytes: Buffer) => Promise<void>;
  /** Run a task after the response goes out (Next's `after()`; fire-and-forget outside a request). */
  defer: (task: () => Promise<void>) => void;
  build: (q: Quote, rev: QuoteRevision, peakHeader: boolean) => Promise<BuiltPackageZip>;
  /** Grid notes #9 review: the header this download prints — the estimate's choice ?? the company default. */
  peakHeader: (q: Quote) => Promise<boolean>;
};

/** Next's `after()` where there is a request scope, else a plain un-awaited call; a rejection is the task's own to catch. */
function deferTask(task: () => Promise<void>): void {
  try {
    after(task);
  } catch {
    void task().catch(() => {});
  }
}

const textResponse = (body: string, status: number) =>
  new Response(body, { status, headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "private, no-store" } });

/** The download: the cached blob when there is one, else build, cache a clean build, and stream. */
export async function servePackageZip(pkg: SharedPackage, deps: Partial<ServeDeps> = {}): Promise<Response> {
  const d: ServeDeps = {
    cacheOn: packageZipCacheOn(process.env, blobEnabled()),
    get: (path) => getBlobStream(path),
    put: async (path, bytes) => {
      await putBlobAt(path, bytes, "application/zip");
    },
    defer: deferTask,
    build: (q, rev, peakHeader) => buildRevisionPackageZip(q, rev, {}, { peakHeader }),
    peakHeader: async (q) => resolvePeakHeader(q.packagePeakHeader, await loadPeakHeaderDefault()),
    ...deps,
  };
  const { revNo } = sentDocumentStamp(pkg.q, pkg.rev);
  const headers = {
    "content-type": "application/zip",
    "content-disposition": attachmentDisposition(packageZipFileName(displayQuoteNumber(pkg.q), revNo)),
    "x-content-type-options": "nosniff",
    "cache-control": "private, no-store",
  };
  // The header is LIVE (not frozen with the revision): resolved once per download, it keys the cache AND
  // drives the build, so a default change or a toggle mid-build never serves the other header's zip.
  const peakHeader = await d.peakHeader(pkg.q);
  const path = packageZipCachePath(pkg.q.id, pkg.rev.rev, peakHeader);
  if (d.cacheOn) {
    try {
      const cached = await d.get(path);
      if (cached) return new Response(cached, { headers });
    } catch (e) {
      console.warn("[package] zip cache read failed", e instanceof Error ? e.message : e);
    }
  }
  const built = await d.build(pkg.q, pkg.rev, peakHeader);
  if (!built) return textResponse(NOTHING_TO_DOWNLOAD, 404);
  if (d.cacheOn && zipCacheable(built.leftOut)) {
    const zip = built.zip;
    d.defer(async () => {
      try {
        await d.put(path, zip);
      } catch (e) {
        console.warn("[package] zip cache write failed", e instanceof Error ? e.message : e);
      }
    });
  }
  return new Response(zipStream(built.zip), { headers });
}

/** Staff "Rebuild package": drop every cached revision zip of this quote. */
export async function clearPackageZipCache(quoteId: string): Promise<number> {
  // The same gate as the cache itself: a preview deploy shares production's Blob and must not delete its cache.
  if (!packageZipCacheOn(process.env, blobEnabled())) return 0;
  return deleteBlobsUnder(packageZipCacheDir(quoteId));
}
