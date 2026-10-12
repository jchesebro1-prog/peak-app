import { quotePathSegment } from "./package-files";

/**
 * #301 slice C (D-l, R10) — the estimate package zip's pure rules: the
 * rack submittal's caps, the per-revision cache path, the download name,
 * and LEFT OUT.txt. Client-safe.
 */

export const PACKAGE_ZIP_DOC_MAX_BYTES = 25 * 1024 * 1024;
export const PACKAGE_ZIP_TOTAL_MAX_BYTES = 60 * 1024 * 1024;
export const PACKAGE_ZIP_DEADLINE_MS = 45_000;
/** #329 — Datasheets.pdf may merge this long past the read deadline (45 + 30 s, then the zip, inside the route's 120 s). */
export const PACKAGE_BOOK_MS = 30_000;
/** #329 — bumped when the zip's contents change, so a cached zip from before is never served (2: Datasheets.pdf; 3: its job cover, Grid notes #8). */
export const PACKAGE_ZIP_CACHE_VERSION = 3;
export const PACKAGE_ZIP_CACHE_PREFIX = "estimate-package/";
export const SPEC_DOCX_NAME = "Specifications.docx";
export const LEFT_OUT_NAME = "LEFT OUT.txt";
export const NOTHING_TO_DOWNLOAD = "Nothing to download for this estimate.";
export const LEFT_OUT_REASON = {
  tooBig: "Left out — package size limit",
  late: "Left out — ran out of time",
  unreadable: "Left out — the file couldn't be read",
  missing: "Left out — the file is missing",
  /** #329 review: the file IS in the zip; only the combined Datasheets.pdf lacks it (a corrupt / unreadable PDF). */
  notInBook: "Not in Datasheets.pdf — the PDF couldn't be read (the file itself is included)",
} as const;

export type LeftOut = { name: string; reason: string };

export function packageZipCacheDir(quoteId: string): string {
  return `${PACKAGE_ZIP_CACHE_PREFIX}${quotePathSegment(quoteId)}/`;
}

/** Grid notes #9 review: keyed by the RESOLVED Peak-header value too (`-h1` /
 *  `-h0`), so a company-default change or a toggle racing a build can never
 *  serve a zip with the wrong header. The header is LIVE, not frozen with the
 *  revision: a toggle after send applies to the next download. #329: plus the
 *  contents version (`-v3`), so a zip cached before is never served. Grid notes
 *  #8: plus `-c<coverKey>`, the fingerprint of Datasheets.pdf's job cover as it
 *  would print now (bookCoverFingerprint — it reads live data), so a logo,
 *  contact, estimator or letterhead edit names a fresh zip, as the standalone book does. */
export function packageZipCachePath(quoteId: string, rev: number, peakHeader: boolean, coverKey: string): string {
  return `${packageZipCacheDir(quoteId)}rev-${rev}-h${peakHeader ? 1 : 0}-c${coverKey}-v${PACKAGE_ZIP_CACHE_VERSION}.zip`;
}

export function packageZipFileName(number: string, revNo: number): string {
  return `${number} Rev ${revNo} package.zip`;
}

export function leftOutText(rows: readonly LeftOut[]): string {
  return ["These files were left out of this download. Ask your Peak rep for them.", "", ...rows.map((r) => `${r.name} — ${r.reason}`)].join("\r\n") + "\r\n";
}

/** Freeze a build in the cache only when nothing transient went wrong: the
 *  size cap and a datasheet the book can't read (#329 review — a corrupt file
 *  stays corrupt) are deterministic; a timeout, an unreadable or a missing file is not. */
export function zipCacheable(rows: readonly LeftOut[]): boolean {
  return rows.every((r) => r.reason === LEFT_OUT_REASON.tooBig || r.reason === LEFT_OUT_REASON.notInBook);
}

/** Slice C adaptation 3: Blob must be on, and only the PRODUCTION Vercel
 *  deployment (VERCEL_ENV=production) — or an explicit ESTIMATE_PACKAGE_CACHE=1 —
 *  may read or write the cache. A preview deploy and a local `next dev` /
 *  `next start` share the production DB and Blob token and reuse real quote
 *  ids, so they never cache (and never delete production's cache) by default. */
export function packageZipCacheOn(env: { NODE_ENV?: string; VERCEL?: string; VERCEL_ENV?: string; ESTIMATE_PACKAGE_CACHE?: string }, blobOn: boolean): boolean {
  return blobOn && (env.VERCEL_ENV === "production" || env.ESTIMATE_PACKAGE_CACHE === "1");
}
