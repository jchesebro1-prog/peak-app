import { getDoc, insertWithPrefixedId, listDocs, patchDoc, softDeleteDoc, type Doc } from "@/db/doc-store";
import { normalizeSpecDocument, type SpecDocument } from "@/lib/specs/spec-document";

export type { SpecDocument };

/** Saved specs (#205 Phase B). Ids SP-#### from base 1000. */
export async function createSpecDocument(
  input: Omit<SpecDocument, "id" | "createdAt" | "updatedAt" | "fillInLabels"> & { fillInLabels?: Record<string, string> }
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

export async function removeSpecDocument(id: string): Promise<void> {
  await softDeleteDoc("spec_documents", id);
}
