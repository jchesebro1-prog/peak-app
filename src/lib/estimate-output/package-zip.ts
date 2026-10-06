import { quotePathSegment } from "./package-files";

/**
 * #301 slice C (D-l, R10) — the estimate package zip's pure rules: the
 * rack submittal's caps, the per-revision cache path, the download name,
 * and LEFT OUT.txt. Client-safe.
 */

export const PACKAGE_ZIP_DOC_MAX_BYTES = 25 * 1024 * 1024;
export const PACKAGE_ZIP_TOTAL_MAX_BYTES = 60 * 1024 * 1024;
export const PACKAGE_ZIP_DEADLINE_MS = 45_000;
export const PACKAGE_ZIP_CACHE_PREFIX = "estimate-package/";
export const SPEC_DOCX_NAME = "Specifications.docx";
export const LEFT_OUT_NAME = "LEFT OUT.txt";
export const NOTHING_TO_DOWNLOAD = "Nothing to download for this estimate.";
export const LEFT_OUT_REASON = {
  tooBig: "Left out — package size limit",
  late: "Left out — ran out of time",
  unreadable: "Left out — the file couldn't be read",
  missing: "Left out — the file is missing",
} as const;

export type LeftOut = { name: string; reason: string };

export function packageZipCacheDir(quoteId: string): string {
  return `${PACKAGE_ZIP_CACHE_PREFIX}${quotePathSegment(quoteId)}/`;
}

export function packageZipCachePath(quoteId: string, rev: number): string {
  return `${packageZipCacheDir(quoteId)}rev-${rev}.zip`;
}

export function packageZipFileName(number: string, revNo: number): string {
  return `${number} Rev ${revNo} package.zip`;
}

export function leftOutText(rows: readonly LeftOut[]): string {
  return ["These files were left out of this download. Ask your Peak rep for them.", "", ...rows.map((r) => `${r.name} — ${r.reason}`)].join("\r\n") + "\r\n";
}

/** Freeze a build in the cache only when nothing transient went wrong: the
 *  size cap is deterministic; a timeout, an unreadable or a missing file is not. */
export function zipCacheable(rows: readonly LeftOut[]): boolean {
  return rows.every((r) => r.reason === LEFT_OUT_REASON.tooBig);
}

/** Slice C adaptation 3: Blob must be on, and only a Vercel deployment (VERCEL=1)
 *  — or an explicit ESTIMATE_PACKAGE_CACHE=1 — may write the cache. A local
 *  `next dev` or `next start` on a scratch datadir reuses real quote ids next
 *  to the production Blob token, so it never caches by default. */
export function packageZipCacheOn(env: { NODE_ENV?: string; VERCEL?: string; ESTIMATE_PACKAGE_CACHE?: string }, blobOn: boolean): boolean {
  return blobOn && (env.VERCEL === "1" || env.ESTIMATE_PACKAGE_CACHE === "1");
}
