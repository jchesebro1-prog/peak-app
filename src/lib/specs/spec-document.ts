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
  createdAt: number;
  createdBy: string;
  updatedAt: number;
  updatedBy: string;
};

export const DEFAULT_SPEC_PHASE = "Construction Documents";
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
  const fillIns: Record<string, string> = {};
  if (o.fillIns && typeof o.fillIns === "object") {
    for (const [k, v] of Object.entries(o.fillIns as Record<string, unknown>)) if (typeof v === "string") fillIns[k] = v;
  }
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
    createdAt: Number(o.createdAt) || 0,
    createdBy: str(o.createdBy),
    updatedAt: Number(o.updatedAt) || 0,
    updatedBy: str(o.updatedBy),
  };
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
