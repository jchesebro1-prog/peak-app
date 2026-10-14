/* Assessments engine (#340) — a photo's JPEG bytes, read on the server. The serve route streams from it and the
   print route (Task 10) inlines photos as data URIs through it, so headless Chrome never needs a session or a token.
   Server-only: it reads private Blob. */
import { dataUrlToBytes, getBlobStream, isBlobNotFound } from "@/lib/blob";
import { sniffImageType } from "@/lib/part-docs/files";
import { inlinePhotoProblem, photoPathInScope } from "./photos";
import type { Assessment } from "@/lib/stores/assessments";

/** Photos are resized to ~200–600 KB on the device and the broker caps an upload at 5 MB; anything past 6 MB isn't ours. */
export const PHOTO_BYTES_MAX = 6 * 1024 * 1024;

async function readCapped(stream: ReadableStream, max: number): Promise<Buffer | null> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > max) return null;
      chunks.push(value);
    }
  } finally {
    try {
      await reader.cancel();
    } catch {
      /* already closed */
    }
  }
  return Buffer.concat(chunks.map((c) => Buffer.from(c.buffer, c.byteOffset, c.byteLength)));
}

/** The JPEG bytes of one photo of this assessment, or null when it has none: unknown id, still pending, a path outside
 *  the assessment's folder, a file that is missing / too big / not a JPEG. A missing file is null, not an error. */
export async function photoBytes(assessment: Assessment, photoId: string): Promise<{ bytes: Buffer; contentType: "image/jpeg" } | null> {
  const p = assessment.photos.find((x) => x.id === photoId);
  if (!p) return null;
  if (p.blobPath) {
    if (!photoPathInScope(p.blobPath, assessment.id)) return null;
    let stream: ReadableStream | null;
    try {
      stream = await getBlobStream(p.blobPath);
    } catch (e) {
      if (isBlobNotFound(e)) return null;
      throw e;
    }
    if (!stream) return null;
    const bytes = await readCapped(stream, PHOTO_BYTES_MAX);
    if (!bytes || sniffImageType(bytes) !== "image/jpeg") return null;
    return { bytes, contentType: "image/jpeg" };
  }
  if (p.inline) {
    if (inlinePhotoProblem(p.inline)) return null;
    const { bytes } = dataUrlToBytes(p.inline);
    return bytes.length <= PHOTO_BYTES_MAX && sniffImageType(bytes) === "image/jpeg" ? { bytes, contentType: "image/jpeg" } : null;
  }
  return null;
}
