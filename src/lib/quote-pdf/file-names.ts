/**
 * File-name rules for a quote's stored PDFs (quote-pdfs/<id>/…) and the size
 * the finished estimate PDF is kept under. Pure — no imports.
 */

/** The finished estimate PDF is kept comfortably under this (appendix-merge leaves drawings out past it). */
export const ESTIMATE_EMAIL_ATTACH_MAX = 15 * 1024 * 1024;

/** A stored cover's file name: `cover-<ms>[-<Blob suffix>].pdf`. */
const COVER_FILE_RE = /^cover-(\d{10,16})(?:-[A-Za-z0-9]{1,64})?\.pdf$/;

/** True for a cover file name the download route may serve (no directory part). */
export function isCoverFileName(name: unknown): name is string {
  return typeof name === "string" && COVER_FILE_RE.test(name);
}

/** A stored bidder PDF's file name: `bidder-<16 hex party id>-r<rev>-<ms>[-<Blob suffix>].pdf`. */
const BIDDER_FILE_RE = /^bidder-([0-9a-f]{16})-r([1-9]\d{0,5})-(\d{10,16})(?:-[A-Za-z0-9]{1,64})?\.pdf$/;

export function isBidderFileName(name: unknown): name is string {
  return typeof name === "string" && BIDDER_FILE_RE.test(name);
}

export function bidderFileOf(name: unknown): { partyId: string; rev: number } | null {
  const m = typeof name === "string" ? BIDDER_FILE_RE.exec(name) : null;
  return m ? { partyId: "pty_" + m[1], rev: Number(m[2]) } : null;
}
