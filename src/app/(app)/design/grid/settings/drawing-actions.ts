"use server";

import { requirePerm } from "@/lib/session";
import { getDeviceTypes } from "@/lib/stores/device-types";
import { createDocument, getDocument } from "@/lib/stores/part-documents";
import { verifyUploadedBlob } from "@/lib/part-docs/verify-upload";
import { storeDrawingUpload } from "@/lib/part-docs/drawing-upload";
import { isDocumentId } from "@/lib/part-docs/types";

/**
 * #300 — Grid Settings → Device types drawing upload, step 1 of 2. The
 * browser put the file straight to Blob (putFile); this checks the bytes as
 * a `symbol` drawing, sanitizes the SVG (or shrinks a raster) and records an
 * UNLINKED `symbol` part document — linked to no part, like a manufacturer
 * image (#297). Step 2 is `setDeviceTypeSymbolAction(typeKey, documentId)`.
 * Admin only, the same gate as every Grid Settings write.
 */
export async function createDeviceTypeDrawingAction(input: {
  typeKey: string;
  documentId: string;
  blobPathname: string;
  fileName: string;
}): Promise<{ ok: true; documentId: string } | { ok: false; error: string }> {
  const user = await requirePerm("manage_users");
  const type = (await getDeviceTypes()).find((t) => t.key === String(input?.typeKey ?? ""));
  if (!type) return { ok: false, error: "That device type no longer exists." };
  if (!isDocumentId(input?.documentId)) return { ok: false, error: "Not a document id." };
  // A document already under this id is not this upload's blob to touch (see
  // attachUploadedDocumentAction): verifyUploadedBlob's refusal and
  // storeDrawingUpload both delete blobs, so this check must run first.
  if (await getDocument(input.documentId)) return { ok: false, error: "That document already exists — try again." };
  const checked = await verifyUploadedBlob({ documentId: input.documentId, blobPathname: input.blobPathname, fileName: input.fileName, kind: "symbol" });
  if (!checked.ok) return checked;
  const drawn = await storeDrawingUpload(input.documentId, checked.file);
  if (!drawn.ok) return drawn;
  const doc = await createDocument({
    id: input.documentId,
    kind: "symbol",
    title: `${type.label} (device type)`,
    ...drawn.file,
    sourceUrl: null,
    source: "upload",
    sourceRef: `type:${type.key}`,
    by: user.name,
  });
  if (!doc) return { ok: false, error: "That document already exists — try again." };
  return { ok: true, documentId: doc.id };
}
