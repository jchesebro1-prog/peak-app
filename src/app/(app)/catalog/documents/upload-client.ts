import { upload } from "@vercel/blob/client";
import { contentTypeForFileName } from "@/lib/part-docs/files";
import { MAX_PART_DOC_BYTES, newDocumentId, partDocBlobPath, type PartDocKind } from "@/lib/part-docs/types";
import { attachUploadedDocumentAction, replaceDocumentFileAction } from "./actions";

/**
 * Browser half of a part-document upload (#207, spec §6): bytes go straight
 * to private Blob through /api/part-documents/upload, then a server action
 * checks what actually landed and records it. Imported only by client
 * components; everything it imports is client-safe.
 */

type Result<T = object> = ({ ok: true } & T) | { ok: false; error: string };

/** Quick refusals before any bytes move. The server re-checks the real bytes. */
export function preflight(file: File, kind: PartDocKind): string | null {
  if (file.size > MAX_PART_DOC_BYTES) return `${file.name} is over 25 MB.`;
  const ok = kind === "datasheet" ? /\.pdf$/i.test(file.name) : /\.(pdf|docx?)$/i.test(file.name);
  if (!ok) return kind === "datasheet" ? `${file.name} is not a PDF.` : `${file.name} is not a PDF or Word file.`;
  return null;
}

async function putFile(file: File, documentId: string): Promise<Result<{ pathname: string }>> {
  try {
    const res = await upload(partDocBlobPath(documentId, file.name), file, {
      access: "private",
      handleUploadUrl: "/api/part-documents/upload",
      clientPayload: JSON.stringify({ documentId }),
      contentType: file.type || contentTypeForFileName(file.name),
      multipart: file.size > 5 * 1024 * 1024,
    });
    return { ok: true, pathname: res.pathname };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "";
    return {
      ok: false,
      error: /client token/i.test(msg)
        ? "Upload refused — file storage may not be configured on this deployment."
        : msg || "Upload failed — try again.",
    };
  }
}

/** A new shared document, linked to `skus`. */
export async function uploadNewDocument(file: File, kind: PartDocKind, skus: string[]): Promise<Result<{ documentId: string }>> {
  const refused = preflight(file, kind);
  if (refused) return { ok: false, error: refused };
  const documentId = newDocumentId();
  const put = await putFile(file, documentId);
  if (!put.ok) return put;
  const r = await attachUploadedDocumentAction({ documentId, blobPathname: put.pathname, fileName: file.name, kind, skus });
  return r.ok ? { ok: true, documentId: r.documentId } : r;
}

/** A new file for an existing document — every linked part sees it. */
export async function uploadReplacement(file: File, documentId: string, kind: PartDocKind): Promise<Result> {
  const refused = preflight(file, kind);
  if (refused) return { ok: false, error: refused };
  const put = await putFile(file, documentId);
  if (!put.ok) return put;
  return replaceDocumentFileAction({ documentId, blobPathname: put.pathname, fileName: file.name });
}
