"use server";

import { revalidatePath } from "next/cache";
import { requirePerm } from "@/lib/session";
import { invalidatePortalIndex } from "@/lib/portal-catalog-index";
import { createDocument } from "@/lib/stores/part-documents";
import { removeManufacturerImage, setManufacturerImage } from "@/lib/stores/manufacturers";
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
  const checked = await verifyUploadedBlob({ documentId: input.documentId, blobPathname: input.blobPathname, fileName: input.fileName, kind: "image" });
  if (!checked.ok) return checked;
  const shrunk = await shrinkStoredImage(input.documentId, checked.file);
  if (!shrunk.ok) return shrunk;
  const doc = await createDocument({ id: input.documentId, kind: "image", title: `${name} (manufacturer)`, ...shrunk.file, sourceUrl: null, source: "manufacturer", sourceRef: `mfr:${mfrKey(name)}`, by: user.name });
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
