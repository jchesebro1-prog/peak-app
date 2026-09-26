import { notFound } from "next/navigation";
import { requireUser } from "@/lib/session";
import { can } from "@/lib/team";
import { loadAssembledSpec } from "@/lib/specs/load-spec";
import { placeProduct } from "@/lib/specs/assemble-section";
import { articleIdForPart } from "@/lib/specs/articles";
import { specCustomerOptions } from "../customer-options";
import Builder, { type SpecProductRow } from "./builder";

/**
 * #205 Phase B (T5) — the spec builder's server shell. Loads the spec
 * assembled against the live library + catalog (loadAssembledSpec, the same
 * assembly the Word download uses), this section's Part 2 articles for the
 * header pickers, and one row per product on the spec with where it lands
 * (or why it's left out). All editing lives in the client Builder; viewers
 * without `create` get the same screen read-only.
 */

export const metadata = { title: "Spec — Quartzite-6" };

export default async function SpecBuilderPage({ params }: { params: Promise<{ id: string }> }) {
  const [user, { id }] = await Promise.all([requireUser(), params]);
  // The loader's library + parts are reused below — one read of each.
  const { doc, section, assembled, articles, sections, parts } = await loadAssembledSpec(id);
  if (!doc.id) notFound();

  const canEdit = can("create", user.roles);
  const customerOptions = canEdit ? await specCustomerOptions() : [];

  const sectionArticles = articles
    .filter((a) => a.sectionId === doc.sectionId)
    .sort((a, b) => a.sort - b.sort || a.title.localeCompare(b.title))
    .map((a) => ({ id: a.id, title: a.title }));
  const articleTitle = new Map(articles.map((a) => [a.id, a.title]));
  const leftOutBySku = new Map((assembled?.checklist.leftOut || []).map((l) => [l.sku.toUpperCase(), l]));

  const productRows: SpecProductRow[] = doc.products.map((p) => {
    const part = parts.get(p.sku.toUpperCase());
    const leftOut = leftOutBySku.get(p.sku.toUpperCase()) || null;
    const placement = section ? placeProduct(p, part, section.id, articles, sections) : null;
    const otherArticleId = placement && !placement.ok && placement.reason === "other-section" ? placement.articleId : undefined;
    return {
      sku: part?.sku || p.sku,
      desc: part?.desc || "",
      ...(p.qty != null ? { qty: p.qty } : {}),
      placedArticleId: placement?.ok ? placement.articleId : null,
      leftOutReason: leftOut?.reason ?? null,
      otherArticleTitle: otherArticleId ? articleTitle.get(otherArticleId) || null : null,
      ownArticleId: part ? articleIdForPart(part, articles, sections) : null,
      specArticleId: part?.specArticleId || null,
      deadArticle: !!part?.specArticleId && !articleTitle.has(part.specArticleId),
      specSameAs: (part?.specSameAs || "").trim(),
      specTitle: part?.specTitle || "",
      specBody: part?.specBody || "",
      specSort: typeof part?.specSort === "number" && Number.isFinite(part.specSort) ? part.specSort : null,
    };
  });

  return (
    <Builder
      doc={doc}
      section={section ? { id: section.id, number: section.number, title: section.title } : null}
      assembled={assembled}
      sectionArticles={sectionArticles}
      productRows={productRows}
      customerOptions={customerOptions}
      canEdit={canEdit}
    />
  );
}
