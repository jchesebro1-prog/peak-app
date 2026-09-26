"use server";

import { revalidatePath } from "next/cache";
import { requirePerm, requireUser, type SessionUser } from "@/lib/session";
import { isoDateOf } from "@/lib/catalog-books";
import { get as getCatalogPart, list as listCatalog } from "@/lib/stores/catalog";
import { nameFor as customerNameFor } from "@/lib/stores/customers";
import { allArticles } from "@/lib/stores/spec-articles";
import { allSections, getSection } from "@/lib/stores/spec-sections";
import {
  createSpecDocument,
  getSpecDocument,
  patchSpecDocument,
  removeSpecDocument,
  type SpecDocument,
} from "@/lib/stores/spec-documents";
import {
  bomProducts,
  withProduct,
  withoutProduct,
  withProductHeader,
  withProductOrder,
  DEFAULT_SPEC_PHASE,
  type SpecDocHeader,
  type SpecDocSource,
} from "@/lib/specs/spec-document";
import { specStateOf, type SpecPartLike } from "@/lib/specs/articles";
import { articleIdMapForParts } from "@/app/(app)/design/specs/coverage";
import { bomFromQuote } from "@/lib/specs/quote-bom";

/**
 * Server actions for the spec builder (#205 Phase B, T4). Names are
 * builder-specific to avoid colliding with the library's `design/specs/actions.ts`
 * and D94's `design/engagements/spec/actions.ts`.
 */

type Result<T = unknown> = ({ ok: true } & T) | { ok: false; error: string };

function revalidateBuilder(id: string) {
  revalidatePath("/design/specs");
  revalidatePath(`/design/specs/${id}`);
}

/** Shared tail of every mutation: patch, "not found", revalidate. */
async function applyPatch(id: string, user: SessionUser, mutate: (d: SpecDocument) => SpecDocument): Promise<Result> {
  const patched = await patchSpecDocument(id, mutate, user.name);
  if (!patched) return { ok: false, error: "Spec not found." };
  revalidateBuilder(id);
  return { ok: true };
}

export async function createSpecDocumentAction(input: {
  sectionId: string;
  customerId?: string;
  projectName?: string;
  projectNumber?: string;
  source?: { kind: "quote"; quoteId: string } | { kind: "grid"; gridProjectId: string; quoteId: string };
}): Promise<Result<{ id: string }>> {
  const user = await requirePerm("create");
  const sectionId = String(input.sectionId || "").trim();
  const section = sectionId ? await getSection(sectionId) : null;
  if (!section) return { ok: false, error: "Pick a section from the library." };

  let source: SpecDocSource = { kind: "scratch" };
  let products: SpecDocument["products"] = [];
  if (input.source?.kind === "quote") {
    const r = await bomFromQuote(input.source.quoteId);
    if (!r.ok) return r;
    products = bomProducts(r.rows);
    source = { kind: "quote", id: input.source.quoteId, label: r.label, quoteId: input.source.quoteId };
  } else if (input.source?.kind === "grid") {
    const r = await bomFromQuote(input.source.quoteId);
    if (!r.ok) return r;
    products = bomProducts(r.rows);
    source = { kind: "grid", id: input.source.gridProjectId, label: r.label, quoteId: input.source.quoteId };
  }

  const customerId = String(input.customerId || "").trim();
  const customer = customerId ? await customerNameFor(customerId) : "";

  const doc = await createSpecDocument({
    sectionId,
    header: {
      projectName: String(input.projectName || "").trim(),
      projectNumber: String(input.projectNumber || "").trim(),
      phase: DEFAULT_SPEC_PHASE,
      issueDate: isoDateOf(Date.now()),
      preparedBy: user.name,
    },
    customerId,
    customer,
    source,
    products,
    printQuantities: false,
    fillIns: {},
    createdBy: user.name,
    updatedBy: user.name,
  });
  revalidatePath("/design/specs");
  return { ok: true, id: doc.id };
}

export async function updateSpecHeaderAction(id: string, patch: Partial<SpecDocHeader>): Promise<Result> {
  const user = await requirePerm("create");
  return applyPatch(id, user, (d) => ({ ...d, header: { ...d.header, ...patch } }));
}

export async function setSpecCustomerAction(id: string, customerId: string | null): Promise<Result> {
  const user = await requirePerm("create");
  const cid = String(customerId || "").trim();
  const customer = cid ? await customerNameFor(cid) : "";
  return applyPatch(id, user, (d) => {
    const { customerId: _c, customer: _n, ...rest } = d;
    void _c;
    void _n;
    return cid ? { ...rest, customerId: cid, customer } : rest;
  });
}

export async function setSpecFillInAction(id: string, key: string, value: string): Promise<Result> {
  const user = await requirePerm("create");
  const k = String(key || "").trim();
  if (!k) return { ok: false, error: "A fill-in key is required." };
  const v = String(value ?? "").trim();
  return applyPatch(id, user, (d) => {
    const fillIns = { ...d.fillIns };
    if (v) fillIns[k] = v;
    else delete fillIns[k];
    return { ...d, fillIns };
  });
}

export async function addSpecProductAction(id: string, sku: string, articleId?: string): Promise<Result> {
  const user = await requirePerm("create");
  const s = String(sku || "").trim();
  const part = s ? await getCatalogPart(s) : null;
  if (!part) return { ok: false, error: `Part ${s || sku} not found.` };
  const doc = await getSpecDocument(id);
  if (!doc) return { ok: false, error: "Spec not found." };
  const trimmedArticleId = String(articleId || "").trim();
  let aid: string | undefined;
  if (trimmedArticleId) {
    const articles = await allArticles();
    const art = articles.find((a) => a.id === trimmedArticleId);
    if (!art || art.sectionId !== doc.sectionId) {
      return { ok: false, error: "That article is not in this spec's section." };
    }
    aid = trimmedArticleId;
  }
  return applyPatch(id, user, (d) => withProduct(d, { sku: part.sku, ...(aid ? { articleId: aid } : {}) }));
}

export async function removeSpecProductAction(id: string, sku: string): Promise<Result> {
  const user = await requirePerm("create");
  return applyPatch(id, user, (d) => withoutProduct(d, sku));
}

export async function reorderSpecProductsAction(id: string, skus: string[]): Promise<Result> {
  const user = await requirePerm("create");
  return applyPatch(id, user, (d) => withProductOrder(d, Array.isArray(skus) ? skus : []));
}

export async function setSpecProductHeaderAction(id: string, sku: string, articleId: string | null): Promise<Result> {
  const user = await requirePerm("create");
  return applyPatch(id, user, (d) => withProductHeader(d, sku, articleId));
}

export async function setSpecPrintQuantitiesAction(id: string, on: boolean): Promise<Result> {
  const user = await requirePerm("create");
  return applyPatch(id, user, (d) => ({ ...d, printQuantities: !!on }));
}

export async function deleteSpecDocumentAction(id: string): Promise<Result> {
  await requirePerm("create");
  const doc = await getSpecDocument(id);
  if (!doc) return { ok: false, error: "Spec not found." };
  await removeSpecDocument(id);
  revalidateBuilder(id);
  return { ok: true };
}

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
};

/** Search the catalog for products to add to a spec. Default: parts with an
 *  approved spec that resolve into THIS section; `showAll` widens to the
 *  whole catalog. Article resolution and same-as state are computed once
 *  per call over shared maps, never re-sorted per part (design §1 item 3). */
export async function searchSpecPartsAction(
  id: string,
  q: string,
  showAll: boolean
): Promise<Result<{ parts: SpecPickerPart[] }>> {
  await requireUser();
  const doc = await getSpecDocument(id);
  if (!doc) return { ok: false, error: "Spec not found." };

  const [parts, articles, sections] = await Promise.all([listCatalog(), allArticles(), allSections()]);
  const articleById = new Map(articles.map((a) => [a.id, a]));
  const articleIdBySku = articleIdMapForParts(parts, articles, sections);
  const bySku = new Map<string, SpecPartLike>(parts.map((p) => [p.sku, p]));
  const onDoc = new Set(doc.products.map((p) => p.sku.toUpperCase()));
  const query = String(q || "").trim().toLowerCase();

  const out: SpecPickerPart[] = [];
  for (const part of parts) {
    if (onDoc.has(part.sku.toUpperCase())) continue;
    const articleId = articleIdBySku.get(part.sku) ?? null;
    const inSection = !!articleId && articleById.get(articleId)?.sectionId === doc.sectionId;
    const state = specStateOf(part, bySku);
    const hasSpec = state === "authored" || state === "same-as";
    if (!showAll && !(hasSpec && inSection)) continue;
    if (query) {
      const hay = `${part.sku} ${part.desc || ""} ${part.mfr || ""}`.toLowerCase();
      if (!hay.includes(query)) continue;
    }
    out.push({
      sku: part.sku,
      desc: part.desc || "",
      mfr: part.mfr || "",
      articleId,
      articleTitle: articleId ? articleById.get(articleId)?.title || "" : "",
      inSection,
      hasSpec,
      specArticleId: part.specArticleId || null,
    });
  }
  out.sort((a, b) => (a.inSection === b.inSection ? a.sku.localeCompare(b.sku) : a.inSection ? -1 : 1));
  return { ok: true, parts: out.slice(0, 60) };
}
