/**
 * Spec builder document (#205 Phase B) — pure, so the builder (a client
 * component) and the server actions share one normalize and one set of
 * product-list edits. Parts 1/3 are NOT stored here: they are read live from
 * the library at preview/download time (design §2).
 */

export type SpecSourceKind = "scratch" | "quote" | "grid";
export type SpecDocHeader = { projectName: string; projectNumber: string; phase: string; issueDate: string; preparedBy: string };
export type SpecDocProduct = { sku: string; qty?: number; articleId?: string };
export type SpecDocSource = { kind: SpecSourceKind; id?: string; label?: string; quoteId?: string };
export type SpecDocument = {
  id: string;
  sectionId: string;
  header: SpecDocHeader;
  customerId?: string;
  customer?: string;
  source: SpecDocSource;
  products: SpecDocProduct[];
  printQuantities: boolean;
  /** Answers keyed `${articleId}#${n}` — the n-th [FILL IN: …] in that article (src/lib/specs/fill-ins.ts). */
  fillIns: Record<string, string>;
  /** The label of the blank each answer was written for, same keys as
   *  `fillIns`, normalized (fillInLabelKey). An answer whose label no longer
   *  matches the blank at its key is stale. Absent for answers saved before
   *  labels were kept — those apply by position, as before. */
  fillInLabels: Record<string, string>;
  createdAt: number;
  createdBy: string;
  updatedAt: number;
  updatedBy: string;
};

export const DEFAULT_SPEC_PHASE = "Construction Documents";
/** Input caps the builder's server actions enforce (#205 spec builder final fix 16). */
export const SPEC_HEADER_MAX = 200;
export const SPEC_FILL_IN_MAX = 500;
export const SPEC_REORDER_MAX = 500;

/** A real calendar date in YYYY-MM-DD form (rejects 2026-02-30). */
export function isValidIsoDate(v: unknown): v is string {
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
}
const KINDS: readonly SpecSourceKind[] = ["scratch", "quote", "grid"];

const str = (v: unknown) => (typeof v === "string" ? v : v == null ? "" : String(v)).trim();
const same = (a: string, b: string) => a.toUpperCase() === b.toUpperCase();

function product(v: unknown): SpecDocProduct | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  const sku = str(o.sku);
  if (!sku) return null;
  const qty = Number(o.qty);
  const articleId = str(o.articleId);
  return { sku, ...(Number.isFinite(qty) && o.qty !== "" && o.qty != null ? { qty } : {}), ...(articleId ? { articleId } : {}) };
}

export function normalizeSpecDocument(raw: unknown): SpecDocument {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const h = (o.header && typeof o.header === "object" ? o.header : {}) as Record<string, unknown>;
  const s = (o.source && typeof o.source === "object" ? o.source : {}) as Record<string, unknown>;
  const kind = KINDS.includes(s.kind as SpecSourceKind) ? (s.kind as SpecSourceKind) : "scratch";
  const products: SpecDocProduct[] = [];
  for (const p of Array.isArray(o.products) ? o.products : []) {
    const n = product(p);
    if (n && !products.some((x) => same(x.sku, n.sku))) products.push(n);
  }
  const stringMap = (v: unknown): Record<string, string> => {
    const out: Record<string, string> = {};
    if (v && typeof v === "object" && !Array.isArray(v)) {
      for (const [k, x] of Object.entries(v as Record<string, unknown>)) if (typeof x === "string") out[k] = x;
    }
    return out;
  };
  const fillIns = stringMap(o.fillIns);
  // A label only means something beside an answer.
  const fillInLabels = Object.fromEntries(Object.entries(stringMap(o.fillInLabels)).filter(([k]) => k in fillIns));
  return {
    id: str(o.id),
    sectionId: str(o.sectionId),
    header: {
      projectName: str(h.projectName),
      projectNumber: str(h.projectNumber),
      phase: str(h.phase) || DEFAULT_SPEC_PHASE,
      issueDate: /^\d{4}-\d{2}-\d{2}$/.test(str(h.issueDate)) ? str(h.issueDate) : "",
      preparedBy: str(h.preparedBy),
    },
    ...(str(o.customerId) ? { customerId: str(o.customerId) } : {}),
    ...(str(o.customer) ? { customer: str(o.customer) } : {}),
    source: {
      kind,
      ...(str(s.id) ? { id: str(s.id) } : {}),
      ...(str(s.label) ? { label: str(s.label) } : {}),
      ...(str(s.quoteId) ? { quoteId: str(s.quoteId) } : {}),
    },
    products,
    printQuantities: o.printQuantities === true,
    fillIns,
    fillInLabels,
    createdAt: Number(o.createdAt) || 0,
    createdBy: str(o.createdBy),
    updatedAt: Number(o.updatedAt) || 0,
    updatedBy: str(o.updatedBy),
  };
}

const SPEC_HEADER_KEYS: readonly (keyof SpecDocHeader)[] = [
  "projectName",
  "projectNumber",
  "phase",
  "issueDate",
  "preparedBy",
];

/** Whitelist + trim a header patch to just `SpecDocHeader`'s five keys —
 *  `updateSpecHeaderAction` guards against a client sending arbitrary extra
 *  fields into the stored header this way (#205 spec builder T4 fix wave
 *  item 2). A key absent from `patch` is left untouched by the caller; a key
 *  present (even "") is copied, trimmed. */
export function pickSpecHeaderPatch(patch: Record<string, unknown> | null | undefined): Partial<SpecDocHeader> {
  const src = patch ?? {};
  const out: Partial<SpecDocHeader> = {};
  for (const k of SPEC_HEADER_KEYS) {
    if (src[k] !== undefined) out[k] = str(src[k]);
  }
  return out;
}

export function withProduct(doc: SpecDocument, p: SpecDocProduct): SpecDocument {
  const n = product(p);
  if (!n || doc.products.some((x) => same(x.sku, n.sku))) return doc;
  return { ...doc, products: [...doc.products, n] };
}

export function withoutProduct(doc: SpecDocument, sku: string): SpecDocument {
  return { ...doc, products: doc.products.filter((p) => !same(p.sku, sku)) };
}

export function withProductOrder(doc: SpecDocument, skus: string[]): SpecDocument {
  const first: SpecDocProduct[] = [];
  for (const s of skus) {
    const hit = doc.products.find((p) => same(p.sku, s));
    if (hit && !first.includes(hit)) first.push(hit);
  }
  return { ...doc, products: [...first, ...doc.products.filter((p) => !first.includes(p))] };
}

export function withProductHeader(doc: SpecDocument, sku: string, articleId: string | null): SpecDocument {
  return {
    ...doc,
    products: doc.products.map((p) => {
      if (!same(p.sku, sku)) return p;
      const { articleId: _drop, ...rest } = p;
      void _drop;
      return articleId ? { ...rest, articleId } : rest;
    }),
  };
}

export function bomProducts(rows: Array<{ sku: string; qty: number }>): SpecDocProduct[] {
  const out: SpecDocProduct[] = [];
  for (const r of rows) {
    const sku = str(r.sku);
    if (!sku) continue;
    const qty = Number(r.qty) || 0;
    const hit = out.find((p) => same(p.sku, sku));
    if (hit) hit.qty = (hit.qty || 0) + qty;
    else out.push({ sku, qty });
  }
  return out;
}
