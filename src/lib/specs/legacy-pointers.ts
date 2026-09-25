import { list as listCatalog, mergeUpsert } from "@/lib/stores/catalog";
import { allSections } from "@/lib/stores/spec-sections";
import { allArticles } from "@/lib/stores/spec-articles";
import { adoptLegacySpecPointers } from "@/lib/specs/articles";

/**
 * D-SPEC-5, persisted. Fills absent canonical pointers from the Displays
 * metadata so readers that do not adopt at read time (the Displays API, D94's
 * assemble, the catalog export) see ids. Idempotent: a second run writes
 * nothing. Never overwrites a canonical value and never deletes the legacy
 * text. mergeUpsert stamps `updatedAt` on the parts it touches (correct — the
 * Displays cursor should see them change); `pricedAt` does not move.
 */
export async function adoptAllLegacySpecPointers(): Promise<{ adopted: number; unresolved: number }> {
  const [parts, sections, articles] = await Promise.all([listCatalog(), allSections(), allArticles()]);
  let adopted = 0;
  let unresolved = 0;
  for (const p of parts) {
    const md = p.productMetadata;
    if (!md?.specSection && !md?.specArticle) continue;
    const patch = adoptLegacySpecPointers(p, articles, sections);
    if (Object.keys(patch).length) {
      await mergeUpsert(p.sku, patch);
      adopted++;
    }
    const after = { ...p, ...patch };
    if ((md.specSection && !after.specSectionId) || (md.specArticle && !after.specArticleId)) unresolved++;
  }
  return { adopted, unresolved };
}
