"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/session";
import { deleteBlob } from "@/lib/blob";
import { get as getPart } from "@/lib/stores/catalog";
import {
  attachDocument,
  createDocument,
  detachDocument,
  getDocument,
  replaceDocumentFile,
} from "@/lib/stores/part-documents";
import { setDocNotNeeded } from "@/lib/part-docs/not-needed";
import { blobPathBelongsTo, isDocumentId, isPartDocKind, type PartDocKind } from "@/lib/part-docs/types";
import { verifyUploadedBlob } from "@/lib/part-docs/verify-upload";

/**
 * Part documents (#DOC) — every write from the Datasheets page, the bulk
 * drop and the part editor's Documents section. Anyone signed in may upload,
 * attach, replace, detach and mark not-needed (spec §2.4); every change
 * records who and when; nothing is hard-deleted.
 */

export type DocActionResult<T = object> = ({ ok: true } & T) | { ok: false; error: string };

const MAX_SKUS_PER_CALL = 500;

function revalidate(): void {
  revalidatePath("/catalog/documents");
  revalidatePath("/catalog");
}

/** How many `getPart` lookups run at once in `liveSkus` — bounded so a
 *  500-SKU drop doesn't fire 500 sequential (or 500 simultaneous) reads. */
const LIVE_SKU_BATCH = 20;

/** The SKUs among `skus` that are live catalog parts (deduped, capped). */
async function liveSkus(skus: readonly string[]): Promise<string[]> {
  const candidates = [...new Set(skus.slice(0, MAX_SKUS_PER_CALL))]
    .map((raw) => String(raw || "").trim())
    .filter(Boolean);
  const out: string[] = [];
  for (let i = 0; i < candidates.length; i += LIVE_SKU_BATCH) {
    const batch = candidates.slice(i, i + LIVE_SKU_BATCH);
    const parts = await Promise.all(batch.map((sku) => getPart(sku)));
    parts.forEach((part, j) => {
      if (part) out.push(batch[j]);
    });
  }
  return out;
}

/**
 * A browser can direct-to-Blob upload a file and then have the action that
 * was meant to record it refuse for an unrelated reason (bad kind, no live
 * SKUs) — that blob is now an orphan. Delete it, but ONLY once the pathname
 * has passed the tightened `blobPathBelongsTo` for the very document id the
 * caller claims it belongs to; a pathname that doesn't belong there might be
 * someone else's document (or nothing), and must never be touched from
 * here. A
 * failed delete is swallowed — a later sweep can still find and remove
 * strays (no such sweep exists yet; see the report).
 */
async function cleanupOrphan(documentId: string, blobPathname: unknown): Promise<void> {
  if (!blobPathBelongsTo(blobPathname, documentId)) return;
  try {
    await deleteBlob(blobPathname);
  } catch {
    /* best effort */
  }
}

/** A browser finished uploading a NEW document's file: check it, record the
 *  document, link it to the parts it was dropped on. */
export async function attachUploadedDocumentAction(input: {
  documentId: string;
  blobPathname: string;
  fileName: string;
  kind: PartDocKind;
  skus: string[];
}): Promise<DocActionResult<{ documentId: string; linked: number }>> {
  const user = await requireUser();
  if (!isDocumentId(input.documentId)) return { ok: false, error: "Not a document id." };
  if (!isPartDocKind(input.kind)) {
    await cleanupOrphan(input.documentId, input.blobPathname);
    return { ok: false, error: "Pick Datasheet or Spec sheet." };
  }
  const skus = await liveSkus(input.skus || []);
  if (!skus.length) {
    await cleanupOrphan(input.documentId, input.blobPathname);
    return { ok: false, error: "Those parts are no longer in the catalog." };
  }
  // A document already existing under this id is not this upload's blob to
  // delete — it may be a legitimate concurrent Replace, or the browser
  // simply retried; leave the blob alone either way.
  if (await getDocument(input.documentId)) return { ok: false, error: "That document already exists — use Replace." };

  const checked = await verifyUploadedBlob(input);
  if (!checked.ok) return checked;
  const doc = await createDocument({
    id: input.documentId,
    kind: input.kind,
    ...checked.file,
    sourceUrl: null,
    source: "upload",
    by: user.name,
  });
  if (!doc) return { ok: false, error: "That document already exists — use Replace." };
  const linked = await attachDocument(doc.id, skus, user.name);
  revalidate();
  return { ok: true, documentId: doc.id, linked };
}

/** A browser finished uploading a REPLACEMENT file for an existing document.
 *  The old file moves to history; every part linked to it sees the new one. */
export async function replaceDocumentFileAction(input: {
  documentId: string;
  blobPathname: string;
  fileName: string;
}): Promise<DocActionResult> {
  const user = await requireUser();
  const doc = await getDocument(input.documentId);
  if (!doc) return { ok: false, error: "That document no longer exists." };
  const checked = await verifyUploadedBlob({ ...input, kind: doc.kind });
  if (!checked.ok) return checked;
  await replaceDocumentFile(doc.id, checked.file, user.name);
  revalidate();
  return { ok: true };
}

/** Unlink one part from a document. The document and its file stay. */
export async function detachDocumentAction(documentId: string, sku: string): Promise<DocActionResult> {
  await requireUser();
  if (!isDocumentId(documentId)) return { ok: false, error: "Not a document id." };
  if (!(await detachDocument(documentId, String(sku || "").trim()))) return { ok: false, error: "That part was not linked to this document." };
  revalidate();
  return { ok: true };
}

/** Link an existing document to more parts ("Also covers…", bulk "Attach an
 *  existing document"). */
export async function attachExistingDocumentAction(documentId: string, skus: string[]): Promise<DocActionResult<{ linked: number }>> {
  const user = await requireUser();
  const doc = await getDocument(documentId);
  if (!doc) return { ok: false, error: "That document no longer exists." };
  const live = await liveSkus(skus || []);
  if (!live.length) return { ok: false, error: "Pick at least one catalog part." };
  const linked = await attachDocument(doc.id, live, user.name);
  revalidate();
  return { ok: true, linked };
}

/** Mark (or unmark) parts as needing no document of one kind. */
export async function setNotNeededAction(skus: string[], kind: PartDocKind, on: boolean): Promise<DocActionResult<{ changed: number }>> {
  await requireUser();
  if (!isPartDocKind(kind)) return { ok: false, error: "Pick Datasheet or Spec sheet." };
  const changed = await setDocNotNeeded((skus || []).slice(0, MAX_SKUS_PER_CALL), kind, !!on);
  revalidate();
  return { ok: true, changed };
}
