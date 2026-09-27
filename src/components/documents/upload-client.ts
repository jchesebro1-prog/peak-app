import { upload } from "@vercel/blob/client";
import { checkDocumentName, documentBlobPath, newUploadKey } from "@/lib/document-files";

/**
 * Browser half of a document upload (#218), shared by the team card and the
 * portal: preflight the name/size, mint an upload key, send the bytes
 * straight to private Blob through a token route (`/api/documents/upload`
 * for the team, `/portal/documents/upload` for a customer). The caller then
 * calls its finalize action with the returned key + pathname — the server
 * re-checks everything. Imported only by client components; everything it
 * imports is client-safe.
 */

export type PutResult = { ok: true; uploadKey: string; pathname: string } | { ok: false; error: string };

/** finalizeDocumentUpload's refusal when this upload key is already on a
 *  document (src/lib/documents-upload.ts ALREADY_SAVED — the spec harness
 *  pins the two strings together). Retrying a finalize whose first response
 *  was lost lands here: the file IS saved, so a caller treats it as success. */
export const ALREADY_SAVED_ERROR = "That file is already saved.";

export function isAlreadySaved(r: { ok: boolean; error?: string; code?: string }): boolean {
  return !r.ok && (r.code === "already-saved" || r.error === ALREADY_SAVED_ERROR);
}

export async function putDocumentFile(
  file: File,
  opts: {
    customerId: string;
    handleUploadUrl: string;
    /** 0–100, as bytes reach Blob. Optional: a caller may show a bar. */
    onProgress?: (percentage: number) => void;
  }
): Promise<PutResult> {
  const refused = checkDocumentName(file.name, file.size);
  if (refused) return { ok: false, error: refused };
  const uploadKey = newUploadKey();
  try {
    const res = await upload(documentBlobPath(opts.customerId, uploadKey, file.name), file, {
      access: "private",
      handleUploadUrl: opts.handleUploadUrl,
      clientPayload: JSON.stringify({ customerId: opts.customerId, uploadKey }),
      contentType: file.type || "application/octet-stream",
      multipart: file.size > 5 * 1024 * 1024,
      onUploadProgress: opts.onProgress ? (e) => opts.onProgress?.(Math.round(e.percentage)) : undefined,
    });
    return { ok: true, uploadKey, pathname: res.pathname };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "";
    return {
      ok: false,
      error: /client token/i.test(msg)
        ? "Upload refused — file storage may not be configured, or your session ended."
        : msg || "Upload failed — try again.",
    };
  }
}
