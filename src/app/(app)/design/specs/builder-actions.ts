"use server";

import { revalidatePath } from "next/cache";
import { requirePerm, requireUser, type SessionUser } from "@/lib/session";
import { isoDateOf } from "@/lib/catalog-books";
import { getManyAnyCase, list as listCatalog } from "@/lib/stores/catalog";
import { get as getCustomer } from "@/lib/stores/customers";
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
  pickSpecHeaderPatch,
  withProduct,
  withoutProduct,
  withProductHeader,
  withProductOrder,
  DEFAULT_SPEC_PHASE,
  type SpecDocHeader,
  type SpecDocSource,
} from "@/lib/specs/spec-document";
import { articleInSection } from "@/lib/specs/assemble-section";
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

const ARTICLE_NOT_IN_SECTION = "That article is not in this spec's section.";

/** The one place addSpecProductAction and setSpecProductHeaderAction check
 *  a header override against the spec's own section (#205 spec builder T4
 *  fix wave item 1) — fetches the live articles, then defers to the pure
 *  `articleInSection` (src/lib/specs/assemble-section.ts), the same
 *  predicate `placeProduct` uses at assembly time. */
async function checkArticleInSection(articleId: string, sectionId: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const articles = await allArticles();
  return articleInSection(articleId, sectionId, articles) ? { ok: true } : { ok: false, error: ARTICLE_NOT_IN_SECTION };
}

/** Look up a customer by id — "" (no customer) resolves to "", but an id
 *  that fails to resolve is an error (#205 spec builder T4 fix wave item 4):
 *  a spec should never carry a dangling customerId. */
async function resolveSpecCustomer(
  customerId: string | null | undefined
): Promise<{ ok: true; customerId: string; customer: string } | { ok: false; error: string }> {
  const cid = String(customerId || "").trim();
  if (!cid) return { ok: true, customerId: "", customer: "" };
  const co = await getCustomer(cid);
  if (!co) return { ok: false, error: "Customer not found." };
  return { ok: true, customerId: cid, customer: co.name };
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

  const cust = await resolveSpecCustomer(input.customerId);
  if (!cust.ok) return cust;

  const doc = await createSpecDocument({
    sectionId,
    header: {
      projectName: String(input.projectName || "").trim(),
      projectNumber: String(input.projectNumber || "").trim(),
      phase: DEFAULT_SPEC_PHASE,
      issueDate: isoDateOf(Date.now()),
      preparedBy: user.name,
    },
    customerId: cust.customerId,
    customer: cust.customer,
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
  const clean = pickSpecHeaderPatch(patch);
  return applyPatch(id, user, (d) => ({ ...d, header: { ...d.header, ...clean } }));
}

export async function setSpecCustomerAction(id: string, customerId: string | null): Promise<Result> {
  const user = await requirePerm("create");
  const cust = await resolveSpecCustomer(customerId);
  if (!cust.ok) return cust;
  const { customerId: cid, customer } = cust;
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
  const [part] = s ? await getManyAnyCase([s]) : [];
  if (!part) return { ok: false, error: `Part ${s || sku} not found.` };
  const doc = await getSpecDocument(id);
  if (!doc) return { ok: false, error: "Spec not found." };
  if (doc.products.some((p) => p.sku.toUpperCase() === part.sku.toUpperCase())) {
    return { ok: false, error: "Already on this spec." };
  }
  const trimmedArticleId = String(articleId || "").trim();
  let aid: string | undefined;
  if (trimmedArticleId) {
    const check = await checkArticleInSection(trimmedArticleId, doc.sectionId);
    if (!check.ok) return check;
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
  const aid = String(articleId || "").trim();
  if (aid) {
    const doc = await getSpecDocument(id);
    if (!doc) return { ok: false, error: "Spec not found." };
    const check = await checkArticleInSection(aid, doc.sectionId);
    if (!check.ok) return check;
  }
  return applyPatch(id, user, (d) => withProductHeader(d, sku, aid || null));
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
  /** The part's stored text (a draft, when !hasSpec) — the builder's Write
   *  spec box starts from it, and writes specSort back unchanged
   *  (writePartSpecFieldsAction clears whatever it isn't given). T5. */
  specTitle: string;
  specBody: string;
  specSort: number | null;
  /** The part's "same spec as" pointer, if any — Write spec replaces it. */
  specSameAs: string;
};

/** Search the catalog for products to add to a spec. Default: parts with an
 *  approved spec that resolve into THIS section; `showAll` widens to the
 *  whole catalog.
 *
 *  Order (#205 spec builder T4 fix wave item 5): text filter → on-spec
 *  exclusion → article/spec-state resolution → in-section/hasSpec filter
 *  (default mode only) → sort → cap 60. The cheap passes (substring match,
 *  exclusion) run first over the whole catalog and narrow it BEFORE the
 *  more expensive per-part resolution and the final sort ever touch it —
 *  typing a query never resolves the rest of the catalog, and the sort
 *  never runs over more than the already-filtered candidates. */
export async function searchSpecPartsAction(
  id: string,
  q: string,
  showAll: boolean
): Promise<Result<{ parts: SpecPickerPart[] }>> {
  await requireUser();
  const doc = await getSpecDocument(id);
  if (!doc) return { ok: false, error: "Spec not found." };

  const query = String(q || "").trim().toLowerCase();
  const onDoc = new Set(doc.products.map((p) => p.sku.toUpperCase()));

  const [allParts, articles, sections] = await Promise.all([listCatalog(), allArticles(), allSections()]);
  const candidates = allParts.filter((part) => {
    if (onDoc.has(part.sku.toUpperCase())) return false;
    if (!query) return true;
    const hay = `${part.sku} ${part.desc || ""} ${part.mfr || ""}`.toLowerCase();
    return hay.includes(query);
  });

  // Same-as resolution needs the WHOLE catalog (a candidate's target may not
  // itself be a candidate); article resolution only needs the candidates —
  // articleIdMapForParts still caches its (sort,title) copy of `articles` by
  // array identity, so it's one sort regardless of how many parts pass in.
  const articleById = new Map(articles.map((a) => [a.id, a]));
  const articleIdByCandidateSku = articleIdMapForParts(candidates, articles, sections);
  const bySku = new Map<string, SpecPartLike>(allParts.map((p) => [p.sku, p]));

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
  return { ok: true, parts: out.slice(0, 60) };
}
