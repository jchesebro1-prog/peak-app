import { assembleSection, type AssembledSection, type SpecBuilderPart } from "@/lib/specs/assemble-section";
import { normalizeSpecDocument, type SpecDocument } from "@/lib/specs/spec-document";
import type { SpecSection } from "@/lib/specs/sections";
import { getManyAnyCase } from "@/lib/stores/catalog";
import { allArticles } from "@/lib/stores/spec-articles";
import { allSections } from "@/lib/stores/spec-sections";
import { getSpecDocument } from "@/lib/stores/spec-documents";

/**
 * One saved spec, assembled against the live library and catalog (#205
 * Phase B) — shared by the .docx route and the builder page so both render
 * the same AssembledSection. Server-only (reads stores).
 *
 * `doc` comes back normalized with id "" when the spec is missing;
 * `section`/`assembled` are null when the spec's section is gone.
 */
export async function loadAssembledSpec(
  id: string
): Promise<{ doc: SpecDocument; section: SpecSection | null; assembled: AssembledSection | null }> {
  const doc = (await getSpecDocument(id)) ?? normalizeSpecDocument({});
  if (!doc.id) return { doc, section: null, assembled: null };

  const [sections, articles] = await Promise.all([allSections(), allArticles()]);
  const section = sections.find((s) => s.id === doc.sectionId) ?? null;
  if (!section) return { doc, section: null, assembled: null };

  // The doc's products, then each found part's same-as target (one hop is
  // all assembleSection follows). SKUs match case-insensitively, like the
  // rest of the spec; batched reads, never the whole catalog.
  const parts = new Map<string, SpecBuilderPart>();
  const add = (list: SpecBuilderPart[]) => {
    for (const p of list) parts.set(p.sku.toUpperCase(), p);
  };
  add(await getManyAnyCase(doc.products.map((p) => p.sku)));
  const targets = [...parts.values()]
    .map((p) => (p.specSameAs || "").trim())
    .filter((s) => s && !parts.has(s.toUpperCase()));
  if (targets.length) add(await getManyAnyCase([...new Set(targets)]));

  return { doc, section, assembled: assembleSection({ section, articles, sections, parts, doc }) };
}
