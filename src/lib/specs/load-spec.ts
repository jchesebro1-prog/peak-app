import { assembleSection, type AssembledSection } from "@/lib/specs/assemble-section";
import { normalizeSpecDocument, type SpecDocument } from "@/lib/specs/spec-document";
import type { SpecSection } from "@/lib/specs/sections";
import type { SpecCategoryArticle } from "@/lib/specs/articles";
import { getManyAnyCase, type CatalogPart } from "@/lib/stores/catalog";
import { allArticles } from "@/lib/stores/spec-articles";
import { allSections } from "@/lib/stores/spec-sections";
import { getSpecDocument } from "@/lib/stores/spec-documents";
import { allSpecRecords } from "@/lib/stores/spec-records";
import { isPlaceholderSku } from "@/lib/specs/record-keys";
import type { SpecRecord } from "@/lib/specs/records";

/**
 * One saved spec, assembled against the live library and catalog (#205
 * Phase B) — shared by the .docx route and the builder page so both render
 * the same AssembledSection. Server-only (reads stores).
 *
 * `doc` comes back normalized with id "" when the spec is missing;
 * `section`/`assembled` are null when the spec's section is gone. The
 * library and the parts it read come back too (#205 spec builder final fix
 * 10), so the builder page reuses them instead of reading them again —
 * `parts` is keyed by UPPERCASE sku and includes same-as targets.
 * `records` is the whole Spec Library (spec records design §3) — rows match
 * against it before falling back to a part's legacy text.
 */
export type LoadedSpec = {
  doc: SpecDocument;
  section: SpecSection | null;
  assembled: AssembledSection | null;
  sections: SpecSection[];
  articles: SpecCategoryArticle[];
  parts: Map<string, CatalogPart>;
  records: SpecRecord[];
};

export async function loadAssembledSpec(id: string): Promise<LoadedSpec> {
  const doc = (await getSpecDocument(id)) ?? normalizeSpecDocument({});
  const parts = new Map<string, CatalogPart>();
  if (!doc.id) return { doc, section: null, assembled: null, sections: [], articles: [], parts, records: [] };

  const [sections, articles, records] = await Promise.all([allSections(), allArticles(), allSpecRecords()]);
  const section = sections.find((s) => s.id === doc.sectionId) ?? null;

  // The doc's products, then each found part's same-as target (one hop is
  // all assembleSection follows). SKUs match case-insensitively, like the
  // rest of the spec; batched reads, never the whole catalog.
  const add = (list: CatalogPart[]) => {
    for (const p of list) parts.set(p.sku.toUpperCase(), p);
  };
  // Only rows with a real sku have a catalog part to look up (a placeholder /
  // empty sku is an allowance, vendor, curtain or library row, §3.1).
  const skus = doc.products.map((p) => p.sku).filter((s) => s && !isPlaceholderSku(s));
  if (skus.length) add(await getManyAnyCase(skus));
  const targets = [...parts.values()]
    .map((p) => (p.specSameAs || "").trim())
    .filter((s) => s && !parts.has(s.toUpperCase()));
  if (targets.length) add(await getManyAnyCase([...new Set(targets)]));

  const assembled = section ? assembleSection({ section, articles, sections, parts, doc, records }) : null;
  return { doc, section, assembled, sections, articles, parts, records };
}
