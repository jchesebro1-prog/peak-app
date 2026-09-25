"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/session";
import { get as getPart } from "@/lib/stores/catalog";
import {
  attachDocument,
  createDocument,
  detachDocument,
  getDocument,
  replaceDocumentFile,
} from "@/lib/stores/part-documents";
import { setDocNotNeeded } from "@/lib/part-docs/not-needed";
import { isDocumentId, isPartDocKind, type PartDocKind } from "@/lib/part-docs/types";
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

/** The SKUs among `skus` that are live catalog parts (deduped, capped).
 *  Trims BEFORE de-duplicating — a raw list with the same SKU in two
 *  different-whitespace spellings must collapse to one lookup, not two. */
async function liveSkus(skus: readonly string[]): Promise<string[]> {
  const candidates = [
    ...new Set(skus.slice(0, MAX_SKUS_PER_CALL).map((raw) => String(raw || "").trim())),
  ].filter(Boolean);
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
 * A browser finished uploading a NEW document's file: check it, record the
 * document, link it to the parts it was dropped on.
 *
 * Security review, fix wave 2: the early refusals below (bad kind, no live
 * SKUs) used to call a `cleanupOrphan` helper that deleted the uploaded
 * blob once its pathname passed `blobPathBelongsTo` for this document id —
 * but that check only proves the pathname sits under
 * `part-docs/<documentId>/…`, not that it's THIS upload's own file. Any
 * signed-in user could read an EXISTING document's real `blobKey` (or a
 * history entry's) through sync pull, then call this action with that
 * existing documentId, that real blobPathname, and a deliberately bad
 * `kind` — the pre-exists check ran AFTER the cleanup, so the live file
 * was deleted before anyone found out the document already existed. A
 * browser simply retrying after its SKUs were removed from the catalog
 * would trip the same path by accident.
 *
 * Fix: neither early refusal touches Blob at all anymore — they just
 * return `{ok:false}`. The only code that ever deletes an uploaded blob is
 * `verifyUploadedBlob`'s own refusal path, and it is only ever reached
 * below, AFTER the "does this document already exist" check has returned.
 * A blob orphaned by one of these two early refusals (a real new upload,
 * genuinely bad kind or genuinely dead SKUs) is not cleaned up by
 * anything today — see the report for the follow-up sweep this needs.
 */
export async function attachUploadedDocumentAction(input: {
  documentId: string;
  blobPathname: string;
  fileName: string;
  kind: PartDocKind;
  skus: string[];
}): Promise<DocActionResult<{ documentId: string; linked: number }>> {
  const user = await requireUser();
  if (!isDocumentId(input.documentId)) return { ok: false, error: "Not a document id." };
  if (!isPartDocKind(input.kind)) return { ok: false, error: "Pick Datasheet or Spec sheet." };
  const skus = await liveSkus(input.skus || []);
  if (!skus.length) return { ok: false, error: "Those parts are no longer in the catalog." };
  // A document already existing under this id is not this upload's blob to
  // touch — it may be someone else's real file (an attacker's whole point
  // in supplying this documentId), a legitimate concurrent Replace, or the
  // browser simply retrying; leave the blob alone either way. This check
  // must run before the only Blob-deleting call in this function
  // (verifyUploadedBlob's own refusal path, below).
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
