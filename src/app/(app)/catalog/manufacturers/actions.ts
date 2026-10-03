"use server";

import { revalidatePath } from "next/cache";
import { requirePerm } from "@/lib/session";
import { invalidatePortalIndex } from "@/lib/portal-catalog-index";
import { createDocument, getDocument } from "@/lib/stores/part-documents";
import { listManufacturers, removeManufacturerImage, setManufacturerImage } from "@/lib/stores/manufacturers";
import { canonicalKeyMap } from "@/lib/manufacturer-aliases";
import { verifyUploadedBlob } from "@/lib/part-docs/verify-upload";
import { shrinkStoredImage } from "@/lib/part-docs/shrink-upload";
import { isDocumentId } from "@/lib/part-docs/types";
import { mfrKey } from "@/lib/catalog-books";

type Res = { ok: true } | { ok: false; error: string };

function refresh() {
  invalidatePortalIndex();
  revalidatePath("/catalog/manufacturers");
  revalidatePath("/portal/catalog");
}

/** The browser uploaded the file straight to Blob (putFile); check the bytes, shrink, record an UNLINKED image document, point the manufacturer at it. */
export async function setManufacturerImageAction(input: { name: string; documentId: string; blobPathname: string; fileName: string }): Promise<Res> {
  const user = await requirePerm("create");
  const name = String(input?.name ?? "").trim().slice(0, 200);
  if (!mfrKey(name)) return { ok: false, error: "Pick a manufacturer." };
  if (!isDocumentId(input?.documentId)) return { ok: false, error: "Not a document id." };
  // A document already under this id is not this upload's blob to touch (see attachUploadedDocumentAction):
  // verifyUploadedBlob's refusal and shrinkStoredImage both delete blobs, so this check must run first.
  if (await getDocument(input.documentId)) return { ok: false, error: "That document already exists — try again." };
  const checked = await verifyUploadedBlob({ documentId: input.documentId, blobPathname: input.blobPathname, fileName: input.fileName, kind: "image" });
  if (!checked.ok) return checked;
  const shrunk = await shrinkStoredImage(input.documentId, checked.file);
  if (!shrunk.ok) return shrunk;
  // Name the document for the CANONICAL manufacturer — setManufacturerImage lands on
  // the canonical record, so metadata must not name a merged-away alias.
  const records = await listManufacturers();
  const canonKey = canonicalKeyMap(records)(mfrKey(name));
  const canonName = records.find((m) => m.key === canonKey)?.name.trim() || (canonKey === mfrKey(name) ? name : canonKey);
  const doc = await createDocument({ id: input.documentId, kind: "image", title: `${canonName} (manufacturer)`, ...shrunk.file, sourceUrl: null, source: "manufacturer", sourceRef: `mfr:${canonKey}`, by: user.name });
  if (!doc) return { ok: false, error: "That document already exists — try again." };
  await setManufacturerImage({ name, documentId: doc.id, by: user.name });
  refresh();
  return { ok: true };
}

export async function removeManufacturerImageAction(key: string): Promise<Res> {
  const user = await requirePerm("create");
  if (!mfrKey(key)) return { ok: false, error: "Pick a manufacturer." };
  await removeManufacturerImage(key, user.name);
  refresh();
  return { ok: true };
}
