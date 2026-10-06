import { upload } from "@vercel/blob/client";
import { newUploadKey } from "@/lib/document-files";
import { MAX_PACKAGE_FILE_BYTES, PACKAGE_FILES_COPY, packageFileBlobPath } from "@/lib/estimate-output/package-files";

/**
 * #301 slice C — browser half of a drawing upload (the #218 documents
 * pattern): preflight the size, mint an upload key, send the bytes straight
 * to private Blob through the quote's token broker. The caller then calls
 * addPackageFileAction with the key + pathname; the server re-checks
 * everything. Imported only by client components; client-safe imports only.
 */
export type PutPackageFile = { ok: true; uploadKey: string; pathname: string } | { ok: false; error: string };

export async function putPackageFile(file: File, quoteId: string): Promise<PutPackageFile> {
  if (!file.size) return { ok: false, error: PACKAGE_FILES_COPY.empty };
  if (file.size > MAX_PACKAGE_FILE_BYTES) return { ok: false, error: PACKAGE_FILES_COPY.tooBig };
  const uploadKey = newUploadKey();
  try {
    const res = await upload(packageFileBlobPath(quoteId, uploadKey, file.name), file, {
      access: "private",
      handleUploadUrl: `/api/quotes/${encodeURIComponent(quoteId)}/package-files/upload`,
      clientPayload: JSON.stringify({ uploadKey }),
      contentType: file.type || "application/octet-stream",
      multipart: file.size > 5 * 1024 * 1024,
    });
    return { ok: true, uploadKey, pathname: res.pathname };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "";
    return {
      ok: false,
      error: /client token/i.test(msg) ? "Upload refused — file storage may not be configured, or your session ended." : msg || "Upload failed — try again.",
    };
  }
}
