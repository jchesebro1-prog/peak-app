import { deleteBlob, getBlobHead } from "@/lib/blob";
import type { StoredFile } from "@/lib/stores/part-documents";
import { checkDocumentBytes, CONTENT_TYPES, SNIFF_BYTES } from "./files";
import { blobPathBelongsTo, MAX_PART_DOC_BYTES, type PartDocKind } from "./types";

/**
 * Accept a browser-uploaded blob as a part document's file (#DOC, spec §6).
 * Server-only. The pathname comes from the client and is untrusted: it must
 * sit under `part-docs/<documentId>/`, and the bytes Blob actually holds must
 * sniff as a type the slot accepts. A rejected upload never became a
 * document, so its blob is deleted rather than left orphaned.
 *
 * `deps` exists for the spec harness — production passes nothing.
 */
export type VerifyDeps = {
  head: (pathname: string, max: number) => Promise<{ bytes: Uint8Array; size: number } | null>;
  remove: (pathname: string) => Promise<void>;
};

const liveDeps: VerifyDeps = { head: getBlobHead, remove: deleteBlob };

/** Keep the user's name for display, capped, with an extension that matches the bytes. */
export function displayFileName(raw: string, type: "pdf" | "doc" | "docx"): string {
  const name = String(raw ?? "").split(/[\\/]/).pop()!.trim().slice(0, 180) || "document";
  return new RegExp(`\\.${type}$`, "i").test(name) ? name : `${name.replace(/\.(pdf|docx?)$/i, "")}.${type}`;
}

export async function verifyUploadedBlob(
  input: { documentId: string; blobPathname: string; fileName: string; kind: PartDocKind },
  deps: VerifyDeps = liveDeps
): Promise<{ ok: true; file: StoredFile } | { ok: false; error: string }> {
  if (!blobPathBelongsTo(input.blobPathname, input.documentId)) {
    return { ok: false, error: "That upload does not belong to this document." };
  }
  let head: { bytes: Uint8Array; size: number } | null;
  try {
    head = await deps.head(input.blobPathname, SNIFF_BYTES);
  } catch {
    // A Blob read failure (network, BlobError, …) is not the same as "never
    // arrived" — don't claim that, and never surface the vendor's own
    // error text to the browser.
    return { ok: false, error: "Couldn't read the uploaded file — try again" };
  }
  if (!head) return { ok: false, error: "The upload didn't arrive — try again." };
  const refuse = async (error: string) => {
    try {
      await deps.remove(input.blobPathname);
    } catch {
      /* best effort — the refusal stands either way */
    }
    return { ok: false as const, error };
  };
  if (head.size > MAX_PART_DOC_BYTES) return refuse("That file is over 25 MB.");
  const check = checkDocumentBytes(input.kind, head.bytes);
  if (!check.ok) return refuse(check.error);
  return {
    ok: true,
    file: {
      blobKey: input.blobPathname,
      fileName: displayFileName(input.fileName, check.type),
      contentType: CONTENT_TYPES[check.type],
      size: head.size,
    },
  };
}
