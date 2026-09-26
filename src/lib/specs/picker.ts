import { listDocsFiltered } from "@/db/doc-store";
import { getMany, list as listCatalog, type CatalogPart } from "@/lib/stores/catalog";
import { allArticles } from "@/lib/stores/spec-articles";
import { allSections } from "@/lib/stores/spec-sections";
import { specStateOf, type SpecPartLike } from "@/lib/specs/articles";
import type { SpecDocument } from "@/lib/specs/spec-document";
import { articleIdMapForParts } from "@/app/(app)/design/specs/coverage";

/**
 * The spec builder's "+ Add product" search (#205 Phase B; SQL pre-filter
 * #205 spec builder final fix 6). Server-only (reads stores); the builder
 * action `searchSpecPartsAction` is a thin, session-checked wrapper.
 *
 * Default: parts with an approved spec that resolve into THIS section;
 * `showAll` widens to the whole catalog. Candidate rows are narrowed in SQL
 * before anything is resolved:
 *
 * - a query → only rows whose `sku desc mfr` contains it (capped at
 *   CANDIDATE_CAP; a query that broad is never scrolled past the first 60);
 * - default mode → only rows with spec text or a same-as pointer (a superset
 *   of "has an approved spec");
 * - showAll with no query is the one case that still reads every part.
 *
 * The exact per-part rules then run in JS exactly as before: text match →
 * on-spec exclusion → article/spec-state resolution → in-section/hasSpec
 * filter (default mode) → sort (in-section first, then SKU) → cap 60.
 * Same-as resolution reads only the candidates' targets, by exact SKU and
 * its uppercase — the two keys `resolveSameAs` looks up.
 */

/** One row of the "+ Add product" picker. */
export type SpecPickerPart = {
  sku: string;
  desc: string;
  mfr: string;
  articleId: string | null;
  articleTitle: string;
  inSection: boolean;
  hasSpec: boolean;
  specArticleId: string | null;
  /** The part's stored text (a draft, when !hasSpec) — the builder's Write
   *  spec box starts from it, and writes specSort back unchanged
   *  (writePartSpecFieldsAction clears whatever it isn't given). T5. */
  specTitle: string;
  specBody: string;
  specSort: number | null;
  /** The part's "same spec as" pointer, if any — Write spec replaces it. */
  specSameAs: string;
};

export const PICKER_LIMIT = 60;
const CANDIDATE_CAP = 2000;
const TEXT_FIELDS = ["sku", "desc", "mfr"] as const;
const SPEC_TEXT_FIELDS = ["specBody", "specSameAs"] as const;

export async function searchSpecParts(doc: Pick<SpecDocument, "sectionId" | "products">, q: string, showAll: boolean): Promise<SpecPickerPart[]> {
  const query = String(q || "").trim().toLowerCase();
  const onDoc = new Set(doc.products.map((p) => p.sku.toUpperCase()));

  const pool: Promise<CatalogPart[]> =
    showAll && !query
      ? listCatalog()
      : listDocsFiltered<CatalogPart>("catalog_parts", {
          ...(query ? { text: query, textFields: TEXT_FIELDS, limit: CANDIDATE_CAP } : {}),
          ...(showAll ? {} : { nonEmpty: SPEC_TEXT_FIELDS }),
        });
  const [rows, articles, sections] = await Promise.all([pool, allArticles(), allSections()]);

  const candidates = rows.filter((part) => {
    if (onDoc.has(part.sku.toUpperCase())) return false;
    if (!query) return true;
    const hay = `${part.sku} ${part.desc || ""} ${part.mfr || ""}`.toLowerCase();
    return hay.includes(query);
  });

  // Same-as targets: exact-key reads of each pointer and its uppercase.
  const wants = new Set<string>();
  for (const p of candidates) {
    const want = (p.specSameAs || "").trim();
    if (want) wants.add(want).add(want.toUpperCase());
  }
  const bySku = new Map<string, SpecPartLike>(candidates.map((p) => [p.sku, p]));
  for (const t of wants.size ? await getMany([...wants]) : []) bySku.set(t.sku, t);

  const articleById = new Map(articles.map((a) => [a.id, a]));
  const articleIdByCandidateSku = articleIdMapForParts(candidates, articles, sections);

  const out: SpecPickerPart[] = [];
  for (const part of candidates) {
    const articleId = articleIdByCandidateSku.get(part.sku) ?? null;
    const inSection = !!articleId && articleById.get(articleId)?.sectionId === doc.sectionId;
    const state = specStateOf(part, bySku);
    const hasSpec = state === "authored" || state === "same-as";
    if (!showAll && !(hasSpec && inSection)) continue;
    out.push({
      sku: part.sku,
      desc: part.desc || "",
      mfr: part.mfr || "",
      articleId,
      articleTitle: articleId ? articleById.get(articleId)?.title || "" : "",
      inSection,
      hasSpec,
      specArticleId: part.specArticleId || null,
      specTitle: part.specTitle || "",
      specBody: part.specBody || "",
      specSort: typeof part.specSort === "number" && Number.isFinite(part.specSort) ? part.specSort : null,
      specSameAs: (part.specSameAs || "").trim(),
    });
  }
  out.sort((a, b) => (a.inSection === b.inSection ? a.sku.localeCompare(b.sku) : a.inSection ? -1 : 1));
  return out.slice(0, PICKER_LIMIT);
}
