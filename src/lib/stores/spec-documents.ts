import { getDoc, insertWithPrefixedId, listDocs, patchDoc, softDeleteDoc, type Doc } from "@/db/doc-store";
import {
  normalizeSpecDocument,
  projectSiblings,
  sameProjectNumber,
  withDownloadStamp,
  withSpecHeader,
  type SpecDocument,
} from "@/lib/specs/spec-document";

export type { SpecDocument };

/** Saved specs (#205 Phase B). Ids SP-#### from base 1000. */
export async function createSpecDocument(
  input: Omit<SpecDocument, "id" | "createdAt" | "updatedAt" | "fillInLabels" | "overrides" | "usedRecords"> &
    Partial<Pick<SpecDocument, "fillInLabels" | "overrides" | "usedRecords">>
): Promise<SpecDocument> {
  const t = Date.now();
  return insertWithPrefixedId<SpecDocument & Doc>("spec_documents", "SP", 1000, (id) =>
    ({ ...normalizeSpecDocument({ ...input, id, createdAt: t, updatedAt: t }) }) as SpecDocument & Doc
  );
}

export async function getSpecDocument(id: string): Promise<SpecDocument | null> {
  const raw = await getDoc<Doc>("spec_documents", id);
  return raw ? normalizeSpecDocument(raw) : null;
}

export async function allSpecDocuments(): Promise<SpecDocument[]> {
  const list = await listDocs<Doc>("spec_documents");
  return list.map(normalizeSpecDocument).sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function patchSpecDocument(
  id: string,
  mutate: (d: SpecDocument) => SpecDocument,
  by: string
): Promise<SpecDocument | null> {
  const out = await patchDoc<Doc>("spec_documents", id, (raw) => {
    const next = mutate(normalizeSpecDocument(raw));
    return { ...next, id, updatedAt: Date.now(), updatedBy: by } as unknown as Doc;
  });
  return out ? normalizeSpecDocument(out) : null;
}

/** Copy `sourceId`'s saved header (all five fields) onto every other live
 *  spec with the same project number. Reads the header from the database,
 *  never from the caller. Each target is re-checked inside its own patch, so
 *  a spec renumbered meanwhile keeps its header. Returns the ids updated, or
 *  null when the source spec is gone. */
export async function copySpecHeaderToProject(
  sourceId: string,
  by: string
): Promise<{ source: SpecDocument; ids: string[] } | null> {
  const source = await getSpecDocument(sourceId);
  if (!source) return null;
  const ids: string[] = [];
  for (const t of projectSiblings(await allSpecDocuments(), source)) {
    const out = await patchSpecDocument(
      t.id,
      (d) => (sameProjectNumber(d.header.projectNumber, source.header.projectNumber) ? withSpecHeader(d, source.header) : d),
      by
    );
    if (out && sameProjectNumber(out.header.projectNumber, source.header.projectNumber)) ids.push(t.id);
  }
  return { source, ids };
}

/** The Word download stamp (spec records design §5.3): only `usedRecords` +
 *  `downloadedAt` change — a download is not an edit, so `updatedAt` /
 *  `updatedBy` (and the saved-specs sort) stay as they were. */
export async function stampSpecDocumentDownload(
  id: string,
  used: Record<string, number>,
  at: number
): Promise<SpecDocument | null> {
  const out = await patchDoc<Doc>("spec_documents", id, (raw) => {
    const stamped = withDownloadStamp(normalizeSpecDocument(raw), used, at);
    return {
      ...raw,
      usedRecords: stamped.usedRecords,
      ...(stamped.downloadedAt ? { downloadedAt: stamped.downloadedAt } : {}),
    } as Doc;
  });
  return out ? normalizeSpecDocument(out) : null;
}

export async function removeSpecDocument(id: string): Promise<void> {
  await softDeleteDoc("spec_documents", id);
}
