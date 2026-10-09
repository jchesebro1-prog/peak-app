import { isUploadKey, safeFileName } from "@/lib/document-files";
import { sniffPackageFile } from "@/lib/estimate-output/package-files";
import { GRID_SHEET_BLOB_PREFIX } from "@/lib/grid-sheet-file";

/**
 * #318 — plan sheets up to 25 MB, straight from the browser to private Blob
 * (the Plans & risers broker, #301). Pure and client-safe: the path every
 * upload must sit under, the sniff, the copy. The token route
 * (/api/grid-sheets/upload-url) grants ONE path per upload; the commit
 * (grid-sheet-upload-server.ts) treats the browser's `blobPath` as untrusted
 * and re-checks scope, size and the bytes before a sheet is recorded.
 * Without Blob (local dev) the 4 MB multipart route stays (grid-sheet-file.ts).
 */

export const GRID_SHEET_DIRECT_MAX_BYTES = 25 * 1024 * 1024;
export const GRID_SHEET_DIRECT_MAX_LABEL = "25 MB";
export const GRID_SHEET_DIRECT_TYPES = ["application/pdf", "image/png", "image/jpeg", "image/webp", "image/gif"] as const;
export type GridSheetDirectType = (typeof GRID_SHEET_DIRECT_TYPES)[number];
/** #318: the file pickers' `accept` — exactly the five types the commit sniffs for (+ their extensions). */
export const GRID_SHEET_ACCEPT = [...GRID_SHEET_DIRECT_TYPES, ".pdf", ".png", ".jpg", ".jpeg", ".webp", ".gif"].join(",");
/** Bytes read from the uploaded blob to tell what it really is. */
export const GRID_SHEET_SNIFF_BYTES = 1024;

export const GRID_SHEET_UPLOAD_COPY = {
  tooBig: `That file is larger than ${GRID_SHEET_DIRECT_MAX_LABEL}. Print the drawing to a smaller PDF (one sheet per file) and try again.`,
  empty: "That file is empty.",
  wrongType: "PDF or image files only (PNG, JPEG, WebP or GIF) — print DWGs to PDF first.",
  notThisDesign: "That upload doesn't belong to this design.",
  alreadySaved: "That file is already on this design.",
  badUploadId: "Bad upload id.",
  noArrival: "The upload didn't arrive — try again.",
  unreadable: "Couldn't read the uploaded file — try again.",
  noStorage: "File storage isn't configured on this server.",
  gone: "That design could not be found.",
} as const;

/** One path segment for a design id (ids are `GRD-####`; anything odd folds to `_`). */
export function projectPathSegment(projectId: string): string {
  return String(projectId ?? "").replace(/[^A-Za-z0-9_-]+/g, "_").slice(0, 64) || "_";
}

export function gridSheetUploadPrefix(projectId: string, uploadKey: string): string {
  return `${GRID_SHEET_BLOB_PREFIX}${projectPathSegment(projectId)}/${uploadKey}/`;
}

/** `grid-sheets/<design>/<uploadKey>/<safe name>` — Blob appends a random suffix. */
export function gridSheetBlobPath(projectId: string, uploadKey: string, fileName: string): string {
  return gridSheetUploadPrefix(projectId, uploadKey) + safeFileName(fileName);
}

/** Does a CLIENT-SUPPLIED pathname sit directly under this design's upload key? */
export function gridSheetPathInScope(pathname: unknown, projectId: string, uploadKey: string): pathname is string {
  if (typeof pathname !== "string" || !projectId || !isUploadKey(uploadKey)) return false;
  const prefix = gridSheetUploadPrefix(projectId, uploadKey);
  if (!pathname.startsWith(prefix) || pathname.includes("..")) return false;
  const rest = pathname.slice(prefix.length);
  return rest.length > 0 && rest.length <= 200 && /^[A-Za-z0-9._-]+$/.test(rest);
}

/** The token route's clientPayload: `{uploadKey, projectId}`, or null. */
export function parseSheetUploadPayload(payload: string | null | undefined): { uploadKey: string; projectId: string } | null {
  try {
    const p = payload ? (JSON.parse(payload) as { uploadKey?: unknown; projectId?: unknown } | null) : null;
    if (!p || !isUploadKey(p.uploadKey) || typeof p.projectId !== "string") return null;
    return /^[A-Za-z0-9_-]{1,64}$/.test(p.projectId) ? { uploadKey: p.uploadKey, projectId: p.projectId } : null;
  } catch {
    return null;
  }
}

const MARKUP = /<svg|<html|<script|<!doctype|<\?xml/;

/**
 * What an uploaded sheet really is: a PDF or one of the four raster types;
 * markup / SVG / anything else → null.
 *
 * A PDF is `%PDF-` anywhere in the first KB (readers accept leading junk
 * there), and a real plan PDF often carries XMP/XML metadata right after its
 * header — so markup AFTER the header never refuses a PDF. Markup BEFORE it
 * does (an HTML page that merely mentions `%PDF-`). Every other type needs
 * its real signature and no markup anywhere in the head (polyglots).
 */
export function sniffSheetFile(head: Uint8Array): GridSheetDirectType | null {
  const bytes = head.subarray(0, GRID_SHEET_SNIFF_BYTES);
  const raw = Array.from(bytes, (b) => String.fromCharCode(b)).join("");
  const lower = raw.toLowerCase();
  const pdfAt = raw.indexOf("%PDF-");
  if (pdfAt >= 0 && !MARKUP.test(lower.slice(0, pdfAt))) return "application/pdf";
  if (MARKUP.test(lower)) return null;
  const known = sniffPackageFile(bytes);
  if (known && known !== "application/pdf") return known;
  // GIF87a / GIF89a — the one sheet type Plans & risers doesn't take.
  const isGif = bytes.length >= 6 && bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x38 && (bytes[4] === 0x37 || bytes[4] === 0x39) && bytes[5] === 0x61;
  return isGif ? "image/gif" : null;
}
