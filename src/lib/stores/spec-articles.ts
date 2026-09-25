import { getDoc, listDocs, patchDoc, softDeleteDoc, upsertDoc, type Doc } from "@/db/doc-store";
import { normalizeArticle, type SpecCategoryArticle } from "@/lib/specs/articles";

export type { SpecCategoryArticle };

function uid(): string {
  return "ar-" + Math.random().toString(36).slice(2, 10);
}

export async function allArticles(): Promise<SpecCategoryArticle[]> {
  const list = await listDocs<Doc>("spec_articles");
  return list
    .map(normalizeArticle)
    .sort((a, b) => a.sort - b.sort || a.title.localeCompare(b.title));
}

export async function getArticle(id: string): Promise<SpecCategoryArticle | null> {
  const raw = await getDoc<Doc>("spec_articles", id);
  return raw ? normalizeArticle(raw) : null;
}

export async function articlesForSection(sectionId: string): Promise<SpecCategoryArticle[]> {
  return (await allArticles()).filter((a) => a.sectionId === sectionId);
}

export async function createArticle(
  input: Partial<Omit<SpecCategoryArticle, "id" | "updatedAt" | "updatedBy">> & { sectionId: string; title: string },
  by: string
): Promise<SpecCategoryArticle> {
  const rec = normalizeArticle({ ...input, id: uid(), updatedAt: Date.now(), updatedBy: by });
  await upsertDoc<SpecCategoryArticle>("spec_articles", rec);
  return rec;
}

export async function updateArticle(
  id: string,
  patch: Partial<Omit<SpecCategoryArticle, "id">>,
  by: string
): Promise<void> {
  await patchDoc<SpecCategoryArticle>("spec_articles", id, (d) => {
    const next = normalizeArticle({ ...d, ...patch, id });
    next.updatedAt = Date.now();
    next.updatedBy = by;
    return next;
  });
}

export async function deleteArticle(id: string): Promise<void> {
  await softDeleteDoc("spec_articles", id);
}
