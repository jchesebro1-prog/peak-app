// SERVER ONLY — Blob + sharp.
/**
 * #283 — a browser upload lands in Blob at full size (direct-to-Blob, the
 * bytes never pass through a function), so after verifyUploadedBlob accepts
 * it, the server reads the whole file, shrinks it (shrink.ts), stores the
 * WebP under the same document's path and deletes the original. A refusal
 * deletes the upload, like verifyUploadedBlob's own refusal path. A read
 * failure does NOT delete: that is "try again", not "bad file".
 */
import { deleteBlob, getBlobStream, putBlob } from "@/lib/blob";
import type { StoredFile } from "@/lib/stores/part-documents";
import { shrinkImage, squareProductImage, webpFileName } from "./shrink";
import { partDocBlobPath } from "./types";

export type ShrinkUploadDeps = {
  read(pathname: string): Promise<Uint8Array | null>;
  put(pathname: string, bytes: Buffer, contentType: string): Promise<{ pathname: string }>;
  remove(pathname: string): Promise<void>;
};

async function readWhole(pathname: string): Promise<Uint8Array | null> {
  const stream = await getBlobStream(pathname);
  if (!stream) return null;
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** Exported for the drawing path (#300, drawing-upload.ts), which reads/stores the same way. */
export const liveShrinkUploadDeps: ShrinkUploadDeps = { read: readWhole, put: putBlob, remove: deleteBlob };

export async function shrinkStoredImage(
  documentId: string,
  file: StoredFile,
  deps: ShrinkUploadDeps = liveShrinkUploadDeps,
  /** `maxEdge` — #300 object drawings shrink to ≤ 1024 px (default 1600, shrink.ts). `square` — #322 product photos
   *  become a padded 1600×1600 square (squareProductImage) and the file is marked `squared`. */
  opts: { maxEdge?: number; square?: boolean } = {}
): Promise<{ ok: true; file: StoredFile } | { ok: false; error: string }> {
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
  const shrunk = opts.square ? await squareProductImage(bytes) : await shrinkImage(bytes, opts);
  if (!shrunk.ok) {
    await removeQuietly(file.blobKey);
    return shrunk;
  }
  const fileName = webpFileName(file.fileName);
  let stored: { pathname: string };
  try {
    stored = await deps.put(partDocBlobPath(documentId, fileName), shrunk.bytes, shrunk.contentType);
  } catch {
    await removeQuietly(file.blobKey);
    return { ok: false, error: "Could not store the file." };
  }
  await removeQuietly(file.blobKey);
  return {
    ok: true,
    file: { blobKey: stored.pathname, fileName, contentType: shrunk.contentType, size: shrunk.bytes.byteLength, ...(opts.square ? { squared: true as const } : {}) },
  };
}
