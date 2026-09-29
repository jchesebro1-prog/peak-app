import { notFound } from "next/navigation";
import { requireUser } from "@/lib/session";
import { can } from "@/lib/team";
import { loadAssembledSpec } from "@/lib/specs/load-spec";
import { placeProduct } from "@/lib/specs/assemble-section";
import { articleIdForPart, csiKey } from "@/lib/specs/articles";
import { isPlaceholderSku, specRowKey } from "@/lib/specs/record-keys";
import { partNumbersSummary, recordProductName, systemMatchKeys as systemMatchKeysOf, type SpecKind } from "@/lib/specs/records";
import { specCustomerOptions } from "../customer-options";
import { quoteNumbersFor } from "@/lib/stores/estimate-numbers";
import Builder, { type SpecProductRow } from "./builder";
import type { SlimSpecRecord } from "./record-row";

/**
 * #205 Phase B (T5) — the spec builder's server shell. Loads the spec
 * assembled against the live library + catalog (loadAssembledSpec, the same
 * assembly the Word download uses), this section's Part 2 articles for the
 * header pickers, and one row per product on the spec with where it lands
 * (or why it's left out). All editing lives in the client Builder; viewers
 * without `create` get the same screen read-only.
 *
 * Spec records (Task 9): each row also carries its match outcome and the
 * Write-new-spec defaults inferred from the row, and the client gets a slim
 * `recordsById` map of just the records this spec refers to, the library
 * text of the ones it prints (the Edit panel's starting point) and the
 * system match keys (Write new spec's key suggestions).
 */

export const metadata = { title: "Spec — Quartzite-6" };

export default async function SpecBuilderPage({ params }: { params: Promise<{ id: string }> }) {
  const [user, { id }] = await Promise.all([requireUser(), params]);
  // The loader's library + parts are reused below — one read of each.
  const { doc, section, assembled, articles, sections, parts, records } = await loadAssembledSpec(id);
  if (!doc.id) notFound();

  const canEdit = can("create", user.roles);
  const customerOptions = canEdit ? await specCustomerOptions() : [];

  const sectionArticles = articles
    .filter((a) => a.sectionId === doc.sectionId)
    .sort((a, b) => a.sort - b.sort || a.title.localeCompare(b.title))
    .map((a) => ({ id: a.id, title: a.title }));
  const articleTitle = new Map(articles.map((a) => [a.id, a.title]));
  // Keyed by row identity, not sku — a sku-less row has sku "" (§3.1).
  const leftOutByKey = new Map((assembled?.checklist.leftOut || []).map((l) => [l.rowKey, l]));
  const recordById = new Map(records.map((r) => [r.specId, r]));

  const productRows: SpecProductRow[] = doc.products.map((p) => {
    const rowKey = specRowKey(p);
    const part = parts.get(p.sku.toUpperCase());
    const leftOut = leftOutByKey.get(rowKey) || null;
    const match = assembled?.rowMatches[rowKey];
    // A row matched to a Spec Library record prints under the record's own
    // article (design §3.3); every other row keeps the #205 placement.
    const record = match?.status === "matched" ? recordById.get(match.specId) : undefined;
    const placement = section ? placeProduct(p, part, section.id, articles, sections) : null;
    const placedArticleId =
      match?.status === "waived" ? null : record ? (leftOut ? null : record.sourceArticleId) : placement?.ok ? placement.articleId : null;
    const otherArticleId = record
      ? leftOut?.reason === "other-section"
        ? record.sourceArticleId || undefined
        : undefined
      : placement && !placement.ok && placement.reason === "other-section"
        ? placement.articleId
        : undefined;
    // Write new spec (design §5.1): kind inferred from what the row knows.
    const realSku = !!p.sku && !isPlaceholderSku(p.sku);
    const colon = p.sku.indexOf(":");
    const partNumber = p.mfrNumber || part?.manufacturerPartNumber || (realSku ? (colon >= 0 ? p.sku.slice(colon + 1) : p.sku) : "");
    const kind: SpecKind = part ? "product_catalog" : partNumber ? "product_vendor" : "system";
    const otherSectionNumber = leftOut?.sectionNumber ?? null;
    return {
      // Row identity (spec records design §3.1) computed here, server-side,
      // from the STORED product — a sku-less row's mfrNumber/specKey/specId/
      // fromLibrary never reach the client any other way, and re-deriving
      // this on the client from the display-only fields below would collapse
      // every such row to the same `DESC:` key (#205 fix round).
      rowKey,
      sku: part?.sku || p.sku,
      // A sku-less row (allowance/vendor/curtain) has no catalog part to read
      // a description from — fall back to the quote's own stored desc.
      desc: part?.desc || p.desc || "",
      ...(p.qty != null ? { qty: p.qty } : {}),
      placedArticleId,
      leftOutReason: leftOut?.reason ?? null,
      otherSectionNumber,
      otherSectionId: otherSectionNumber ? sections.find((x) => csiKey(x.number) === csiKey(otherSectionNumber))?.id ?? null : null,
      match: match ?? null,
      fromLibrary: !!p.fromLibrary,
      writeDefaults: {
        kind,
        title: part?.desc || p.desc || "",
        partNumber,
        manufacturer: p.manufacturer || part?.mfr || "",
        matchKey: p.specKey || p.desc || "",
        // A catalog part's own (draft) legacy text seeds Write new spec.
        specText: part?.specBody || "",
      },
      waivedReason: match?.status === "waived" ? match.reason : null,
      recordTitle: record?.title ?? null,
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

  // Only the records this spec refers to reach the client (rows' matches,
  // candidates and drafts, overrides, the last download's stamp, what prints
  // now) — never the whole library.
  const referenced = new Set<string>([
    ...Object.keys(doc.overrides),
    ...Object.keys(doc.usedRecords),
    ...Object.keys(assembled?.usedRecords || {}),
  ]);
  for (const m of Object.values(assembled?.rowMatches || {})) {
    if (m.status === "matched" || m.status === "draft") referenced.add(m.specId);
    else if (m.status === "ambiguous") m.specIds.forEach((x) => referenced.add(x));
    else if (m.status === "no-match") m.candidates.forEach((x) => referenced.add(x));
  }
  const recordsById: Record<string, SlimSpecRecord> = {};
  for (const id of referenced) {
    const r = recordById.get(id);
    if (r) recordsById[id] = { specId: r.specId, title: r.title, kind: r.kind, status: r.status, revision: r.revision, matchKey: r.matchKey, section: r.section, product: recordProductName(r), models: partNumbersSummary(r.mfrNumbers, 3) };
  }
  // Library text of each matched record — the Edit panel starts from it (or
  // from the project override the client already has on `doc`).
  const recordTexts: Record<string, { title: string; specText: string }> = {};
  for (const m of Object.values(assembled?.rowMatches || {})) {
    if (m.status !== "matched") continue;
    const r = recordById.get(m.specId);
    if (r) recordTexts[r.specId] = { title: r.title, specText: r.specText };
  }
  const systemMatchKeys = systemMatchKeysOf(records);

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
      recordsById={recordsById}
      recordTexts={recordTexts}
      systemMatchKeys={systemMatchKeys}
    />
  );
}
