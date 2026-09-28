/**
 * Spec builder document (#205 Phase B) — pure, so the builder (a client
 * component) and the server actions share one normalize and one set of
 * product-list edits. Parts 1/3 are NOT stored here: they are read live from
 * the library at preview/download time (design §2).
 */

import { specRowKey } from "@/lib/specs/record-keys";

export type SpecSourceKind = "scratch" | "quote" | "grid";
export type SpecDocHeader = { projectName: string; projectNumber: string; phase: string; issueDate: string; preparedBy: string };
/** A product/BOM row on the spec (spec records design §3.1). `sku` may be
 *  empty for a row that only ever carried a manufacturer part number, a
 *  system match key, or a bare description — `mfrNumber`/`manufacturer`/
 *  `specKey`/`desc`/`specId` are what `specRowKey` and `record-match.ts`
 *  identify and match it by. `fromLibrary` marks a row added straight from
 *  the Spec Library (Add from Spec Library, §5.3) rather than from a BOM.
 *  `waived` (§5.1) prints under ITEMS NOT SPECIFIED instead of matching. */
export type SpecDocProduct = {
  sku: string;
  qty?: number;
  articleId?: string;
  mfrNumber?: string;
  manufacturer?: string;
  specKey?: string;
  desc?: string;
  specId?: string;
  fromLibrary?: true;
  waived?: { reason: string };
};
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
  /** Project-only edits of a library record (spec records design §5.2),
   *  keyed by specId. `baseRevision` is the record revision the edit was
   *  made against — a newer library revision flags it stale. */
  overrides: Record<string, SpecOverride>;
  /** `{ specId: revision }` of every record the last Word download printed
   *  (§5.3) — "library changed since your last download". */
  usedRecords: Record<string, number>;
  /** When the last Word download happened (epoch ms). */
  downloadedAt?: number;
  createdAt: number;
  createdBy: string;
  updatedAt: number;
  updatedBy: string;
};

export type SpecOverride = { title: string; specText: string; baseRevision: number };

export const DEFAULT_SPEC_PHASE = "Construction Documents";
/** Input caps the builder's server actions enforce (#205 spec builder final fix 16). */
export const SPEC_HEADER_MAX = 200;
export const SPEC_FILL_IN_MAX = 500;
export const SPEC_REORDER_MAX = 500;
/** Project-only override caps (spec records design §5.2). */
export const SPEC_OVERRIDE_TITLE_MAX = 300;
export const SPEC_OVERRIDE_TEXT_MAX = 20000;
export const SPEC_OVERRIDES_MAX = 200;

/** A real calendar date in YYYY-MM-DD form (rejects 2026-02-30). */
export function isValidIsoDate(v: unknown): v is string {
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
}
const KINDS: readonly SpecSourceKind[] = ["scratch", "quote", "grid"];

const str = (v: unknown) => (typeof v === "string" ? v : v == null ? "" : String(v)).trim();
/** Strings capped at 200, a waive reason at 500 (spec records design §3.1). */
const capStr = (v: string, max: number) => (v.length > max ? v.slice(0, max) : v);

/** Accepts a row with no `sku` as long as it carries a `mfrNumber`,
 *  `specKey`, `desc`, or `specId` — that's the whole point of #205's
 *  sku-less allowance/vendor/system rows (design §3.1). Returns null only
 *  when the row would carry NONE of those, i.e. it identifies nothing. */
function product(v: unknown): SpecDocProduct | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  const sku = str(o.sku);
  const mfrNumber = capStr(str(o.mfrNumber), SPEC_HEADER_MAX);
  const manufacturer = capStr(str(o.manufacturer), SPEC_HEADER_MAX);
  const specKey = capStr(str(o.specKey), SPEC_HEADER_MAX);
  const desc = capStr(str(o.desc), SPEC_HEADER_MAX);
  const specId = capStr(str(o.specId), SPEC_HEADER_MAX);
  if (!sku && !mfrNumber && !specKey && !desc && !specId) return null;
  const qty = Number(o.qty);
  const articleId = str(o.articleId);
  const w = o.waived && typeof o.waived === "object" ? (o.waived as Record<string, unknown>) : null;
  const waivedReason = w ? capStr(str(w.reason), SPEC_FILL_IN_MAX) : "";
  return {
    sku,
    ...(Number.isFinite(qty) && o.qty !== "" && o.qty != null ? { qty } : {}),
    ...(articleId ? { articleId } : {}),
    ...(mfrNumber ? { mfrNumber } : {}),
    ...(manufacturer ? { manufacturer } : {}),
    ...(specKey ? { specKey } : {}),
    ...(desc ? { desc } : {}),
    ...(specId ? { specId } : {}),
    ...(o.fromLibrary === true ? { fromLibrary: true as const } : {}),
    ...(waivedReason ? { waived: { reason: waivedReason } } : {}),
  };
}

/** One override, capped. The text keeps its leading indentation (outline
 *  depth is 2 spaces per level) — only trailing whitespace is dropped. */
function override(v: unknown): SpecOverride | null {
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  const o = v as Record<string, unknown>;
  const title = capStr(str(o.title), SPEC_OVERRIDE_TITLE_MAX);
  const text = typeof o.specText === "string" ? o.specText.replace(/\s+$/, "") : "";
  const specText = capStr(text, SPEC_OVERRIDE_TEXT_MAX);
  if (!title && !specText.trim()) return null;
  const rev = Math.floor(Number(o.baseRevision));
  return { title, specText, baseRevision: Number.isFinite(rev) && rev >= 0 ? rev : 0 };
}

function overridesMap(v: unknown): Record<string, SpecOverride> {
  const out: Record<string, SpecOverride> = {};
  if (!v || typeof v !== "object" || Array.isArray(v)) return out;
  let n = 0;
  for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
    if (n >= SPEC_OVERRIDES_MAX) break;
    const id = capStr(k.trim(), SPEC_HEADER_MAX);
    const ov = override(x);
    if (!id || !ov) continue;
    out[id] = ov;
    n++;
  }
  return out;
}

function revisionMap(v: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  if (!v || typeof v !== "object" || Array.isArray(v)) return out;
  for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
    const id = capStr(k.trim(), SPEC_HEADER_MAX);
    const rev = Number(x);
    if (id && Number.isInteger(rev) && rev >= 1) out[id] = rev;
  }
  return out;
}

export function normalizeSpecDocument(raw: unknown): SpecDocument {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const h = (o.header && typeof o.header === "object" ? o.header : {}) as Record<string, unknown>;
  const s = (o.source && typeof o.source === "object" ? o.source : {}) as Record<string, unknown>;
  const kind = KINDS.includes(s.kind as SpecSourceKind) ? (s.kind as SpecSourceKind) : "scratch";
  const products: SpecDocProduct[] = [];
  const seenKeys = new Set<string>();
  for (const p of Array.isArray(o.products) ? o.products : []) {
    const n = product(p);
    if (!n) continue;
    const k = specRowKey(n);
    if (seenKeys.has(k)) continue;
    seenKeys.add(k);
    products.push(n);
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
    overrides: overridesMap(o.overrides),
    usedRecords: revisionMap(o.usedRecords),
    ...(Number(o.downloadedAt) > 0 ? { downloadedAt: Number(o.downloadedAt) } : {}),
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

/** Row identity everywhere on `SpecDocument` from here down (spec records
 *  design §3.1): `rowKey` is always the caller's own `specRowKey(p)` output
 *  — a real SKU's is `SKU:<UPPER>`, already normalized, so every real-SKU
 *  caller keeps working as long as it passes that (not a bare sku); a
 *  sku-less row (allowance/vendor/system/library) gets a stable identity
 *  the same way. Compared directly against `specRowKey(p)`, never guessed
 *  at — a bare SKU that happens to start `KEY:`/`MPN:`/etc. would be
 *  misread by any heuristic that tried to tell the two apart. */
export function withProduct(doc: SpecDocument, p: SpecDocProduct): SpecDocument {
  const n = product(p);
  if (!n) return doc;
  const k = specRowKey(n);
  if (doc.products.some((x) => specRowKey(x) === k)) return doc;
  return { ...doc, products: [...doc.products, n] };
}

export function withoutProduct(doc: SpecDocument, rowKey: string): SpecDocument {
  return { ...doc, products: doc.products.filter((p) => specRowKey(p) !== rowKey) };
}

export function withProductOrder(doc: SpecDocument, rowKeys: string[]): SpecDocument {
  const first: SpecDocProduct[] = [];
  for (const k of rowKeys) {
    const hit = doc.products.find((p) => specRowKey(p) === k);
    if (hit && !first.includes(hit)) first.push(hit);
  }
  return { ...doc, products: [...first, ...doc.products.filter((p) => !first.includes(p))] };
}

export function withProductHeader(doc: SpecDocument, rowKey: string, articleId: string | null): SpecDocument {
  return {
    ...doc,
    products: doc.products.map((p) => {
      if (specRowKey(p) !== rowKey) return p;
      const { articleId: _drop, ...rest } = p;
      void _drop;
      return articleId ? { ...rest, articleId } : rest;
    }),
  };
}

/** BOM rows → spec products, merged by row key (not sku) so qty on the same
 *  real part sums as before, AND a sku-less allowance/vendor/system row
 *  survives instead of vanishing (spec records design §3.1). A row with
 *  none of sku/mfrNumber/specKey/desc carries no identity and is dropped. */
export function bomProducts(
  rows: Array<{ sku: string; desc?: string; qty: number; mfrNumber?: string; manufacturer?: string; specKey?: string }>
): SpecDocProduct[] {
  const out: SpecDocProduct[] = [];
  const byKey = new Map<string, SpecDocProduct>();
  for (const r of rows) {
    // Same normalizer as every other product on the doc — caps desc/
    // mfrNumber/manufacturer/specKey the same way, and drops a row with
    // none of sku/mfrNumber/specKey/desc (#205 fix round).
    const n = product({ sku: r.sku, mfrNumber: r.mfrNumber, manufacturer: r.manufacturer, specKey: r.specKey, desc: r.desc });
    if (!n) continue;
    const qty = Number(r.qty) || 0;
    const k = specRowKey(n);
    const hit = byKey.get(k);
    if (hit) {
      hit.qty = (hit.qty || 0) + qty;
      continue;
    }
    const p: SpecDocProduct = { ...n, qty };
    byKey.set(k, p);
    out.push(p);
  }
  return out;
}

/* ---- Spec records edits (design §5.1–§5.3) — pure, by row key / specId ---- */

/** Project-only override of a record's title/text (§5.2). Adding a new one
 *  past `SPEC_OVERRIDES_MAX` is refused (doc unchanged). */
export function withOverride(doc: SpecDocument, specId: string, o: SpecOverride): SpecDocument {
  const id = specId.trim();
  const ov = override(o);
  if (!id || !ov) return doc;
  if (!(id in doc.overrides) && Object.keys(doc.overrides).length >= SPEC_OVERRIDES_MAX) return doc;
  return { ...doc, overrides: { ...doc.overrides, [id]: ov } };
}

export function withoutOverride(doc: SpecDocument, specId: string): SpecDocument {
  if (!(specId in doc.overrides)) return doc;
  const { [specId]: _drop, ...rest } = doc.overrides;
  void _drop;
  return { ...doc, overrides: rest };
}

/** Waive a row (§5.1) — reason required (a blank one is refused), capped. */
export function withWaive(doc: SpecDocument, rowKey: string, reason: string): SpecDocument {
  const r = capStr(str(reason), SPEC_FILL_IN_MAX);
  if (!r) return doc;
  return { ...doc, products: doc.products.map((p) => (specRowKey(p) === rowKey ? { ...p, waived: { reason: r } } : p)) };
}

export function withoutWaive(doc: SpecDocument, rowKey: string): SpecDocument {
  return {
    ...doc,
    products: doc.products.map((p) => {
      if (specRowKey(p) !== rowKey || !p.waived) return p;
      const { waived: _drop, ...rest } = p;
      void _drop;
      return rest;
    }),
  };
}

/** Set a row's system match key (§5.1 Link to a system record). The row's
 *  identity can change with it (`KEY:` rows); if it would collide with
 *  another row, the two merge — quantities summed — like bomProducts. */
export function withRowSpecKey(doc: SpecDocument, rowKey: string, specKey: string): SpecDocument {
  const k = capStr(str(specKey), SPEC_HEADER_MAX);
  const i = doc.products.findIndex((p) => specRowKey(p) === rowKey);
  if (i < 0) return doc;
  const { specKey: _drop, ...rest } = doc.products[i];
  void _drop;
  const next: SpecDocProduct = k ? { ...rest, specKey: k } : rest;
  const nk = specRowKey(next);
  const j = doc.products.findIndex((p, x) => x !== i && specRowKey(p) === nk);
  if (j < 0) return { ...doc, products: doc.products.map((p, x) => (x === i ? next : p)) };
  const qty = (Number(doc.products[j].qty) || 0) + (Number(next.qty) || 0);
  return {
    ...doc,
    products: doc.products
      .map((p, x) => (x === j ? { ...p, qty } : p))
      .filter((_, x) => x !== i),
  };
}

/** Pin a row to a record (§3.2 step 0); an empty specId unpins. A library
 *  row (`SPEC:` identity) is never unpinned this way — remove it instead. */
export function withRowPin(doc: SpecDocument, rowKey: string, specId: string): SpecDocument {
  const id = capStr(str(specId), SPEC_HEADER_MAX);
  return {
    ...doc,
    products: doc.products.map((p) => {
      if (specRowKey(p) !== rowKey) return p;
      if (p.fromLibrary && !id) return p;
      const { specId: _drop, ...rest } = p;
      void _drop;
      return id ? { ...rest, specId: id } : rest;
    }),
  };
}

/** Add from Spec Library (§5.3): one `SPEC:<id>` row, idempotent. */
export function withLibraryRow(doc: SpecDocument, specId: string): SpecDocument {
  const id = str(specId);
  if (!id) return doc;
  return withProduct(doc, { sku: "", specId: id, fromLibrary: true });
}

/** Each Word download records the record revisions it printed (§5.3). */
export function withDownloadStamp(doc: SpecDocument, used: Record<string, number>, at: number): SpecDocument {
  return { ...doc, usedRecords: revisionMap(used), ...(Number(at) > 0 ? { downloadedAt: Number(at) } : {}) };
}
