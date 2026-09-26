"use server";

import { revalidatePath } from "next/cache";
import { requirePerm, requireUser, type SessionUser } from "@/lib/session";
import { isoDateOf } from "@/lib/catalog-books";
import { getManyAnyCase } from "@/lib/stores/catalog";
import { getCompany } from "@/lib/identity/companies";
import { allArticles } from "@/lib/stores/spec-articles";
import { getSection } from "@/lib/stores/spec-sections";
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
  isValidIsoDate,
  DEFAULT_SPEC_PHASE,
  SPEC_FILL_IN_MAX,
  SPEC_HEADER_MAX,
  SPEC_REORDER_MAX,
  type SpecDocHeader,
  type SpecDocSource,
} from "@/lib/specs/spec-document";
import { articleInSection } from "@/lib/specs/assemble-section";
import { fillInLabelKey, fillInSlots } from "@/lib/specs/fill-ins";
import { searchSpecParts, type SpecPickerPart } from "@/lib/specs/picker";
import { bomFromQuote } from "@/lib/specs/quote-bom";

export type { SpecPickerPart };

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
 *  a spec should never carry a dangling customerId. Only the name is
 *  needed, so it reads the one company row, not the full customer record
 *  (sites, contacts, emails…) — final fix 13. */
async function resolveSpecCustomer(
  customerId: string | null | undefined
): Promise<{ ok: true; customerId: string; customer: string } | { ok: false; error: string }> {
  const cid = String(customerId || "").trim();
  if (!cid) return { ok: true, customerId: "", customer: "" };
  const co = await getCompany(cid);
  if (!co) return { ok: false, error: "Customer not found." };
  return { ok: true, customerId: cid, customer: co.name || "" };
}

/** Header text over the cap is refused, not silently cut (final fix 16). */
function headerTooLong(values: Array<string | undefined>): { ok: false; error: string } | null {
  return values.some((v) => (v || "").length > SPEC_HEADER_MAX)
    ? { ok: false, error: `Keep header fields under ${SPEC_HEADER_MAX} characters.` }
    : null;
}

export async function createSpecDocumentAction(input: {
  sectionId: string;
  customerId?: string;
  projectName?: string;
  projectNumber?: string;
  /** The browser's local date (YYYY-MM-DD) — the default issue date is the
   *  creator's today, not the server's UTC today (final fix 9). */
  issueDate?: string;
  source?: { kind: "quote"; quoteId: string } | { kind: "grid"; gridProjectId: string; quoteId: string };
}): Promise<Result<{ id: string }> | { ok: false; error: string; sourceFailed: true }> {
  const user = await requirePerm("create");
  const projectName = String(input.projectName || "").trim();
  const projectNumber = String(input.projectNumber || "").trim();
  const tooLong = headerTooLong([projectName, projectNumber]);
  if (tooLong) return tooLong;
  const sectionId = String(input.sectionId || "").trim();
  const section = sectionId ? await getSection(sectionId) : null;
  if (!section) return { ok: false, error: "Pick a section from the library." };

  let source: SpecDocSource = { kind: "scratch" };
  let products: SpecDocument["products"] = [];
  if (input.source?.kind === "quote") {
    const r = await bomFromQuote(input.source.quoteId);
    if (!r.ok) return { ...r, sourceFailed: true };
    products = bomProducts(r.rows);
    source = { kind: "quote", id: input.source.quoteId, label: r.label, quoteId: input.source.quoteId };
  } else if (input.source?.kind === "grid") {
    const r = await bomFromQuote(input.source.quoteId);
    if (!r.ok) return { ...r, sourceFailed: true };
    products = bomProducts(r.rows);
    source = { kind: "grid", id: input.source.gridProjectId, label: r.label, quoteId: input.source.quoteId };
  }

  const cust = await resolveSpecCustomer(input.customerId);
  if (!cust.ok) return cust;

  const doc = await createSpecDocument({
    sectionId,
    header: {
      projectName,
      projectNumber,
      phase: DEFAULT_SPEC_PHASE,
      issueDate: isValidIsoDate(input.issueDate) ? input.issueDate : isoDateOf(Date.now()),
      preparedBy: user.name,
    },
    customerId: cust.customerId,
    customer: cust.customer,
    source,
    products,
    printQuantities: false,
    fillIns: {},
    fillInLabels: {},
    createdBy: user.name,
    updatedBy: user.name,
  });
  revalidatePath("/design/specs");
  return { ok: true, id: doc.id };
}

export async function updateSpecHeaderAction(id: string, patch: Partial<SpecDocHeader>): Promise<Result> {
  const user = await requirePerm("create");
  const clean = pickSpecHeaderPatch(patch);
  const tooLong = headerTooLong(Object.values(clean));
  if (tooLong) return tooLong;
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

/**
 * Answer (or clear) one [FILL IN: …] blank. Setting a value needs a key that
 * is a live blank of the spec's section; the blank's label is looked up here
 * on the server — never taken from the client — and stored beside the
 * answer, so a later library edit that moves a different blank to this
 * position shows the answer as stale instead of printing it in the wrong
 * place (final fix 4/16). Clearing works on any key, stale ones included.
 */
export async function setSpecFillInAction(id: string, key: string, value: string): Promise<Result> {
  const user = await requirePerm("create");
  const k = String(key || "").trim();
  if (!k) return { ok: false, error: "A fill-in key is required." };
  const v = String(value ?? "").trim();
  if (v.length > SPEC_FILL_IN_MAX) return { ok: false, error: `Keep a fill-in under ${SPEC_FILL_IN_MAX} characters.` };
  let label = "";
  if (v) {
    const doc = await getSpecDocument(id);
    if (!doc) return { ok: false, error: "Spec not found." };
    const section = await getSection(doc.sectionId);
    const slot = section ? fillInSlots(section).find((s) => s.key === k) : undefined;
    if (!slot) return { ok: false, error: "That blank is no longer in this section's text." };
    label = fillInLabelKey(slot.label);
  }
  return applyPatch(id, user, (d) => {
    const fillIns = { ...d.fillIns };
    const fillInLabels = { ...d.fillInLabels };
    if (v) {
      fillIns[k] = v;
      fillInLabels[k] = label;
    } else {
      delete fillIns[k];
      delete fillInLabels[k];
    }
    return { ...d, fillIns, fillInLabels };
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
  const list = Array.isArray(skus) ? skus.map((s) => String(s ?? "")) : [];
  if (list.length > SPEC_REORDER_MAX) return { ok: false, error: `A spec can't reorder more than ${SPEC_REORDER_MAX} products at once.` };
  return applyPatch(id, user, (d) => withProductOrder(d, list));
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

/** Search the catalog for products to add to a spec — the rules and the
 *  SQL pre-filter live in `searchSpecParts` (src/lib/specs/picker.ts). */
export async function searchSpecPartsAction(
  id: string,
  q: string,
  showAll: boolean
): Promise<Result<{ parts: SpecPickerPart[] }>> {
  await requireUser();
  const doc = await getSpecDocument(id);
  if (!doc) return { ok: false, error: "Spec not found." };
  return { ok: true, parts: await searchSpecParts(doc, String(q || "").slice(0, SPEC_HEADER_MAX), !!showAll) };
}
