import { buildSpecDocx } from "@/lib/bid-spec-docx";
import type { SpecCatalogPart } from "@/lib/bid-spec";
import { after } from "next/server";
import { blobEnabled, deleteBlobsUnder, getBlobStream, putBlobAt, safeName } from "@/lib/blob";
import { quoteSpecParts } from "@/lib/client-package-server";
import { CutSheetDeadlineError } from "@/lib/curtain-cut-sheets/deadline";
import { attachmentDisposition } from "@/lib/document-files";
import { displayQuoteNumber } from "@/lib/estimate-number";
import { packageEntryName } from "@/lib/part-docs/package";
import { readCapped } from "@/lib/rack/submittal-server";
import type { SharedPackage } from "@/lib/quote-share/links";
import { sentDocumentStamp } from "@/lib/quote-share/view";
import { allSections } from "@/lib/stores/spec-sections";
import type { Quote, QuoteRevision } from "@/lib/stores/quotes";
import { createStoredZip, zipStream, type ZipFile } from "@/lib/zip";
import { revisionPackageDocs } from "./package-docs-server";
import {
  LEFT_OUT_NAME, LEFT_OUT_REASON, leftOutText, NOTHING_TO_DOWNLOAD, PACKAGE_ZIP_DEADLINE_MS, PACKAGE_ZIP_DOC_MAX_BYTES,
  PACKAGE_ZIP_TOTAL_MAX_BYTES, packageZipCacheDir, packageZipCacheOn, packageZipCachePath, packageZipFileName, SPEC_DOCX_NAME, zipCacheable,
  type LeftOut,
} from "./package-zip";

/**
 * #301 slice C (D-l, R10) — the estimate package zip for one SENT revision:
 * Specifications.docx (the D94 assemble over the revision's own BOM), then
 * every datasheet and spec sheet the revision's package lists, read with the
 * rack submittal's caps and a 45 s deadline, plus LEFT OUT.txt for anything
 * skipped. Built in memory; cached in private Blob per (quote, rev) on the
 * first download. Server-only. `deps` exists for the spec harness.
 */

export type BuiltPackageZip = { zip: Buffer; leftOut: LeftOut[]; datasheets: number; specsheets: number; specifications: boolean } | null;

type ZipDeps = {
  read: (blobKey: string, signal: AbortSignal) => Promise<ReadableStream | null>;
  sections: () => Promise<Awaited<ReturnType<typeof allSections>>>;
  now: () => number;
};

const liveZipDeps: ZipDeps = {
  read: (blobKey, signal) => getBlobStream(blobKey, { signal }),
  sections: allSections,
  now: Date.now,
};

export async function buildRevisionPackageZip(q: Quote, rev: QuoteRevision, deps: Partial<ZipDeps> = {}): Promise<BuiltPackageZip> {
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
  if (specifications) files.push({ name: SPEC_DOCX_NAME, data: await buildSpecDocx(sp.spec) });

  const used = new Set<string>();
  let total = 0;
  let datasheets = 0;
  let specsheets = 0;
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(new CutSheetDeadlineError()), Math.max(0, deadline - d.now()));
  try {
    for (const doc of docs.documents) {
      if (doc.kind !== "datasheet" && doc.kind !== "specsheet") continue;
      const name = packageEntryName(doc, used, safeName);
      const meta = docs.index.docsById.get(doc.documentId);
      if (!meta?.blobKey) {
        leftOut.push({ name, reason: LEFT_OUT_REASON.missing });
        continue;
      }
      if (meta.size > PACKAGE_ZIP_DOC_MAX_BYTES || total + meta.size > PACKAGE_ZIP_TOTAL_MAX_BYTES) {
        leftOut.push({ name, reason: LEFT_OUT_REASON.tooBig });
        continue;
      }
      if (d.now() >= deadline || abort.signal.aborted) {
        leftOut.push({ name, reason: LEFT_OUT_REASON.late });
        continue;
      }
      try {
        const stream = await d.read(meta.blobKey, abort.signal);
        if (!stream) {
          leftOut.push({ name, reason: LEFT_OUT_REASON.missing });
          continue;
        }
        const bytes = await readCapped(stream as ReadableStream<Uint8Array>, Math.min(PACKAGE_ZIP_DOC_MAX_BYTES, PACKAGE_ZIP_TOTAL_MAX_BYTES - total));
        if (bytes === "too-big") {
          leftOut.push({ name, reason: LEFT_OUT_REASON.tooBig });
          continue;
        }
        total += bytes.length;
        files.push({ name, data: bytes });
        if (doc.kind === "datasheet") datasheets++;
        else specsheets++;
      } catch (e) {
        console.warn(`[package] ${doc.documentId}: ${e instanceof Error ? e.message : String(e)}`);
        leftOut.push({ name, reason: abort.signal.aborted ? LEFT_OUT_REASON.late : LEFT_OUT_REASON.unreadable });
      }
    }
  } finally {
    clearTimeout(timer);
  }
  if (!files.length && !leftOut.length) return null;
  if (leftOut.length) files.push({ name: LEFT_OUT_NAME, data: Buffer.from(leftOutText(leftOut), "utf8") });
  return { zip: createStoredZip(files), leftOut, datasheets, specsheets, specifications };
}

type ServeDeps = {
  cacheOn: boolean;
  get: (path: string) => Promise<ReadableStream | null>;
  put: (path: string, bytes: Buffer) => Promise<void>;
  /** Run a task after the response goes out (Next's `after()`; fire-and-forget outside a request). */
  defer: (task: () => Promise<void>) => void;
  build: (q: Quote, rev: QuoteRevision) => Promise<BuiltPackageZip>;
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
    build: (q, rev) => buildRevisionPackageZip(q, rev),
    ...deps,
  };
  const { revNo } = sentDocumentStamp(pkg.q, pkg.rev);
  const headers = {
    "content-type": "application/zip",
    "content-disposition": attachmentDisposition(packageZipFileName(displayQuoteNumber(pkg.q), revNo)),
    "x-content-type-options": "nosniff",
    "cache-control": "private, no-store",
  };
  const path = packageZipCachePath(pkg.q.id, pkg.rev.rev);
  if (d.cacheOn) {
    try {
      const cached = await d.get(path);
      if (cached) return new Response(cached, { headers });
    } catch (e) {
      console.warn("[package] zip cache read failed", e instanceof Error ? e.message : e);
    }
  }
  const built = await d.build(pkg.q, pkg.rev);
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
  if (!blobEnabled()) return 0;
  return deleteBlobsUnder(packageZipCacheDir(quoteId));
}
