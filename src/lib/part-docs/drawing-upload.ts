// SERVER ONLY — Blob + sharp.
/**
 * #300 (D606–D607) — a symbol/riser drawing lands in Blob as uploaded
 * (direct-to-Blob), then, after verifyUploadedBlob has accepted the bytes
 * for the kind:
 *  - SVG: the whole file is read, run through `sanitizeSvg` (which refuses
 *    anything over SVG_MAX_BYTES, not a single `<svg>` root, or still
 *    scriptable), and the CLEANED text is written to a NEW blob path under
 *    the same document; the uploaded original is deleted. Nothing unsanitized
 *    is ever recorded. What the sanitizer stripped rides along as
 *    `svgRemoved` so the document shows it.
 *  - PNG/JPEG/WebP: shrunk to ≤ 1024 px WebP (alpha kept — sharp's WebP
 *    encoder preserves it), the original deleted (shrinkStoredImage).
 * A refusal deletes the upload; a read failure does not (that is "try
 * again", not "bad file") — the same rules as shrink-upload.ts.
 */
import type { StoredFile } from "@/lib/stores/part-documents";
import { CONTENT_TYPES } from "./files";
import { liveShrinkUploadDeps, shrinkStoredImage, type ShrinkUploadDeps } from "./shrink-upload";
import { sanitizeSvg } from "./svg-sanitize";
import { partDocBlobPath } from "./types";

/** Longest edge of a stored raster drawing (D607). */
export const DRAWING_MAX_EDGE = 1024;

export async function storeDrawingUpload(
  documentId: string,
  file: StoredFile,
  deps: ShrinkUploadDeps = liveShrinkUploadDeps
): Promise<{ ok: true; file: StoredFile } | { ok: false; error: string }> {
  if (file.contentType !== CONTENT_TYPES.svg) return shrinkStoredImage(documentId, file, deps, { maxEdge: DRAWING_MAX_EDGE });

  const removeQuietly = async (pathname: string) => {
    try {
      await deps.remove(pathname);
    } catch {
      /* best effort — the outcome stands either way */
    }
  };
  let bytes: Uint8Array | null = null;
  try {
    bytes = await deps.read(file.blobKey);
  } catch {
    bytes = null;
  }
  if (!bytes) return { ok: false, error: "Couldn't read the uploaded file — try again" };
  const clean = sanitizeSvg(new TextDecoder("utf-8", { fatal: false }).decode(bytes));
  if (!clean.ok) {
    await removeQuietly(file.blobKey);
    return clean;
  }
  const out = Buffer.from(clean.svg, "utf8");
  let stored: { pathname: string };
  try {
    stored = await deps.put(partDocBlobPath(documentId, file.fileName), out, CONTENT_TYPES.svg);
  } catch {
    await removeQuietly(file.blobKey);
    return { ok: false, error: "Could not store the file." };
  }
  await removeQuietly(file.blobKey);
  return {
    ok: true,
    file: {
      blobKey: stored.pathname,
      fileName: file.fileName,
      contentType: CONTENT_TYPES.svg,
      size: out.byteLength,
      ...(clean.removed.length ? { svgRemoved: clean.removed } : {}),
    },
  };
}
