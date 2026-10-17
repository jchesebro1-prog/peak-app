/* Survey files (#344 C4) — one file's bytes, read on the server, for the bytes route and the printed field sheet.
   Server-only: it reads private Blob. */
import { dataUrlToBytes, getBlobStream, isBlobNotFound } from "@/lib/blob";
import { sniffImageType } from "@/lib/part-docs/files";
import { FILE_ID_RE, fileContentType, filePathMatches, fileSlotOf, inlineFileProblem, UPLOAD_CAPS } from "./files";
import type { SurveyRecord } from "@/lib/stores/surveys";

/** A little past the broker's upload caps; anything bigger isn't ours. */
const BYTES_MAX = { jpeg: UPLOAD_CAPS.jpeg + 1024 * 1024, json: UPLOAD_CAPS.json + 256 * 1024 } as const;

export async function readCapped(stream: ReadableStream, max: number): Promise<Buffer | null> {
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

/** True when `bytes` are a strokes document: starts with `{` or `[` and parses as JSON. */
export function isJsonBytes(bytes: Uint8Array): boolean {
  if (!bytes.length || (bytes[0] !== 0x7b && bytes[0] !== 0x5b)) return false;
  try {
    JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    return true;
  } catch {
    return false;
  }
}

function bytesOk(fileId: string, bytes: Buffer): boolean {
  return fileContentType(fileId) === "application/json" ? isJsonBytes(bytes) : sniffImageType(bytes) === "image/jpeg";
}

/** The bytes of one file this survey references (photo, markup, strokes, sketch), or null: unknown / unreferenced
 *  id, still pending, a path outside the file's own name in this survey, missing / too big / the wrong kind of file.
 *  A missing Blob is null, not an error; any other Blob failure throws. */
export async function surveyFileBytes(
  survey: Pick<SurveyRecord, "id" | "photoRefs" | "sketches">,
  fileId: string,
): Promise<{ bytes: Buffer; contentType: "image/jpeg" | "application/json" } | null> {
  if (typeof fileId !== "string" || !FILE_ID_RE.test(fileId)) return null;
  const slot = fileSlotOf(survey, fileId);
  if (!slot) return null;
  const contentType = fileContentType(fileId);
  const max = contentType === "application/json" ? BYTES_MAX.json : BYTES_MAX.jpeg;
  if (slot.blobPath) {
    if (!filePathMatches(slot.blobPath, survey.id, fileId)) return null;
    let stream: ReadableStream | null;
    try {
      stream = await getBlobStream(slot.blobPath);
    } catch (e) {
      if (isBlobNotFound(e)) return null;
      throw e;
    }
    if (!stream) return null;
    const bytes = await readCapped(stream, max);
    return bytes && bytesOk(fileId, bytes) ? { bytes, contentType } : null;
  }
  if (slot.inline) {
    if (inlineFileProblem(fileId, slot.inline)) return null;
    const { bytes } = dataUrlToBytes(slot.inline);
    return bytes.length <= max && bytesOk(fileId, bytes) ? { bytes, contentType } : null;
  }
  return null;
}
