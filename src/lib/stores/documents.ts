import { getDoc, insertWithPrefixedId, listDocsByField, patchDoc, softDeleteDoc } from "@/db/doc-store";
import { getSettings } from "@/lib/settings";
import { resolveDocumentCategories, type DocumentCategory } from "@/lib/document-categories";
import { cleanText, displayFileName } from "@/lib/document-files";
import {
  cleanNotes,
  cleanTitle,
  filterDocuments,
  isVisibility,
  MAX_TITLE,
  type DocumentFilter,
  type DocumentRecord,
  type DocumentSource,
  type DocumentVisibility,
} from "@/lib/document-rules";

/**
 * Documents (#218) — company / venue / project files. Server-only (the doc
 * store reaches PGlite/Postgres). Every document belongs to one company
 * (`customerId`, never changed after create); the bytes live in private
 * Vercel Blob at `blobPath` and are only ever read through the two download
 * routes. NOT syncable — written only by permission-checked server code.
 *
 * Callers validate scope (venue/project belong to the company) BEFORE they
 * write here — see resolveDocumentScope in src/lib/document-rules.ts and
 * finalizeDocumentUpload in src/lib/documents-upload.ts.
 */

const COLL = "documents" as const;

export type NewDocumentInput = {
  title: string;
  fileName: string;
  mime: string;
  size: number;
  blobPath: string;
  category: string;
  visibility: DocumentVisibility;
  source: DocumentSource;
  customerId: string;
  siteId: string | null;
  projectId: string | null;
  notes: string;
  uploadedBy: string;
  uploadedAt?: number;
};

/** What an edit may change. Never the company, never the file. */
export type DocumentPatch = {
  title?: string;
  category?: string;
  visibility?: DocumentVisibility;
  siteId?: string | null;
  projectId?: string | null;
  notes?: string;
};

function normalize(d: DocumentRecord): DocumentRecord {
  d.fileName = String(d.fileName ?? "") || "file";
  d.title = String(d.title ?? "") || d.fileName;
  d.mime = String(d.mime ?? "") || "application/octet-stream";
  d.size = Number(d.size) || 0;
  d.category = String(d.category ?? "") || "other";
  d.visibility = d.visibility === "shared" ? "shared" : "internal";
  d.source = d.source === "customer" ? "customer" : "team";
  d.siteId = d.siteId || null;
  d.projectId = d.projectId || null;
  d.notes = String(d.notes ?? "");
  d.uploadedBy = String(d.uploadedBy ?? "");
  d.uploadedAt = Number(d.uploadedAt) || 0;
  d.seenByTeamAt = d.seenByTeamAt == null ? null : Number(d.seenByTeamAt);
  return d;
}

/** Mint `DOC-####` (from DOC-1000) and insert, retrying on an id collision.
 *  Every free-text field goes through the shared cleaners here, whatever the
 *  caller did: a lone surrogate (or a cap splitting an emoji) would make the
 *  JSONB write throw, and controls/bidi overrides must never be stored. */
export async function createDocument(input: NewDocumentInput): Promise<DocumentRecord> {
  const at = input.uploadedAt ?? Date.now();
  const fileName = displayFileName(input.fileName);
  const doc = await insertWithPrefixedId<DocumentRecord>(COLL, "DOC", 999, (id) => ({
    id,
    title: cleanTitle(input.title, fileName),
    fileName,
    mime: input.mime,
    size: input.size,
    blobPath: input.blobPath,
    category: input.category,
    visibility: input.visibility,
    source: input.source,
    customerId: input.customerId,
    siteId: input.siteId,
    projectId: input.projectId,
    notes: cleanNotes(input.notes),
    uploadedBy: cleanText(input.uploadedBy, MAX_TITLE),
    uploadedAt: at,
    // Team uploads are born seen; a customer upload waits for the team.
    seenByTeamAt: input.source === "customer" ? null : at,
  }));
  return normalize(doc);
}

export async function getDocument(id: string): Promise<DocumentRecord | null> {
  if (!id) return null;
  const d = await getDoc<DocumentRecord>(COLL, id);
  return d && !d.deleted ? normalize(d) : null;
}

/** One company's documents, newest first, optionally scoped. */
export async function documentsForCustomer(
  customerId: string,
  filter: Omit<DocumentFilter, "customerId"> = {}
): Promise<DocumentRecord[]> {
  if (!customerId) return [];
  const rows = (await listDocsByField<DocumentRecord>(COLL, "customerId", [customerId])).map(normalize);
  return filterDocuments(rows, { ...filter, customerId }).sort((a, b) => b.uploadedAt - a.uploadedAt);
}

/** The live document already recording this blob, if any (finalize refuses a replay). */
export async function documentByBlobPath(blobPath: string): Promise<DocumentRecord | null> {
  if (!blobPath) return null;
  const [d] = await listDocsByField<DocumentRecord>(COLL, "blobPath", [blobPath]);
  return d && !d.deleted ? normalize(d) : null;
}

export async function updateDocument(id: string, patch: DocumentPatch): Promise<DocumentRecord | null> {
  if (!(await getDocument(id))) return null;
  const next = await patchDoc<DocumentRecord>(COLL, id, (d) => {
    if (typeof patch.title === "string") {
      const t = cleanText(patch.title, MAX_TITLE);
      if (t) d.title = t;
    }
    if (typeof patch.category === "string" && patch.category) d.category = patch.category;
    if (isVisibility(patch.visibility)) d.visibility = patch.visibility;
    if (patch.siteId !== undefined) d.siteId = patch.siteId || null;
    if (patch.projectId !== undefined) d.projectId = patch.projectId || null;
    if (typeof patch.notes === "string") d.notes = cleanNotes(patch.notes);
  });
  return next ? normalize(next) : null;
}

/** Soft delete. Returns the removed record so the caller can delete its blob. */
export async function removeDocument(id: string): Promise<DocumentRecord | null> {
  const current = await getDocument(id);
  if (!current) return null;
  await patchDoc<DocumentRecord>(COLL, id, (d) => {
    d.deleted = true;
  });
  await softDeleteDoc(COLL, id);
  return current;
}

/** Stamp unseen CUSTOMER uploads as seen. Returns how many changed. */
export async function markSeen(ids: readonly string[], at: number = Date.now()): Promise<number> {
  let n = 0;
  for (const id of [...new Set(ids)]) {
    const d = await getDocument(id);
    if (!d || d.source !== "customer" || d.seenByTeamAt != null) continue;
    const next = await patchDoc<DocumentRecord>(COLL, id, (x) => {
      x.seenByTeamAt = at;
    });
    if (next) n++;
  }
  return n;
}

/** "Mark seen" on a company's Documents card. */
export async function markCustomerSeen(customerId: string, at: number = Date.now()): Promise<number> {
  const fresh = (await documentsForCustomer(customerId)).filter((d) => d.source === "customer" && d.seenByTeamAt == null);
  return markSeen(fresh.map((d) => d.id), at);
}

/** Every unseen customer upload — the bell's input (one SQL-filtered read). */
export async function unseenCustomerDocuments(): Promise<DocumentRecord[]> {
  const rows = (await listDocsByField<DocumentRecord>(COLL, "source", ["customer"])).map(normalize);
  return rows.filter((d) => !d.deleted && d.seenByTeamAt == null);
}

/** Settings → Document categories, resolved (seed when never edited). */
export async function documentCategories(): Promise<DocumentCategory[]> {
  return resolveDocumentCategories((await getSettings()).documentCategories);
}
