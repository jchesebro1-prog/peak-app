import { notFound } from "next/navigation";
import { requireUser } from "@/lib/session";
import { can } from "@/lib/team";
import { loadAssembledSpec } from "@/lib/specs/load-spec";
import { placeProduct } from "@/lib/specs/assemble-section";
import { articleIdForPart } from "@/lib/specs/articles";
import { specRowKey } from "@/lib/specs/record-keys";
import { specCustomerOptions } from "../customer-options";
import { quoteNumbersFor } from "@/lib/stores/estimate-numbers";
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
      // Row identity (spec records design §3.1) computed here, server-side,
      // from the STORED product — a sku-less row's mfrNumber/specKey/specId/
      // fromLibrary never reach the client any other way, and re-deriving
      // this on the client from the display-only fields below would collapse
      // every such row to the same `DESC:` key (#205 fix round).
      rowKey: specRowKey(p),
      sku: part?.sku || p.sku,
      // A sku-less row (allowance/vendor/curtain) has no catalog part to read
      // a description from — fall back to the quote's own stored desc.
      desc: part?.desc || p.desc || "",
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

  // #223 — the source quote's estimate number for the header's Source line.
  const srcQuoteId = doc.source.quoteId || (doc.source.kind === "quote" ? doc.source.id : undefined);
  const sourceQuoteNumber = srcQuoteId ? (await quoteNumbersFor([srcQuoteId])).get(srcQuoteId) ?? null : null;

  return (
    <Builder
      doc={doc}
      section={section ? { id: section.id, number: section.number, title: section.title } : null}
      assembled={assembled}
      sectionArticles={sectionArticles}
      productRows={productRows}
      customerOptions={customerOptions}
      canEdit={canEdit}
      sourceQuoteNumber={sourceQuoteNumber}
    />
  );
}
