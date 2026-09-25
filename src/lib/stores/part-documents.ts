import { createHash } from "node:crypto";
import { getDoc, insertDocIfAbsent, listDocs, patchDoc, softDeleteDoc, upsertDoc } from "@/db/doc-store";
import {
  isDocumentId,
  newDocumentId,
  type PartDocKind,
  type PartDocument,
  type PartDocumentLink,
  type PartDocumentSource,
} from "@/lib/part-docs/types";

/**
 * Part documents (#DOC, spec §5) — `part_documents` + `part_document_links`.
 *
 * A document is shared: one row, linked to any number of parts. Nothing is
 * ever hard-deleted — a replace pushes the old file onto `history`, a detach
 * soft-deletes the link row. Link ids are deterministic per (part, document)
 * so attaching twice is a no-op and re-attaching revives the same row.
 */

const hash = (s: string, n: number) => createHash("sha1").update(s).digest("hex").slice(0, n);

/** One row per part↔document (spec §5). */
export function documentLinkId(partSku: string, documentId: string): string {
  return `PDL-${hash(`${partSku}\u0000${documentId}`, 20)}`;
}

/** "ETC_S4LED_Datasheet.pdf" → "ETC S4LED Datasheet". */
export function titleFromFileName(fileName: string): string {
  const base = String(fileName ?? "").split(/[\\/]/).pop() || "";
  return base.replace(/\.[A-Za-z0-9]{1,5}$/, "").replace(/[_]+/g, " ").replace(/\s+/g, " ").trim() || "Document";
}

export async function allDocuments(): Promise<PartDocument[]> {
  return listDocs<PartDocument>("part_documents");
}

export async function getDocument(id: string): Promise<PartDocument | null> {
  if (!isDocumentId(id)) return null;
  return getDoc<PartDocument>("part_documents", id);
}

/** Live links only (detached rows are soft-deleted). */
export async function allDocumentLinks(): Promise<PartDocumentLink[]> {
  return listDocs<PartDocumentLink>("part_document_links");
}

export type NewPartDocument = {
  id?: string;
  kind: PartDocKind;
  title?: string;
  fileName: string;
  contentType: string;
  size: number;
  blobKey: string | null;
  sourceUrl: string | null;
  source: PartDocumentSource;
  sourceRef?: string;
  language?: string;
  by: string;
  at?: number;
};

/** Insert a new document. Returns null when the id is already taken — never
 *  overwrites (a fetched or replaced document must survive a re-run). */
export async function createDocument(input: NewPartDocument): Promise<PartDocument | null> {
  const id = input.id ?? newDocumentId();
  if (!isDocumentId(id)) throw new Error(`Not a document id: ${id}`);
  const doc: PartDocument = {
    id,
    kind: input.kind,
    title: (input.title || "").trim() || titleFromFileName(input.fileName),
    fileName: input.fileName,
    contentType: input.contentType,
    size: input.size,
    blobKey: input.blobKey,
    sourceUrl: input.sourceUrl,
    source: input.source,
    ...(input.sourceRef ? { sourceRef: input.sourceRef } : {}),
    ...(input.language ? { language: input.language } : {}),
    uploadedAt: input.at ?? Date.now(),
    uploadedBy: input.by,
    history: [],
  };
  return (await insertDocIfAbsent("part_documents", doc)) ? doc : null;
}

export type StoredFile = { blobKey: string; fileName: string; contentType: string; size: number };

/**
 * Point a document at a new stored file. The file it held (if any) moves to
 * `history` — the blob itself is never deleted (spec §2.4). Also how a
 * link-only document becomes a stored one after a fetch.
 */
export async function replaceDocumentFile(id: string, file: StoredFile, by: string, at = Date.now()): Promise<PartDocument | null> {
  return patchDoc<PartDocument>("part_documents", id, (d) => {
    const history = [...(d.history || [])];
    if (d.blobKey) history.push({ blobKey: d.blobKey, fileName: d.fileName, size: d.size, replacedAt: at, replacedBy: by });
    return {
      ...d,
      blobKey: file.blobKey,
      fileName: file.fileName,
      contentType: file.contentType,
      size: file.size,
      uploadedAt: at,
      uploadedBy: by,
      history,
    };
  });
}

/** Remember how the last fetch of `sourceUrl` went (D-DOC-3). */
export async function recordFetchResult(id: string, result: { ok: boolean; error?: string }, at = Date.now()): Promise<void> {
  await patchDoc<PartDocument>("part_documents", id, (d) => ({
    ...d,
    lastFetch: result.ok ? { at, ok: true } : { at, ok: false, error: result.error || "Fetch failed." },
  }));
}

/**
 * Link a document to parts. Returns how many links are NEW. A link that
 * exists (live) is left alone; one that was detached is revived.
 */
export async function attachDocument(documentId: string, skus: readonly string[], by: string, at = Date.now()): Promise<number> {
  const doc = await getDocument(documentId);
  if (!doc) return 0;
  let added = 0;
  for (const raw of new Set(skus)) {
    const partSku = String(raw || "").trim();
    if (!partSku) continue;
    const id = documentLinkId(partSku, documentId);
    if (await getDoc("part_document_links", id)) continue;
    await upsertDoc<PartDocumentLink>("part_document_links", { id, partSku, documentId, kind: doc.kind, createdAt: at, createdBy: by });
    added++;
  }
  return added;
}

/**
 * Bulk link for writers that already hold the whole picture (DaVinci
 * pre-fill, legacy backfill). Skips any pair that has EVER been linked —
 * a detached link stays detached, so a re-run never undoes a human's
 * detach. One read of the link table, one insert per new pair.
 */
export async function ensureLinks(
  pairs: ReadonlyArray<{ partSku: string; documentId: string; kind: PartDocKind }>,
  by: string,
  at = Date.now()
): Promise<number> {
  const ever = new Set((await listDocs("part_document_links", { includeDeleted: true })).map((l) => l.id));
  let added = 0;
  for (const p of pairs) {
    const id = documentLinkId(p.partSku, p.documentId);
    if (ever.has(id)) continue;
    ever.add(id);
    if (await insertDocIfAbsent<PartDocumentLink>("part_document_links", { id, partSku: p.partSku, documentId: p.documentId, kind: p.kind, createdAt: at, createdBy: by })) added++;
  }
  return added;
}

/** Detach (soft delete). True when a live link was removed. */
export async function detachDocument(documentId: string, partSku: string): Promise<boolean> {
  const id = documentLinkId(partSku, documentId);
  if (!(await getDoc("part_document_links", id))) return false;
  await softDeleteDoc("part_document_links", id);
  return true;
}
