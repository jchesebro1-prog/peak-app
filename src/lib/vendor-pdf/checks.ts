/* #348 slice 5 — Read the PDF: deterministic checks on what the model read. Pure and browser-safe (the modal
   runs them on the unsaved read). Everything here flags; nothing silently fixes a number the PDF printed. */
import { isVendorPickerType } from "@/lib/vendor-quotes/rules";
import { orderNumberOf, partModel } from "@/lib/catalog-rename/sku";
import { money } from "@/lib/format";
import type { VendorPdfExtraction, VendorPdfLine } from "./extraction";

export const LINE_MATH_ABS_TOL = 0.01; // one cent
export const LINE_MATH_REL_TOL = 0.005; // 0.5 %
const EPS = 1e-9;
const r2 = (n: number) => Math.round(n * 100) / 100;
const usd = (n: number) => money(n, { cents: true });

export type LineMath = { status: "ok" | "off" | "unchecked"; expected: number | null };
/** Checked only when qty, unitPrice and amount are all printed. expected = r2(qty × unitPrice).
 *  Off when |expected − amount| > max(0.01, 0.005 × |amount|, 0.005 × |qty|)
 *  (0.5 %, or a half-cent unit-price rounding per unit, or one cent). Flag only — never fixed. */
export function lineMath(l: VendorPdfLine): LineMath {
  if (l.qty === undefined || l.unitPrice === undefined || l.amount === undefined) return { status: "unchecked", expected: null };
  const expected = r2(l.qty * l.unitPrice);
  const tol = Math.max(LINE_MATH_ABS_TOL, LINE_MATH_REL_TOL * Math.abs(l.amount), LINE_MATH_REL_TOL * Math.abs(l.qty));
  return { status: Math.abs(expected - l.amount) > tol + EPS ? "off" : "ok", expected };
}

/** What the modal row gets for extracted line i (fill.ts and diff.ts share it).
 *  description = description || mfrPartNumber || `Line ${i + 1}`; manufacturerPartNumber = mfrPartNumber ?? "";
 *  qty = String(qty ?? 1); unit = unit || "ea";
 *  amount = amount printed → String(r2(amount)); else qty & unitPrice → String(r2(qty × unitPrice)) with derivedAmount;
 *  else "" (the line still fills; its money is the user's to type). */
export function filledLine(l: VendorPdfLine, i: number): { description: string; manufacturerPartNumber: string; qty: string; unit: string; amount: string; derivedAmount: boolean } {
  let amount = "";
  let derivedAmount = false;
  if (l.amount !== undefined) amount = String(r2(l.amount));
  else if (l.qty !== undefined && l.unitPrice !== undefined) {
    amount = String(r2(l.qty * l.unitPrice));
    derivedAmount = true;
  }
  return {
    description: l.description || l.mfrPartNumber || `Line ${i + 1}`,
    manufacturerPartNumber: l.mfrPartNumber ?? "",
    qty: String(l.qty ?? 1),
    unit: l.unit || "ea",
    amount,
    derivedAmount,
  };
}

export type SumCheck = { status: "ok" | "excludes-extras" | "off" | "no-total" | "no-lines"; lines: number; freight: number; tax: number; expected: number; total: number | null; diff: number };
/** lines = Σ r2(filled amounts); expected = lines + (freight ?? 0) + (tax ?? 0); tol = max(0.01, 0.01 × lineCount).
 *  no-lines when there are no lines; no-total when total is absent; ok when |expected − total| ≤ tol;
 *  excludes-extras when freight or tax is printed and |lines − total| ≤ tol; else off (diff = r2(total − expected)).
 *  Flag only — the form uses the PDF's total as printed. */
export function sumCheck(x: VendorPdfExtraction): SumCheck {
  const ls = x.lines ?? [];
  const lines = r2(ls.reduce((s, l, i) => s + r2(Number(filledLine(l, i).amount) || 0), 0));
  const freight = x.freight ?? 0;
  const tax = x.tax ?? 0;
  const expected = r2(lines + freight + tax);
  const total = x.total ?? null;
  const base = { lines, freight, tax, expected, total, diff: total === null ? 0 : r2(total - expected) };
  if (ls.length === 0) return { ...base, status: "no-lines" };
  if (total === null) return { ...base, status: "no-total" };
  const tol = Math.max(0.01, 0.01 * ls.length) + EPS;
  if (Math.abs(expected - total) <= tol) return { ...base, status: "ok" };
  if ((x.freight !== undefined || x.tax !== undefined) && Math.abs(lines - total) <= tol) return { ...base, status: "excludes-extras" };
  return { ...base, status: "off" };
}

export type CatalogMatchPart = { sku: string; mfr?: string; manufacturerModelNumber?: string; manufacturerPartNumber?: string; formerSkus?: string[] };
export type CatalogMatchBy = "model" | "partNumber" | "sku" | "formerSku";
export type CatalogMatch = { kind: "match"; sku: string; model: string; mfr: string; by: CatalogMatchBy } | { kind: "ambiguous"; count: number; by: CatalogMatchBy } | null;

const exactKey = (s: string | undefined | null) => String(s ?? "").normalize("NFKC").trim().toUpperCase().replace(/\s+/g, " ");
const looseKey = (k: string) => k.replace(/[^A-Z0-9]/g, "");

/** The keys a part answers to in each tier, in tier order. */
function tierKeys(p: CatalogMatchPart): Record<CatalogMatchBy, string[]> {
  const sku = [p.sku, orderNumberOf(p.sku)];
  const former = (p.formerSkus ?? []).flatMap((f) => [f, orderNumberOf(f)]);
  return {
    model: [p.manufacturerModelNumber ?? ""],
    partNumber: [p.manufacturerPartNumber ?? ""],
    sku,
    formerSku: former,
  };
}
const TIERS: CatalogMatchBy[] = ["model", "partNumber", "sku", "formerSku"];

/** Key → parts, per tier, for the exact and the loose key. Built once per read (the catalog is tens of thousands
 *  of parts and a read can have 300 lines); a part appears at most once per key, in catalog order. */
export type CatalogIndex = Record<"exact" | "loose", Record<CatalogMatchBy, Map<string, CatalogMatchPart[]>>>;
export function buildCatalogIndex(parts: readonly CatalogMatchPart[]): CatalogIndex {
  const mk = () => ({ model: new Map(), partNumber: new Map(), sku: new Map(), formerSku: new Map() }) as Record<CatalogMatchBy, Map<string, CatalogMatchPart[]>>;
  const idx: CatalogIndex = { exact: mk(), loose: mk() };
  const add = (m: Map<string, CatalogMatchPart[]>, key: string, p: CatalogMatchPart) => {
    if (!key) return;
    const list = m.get(key);
    if (!list) m.set(key, [p]);
    else if (list[list.length - 1] !== p) list.push(p);
  };
  for (const p of parts) {
    const keys = tierKeys(p);
    for (const tier of TIERS) {
      for (const v of keys[tier]) {
        const e = exactKey(v);
        add(idx.exact[tier], e, p);
        add(idx.loose[tier], looseKey(e), p);
      }
    }
  }
  return idx;
}

/** Match a printed part number to the catalog. Keys: exact = NFKC, trim, uppercase, collapse whitespace;
 *  loose = exact with every non-[A-Z0-9] removed (used only when the loose key is ≥ 4 chars).
 *  Part numbers under 3 characters never match.
 *  Precedence, first tier with any hit wins — pass 1 with exact keys over all four tiers, then pass 2 with loose keys:
 *    1 model:      part.manufacturerModelNumber
 *    2 partNumber: part.manufacturerPartNumber
 *    3 sku:        part.sku, or orderNumberOf(part.sku) (the text after the first colon)
 *    4 formerSku:  any of part.formerSkus, or orderNumberOf(former)
 *  Several parts in the winning tier: keep those whose normalized mfr equals normalizeCompanyName(vendorHint);
 *  exactly one → match; otherwise ambiguous (count). `model` is partModel(part).
 *  Pass a prebuilt `buildCatalogIndex(parts)` when matching many lines against one catalog. */
export function catalogMatch(partNumber: string | undefined, parts: readonly CatalogMatchPart[] | CatalogIndex, vendorHint?: string): CatalogMatch {
  const exact = exactKey(partNumber);
  if (exact.length < 3) return null;
  const loose = looseKey(exact);
  const idx = Array.isArray(parts) ? buildCatalogIndex(parts as readonly CatalogMatchPart[]) : (parts as CatalogIndex);
  const attempts: Array<{ kind: "exact" | "loose"; key: string }> = [{ kind: "exact", key: exact }];
  if (loose.length >= 4) attempts.push({ kind: "loose", key: loose });
  const hint = vendorHint ? normalizeCompanyName(vendorHint) : "";
  for (const a of attempts) {
    for (const tier of TIERS) {
      const hits = idx[a.kind][tier].get(a.key);
      if (!hits || hits.length === 0) continue;
      let pick = hits;
      if (hits.length > 1 && hint) {
        const narrowed = hits.filter((p) => normalizeCompanyName(p.mfr) === hint);
        if (narrowed.length === 1) pick = narrowed;
      }
      if (pick.length === 1) {
        const p = pick[0];
        return { kind: "match", sku: p.sku, model: partModel(p), mfr: p.mfr ?? "", by: tier };
      }
      return { kind: "ambiguous", count: hits.length, by: tier };
    }
  }
  return null;
}

export type VendorCompanyLike = { id: string; name: string; type?: string | null };
/** lowercase, "&" → "and", strip punctuation, collapse spaces, drop a leading "the" and trailing
 *  inc|incorporated|llc|l l c|co|corp|corporation|company|ltd|limited (repeatedly). */
export function normalizeCompanyName(s: string | undefined | null): string {
  let n = String(s ?? "").normalize("NFKC").toLowerCase().replace(/&/g, " and ").replace(/['’`]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
  n = n.replace(/^the\s+(?=\S)/, "");
  const suffix = /\s(?:inc|incorporated|llc|l l c|co|corp|corporation|company|ltd|limited)$/;
  while (suffix.test(n)) n = n.replace(suffix, "").trim();
  return n;
}

export type VendorMatch = { status: "one"; companyId: string; name: string } | { status: "many"; count: number } | { status: "none" };
/** Exact normalized-name equality against live vendor-type companies only (isVendorPickerType). No fuzzy match. */
export function vendorCompanyMatch(vendor: string | undefined, companies: readonly VendorCompanyLike[]): VendorMatch {
  const key = normalizeCompanyName(vendor);
  if (!key) return { status: "none" };
  const hits = companies.filter((c) => isVendorPickerType(c.type) && normalizeCompanyName(c.name) === key);
  if (hits.length === 1) return { status: "one", companyId: hits[0].id, name: hits[0].name };
  if (hits.length > 1) return { status: "many", count: hits.length };
  return { status: "none" };
}

export type FreightRule = { tick: boolean; why: "excluded-words" | "freight-in-total" | "included-words" | "none" };
const FREIGHT_NEG = /freight\s+(not\s+included|extra|additional|to be (added|billed)|tbd|billed separately|collect)|plus freight|\+\s*freight|f\.?o\.?b\.?[:\s]+(origin|shipping point|factory|our dock)|prepa(?:y|id)(?:\s+and|\s*&)\s*add(?:ed)?|ppd\s*(?:&|and)\s*add(?:ed)?|\bpp\s*&\s*a\b/i;
const FREIGHT_POS = /freight\s+(included|incl\.?|allowed)|prepaid\s+(and|&)\s+allowed|ppd\s*(&|and)\s*allowed|f\.?o\.?b\.?[:\s]+(destination|jobsite|job site)|free (freight|shipping)|delivered price/i;
/** Text = paymentTerms + notes + leadTime + shipFrom. In order:
 *  1. NEG words → no tick (excluded-words; wins).
 *  2. freight > 0 and the total carries it (sumCheck ok, or no total) → tick (freight-in-total).
 *  3. POS words → tick (included-words).
 *  4. else none. */
export function includesFreightRule(x: VendorPdfExtraction): FreightRule {
  const text = [x.paymentTerms, x.notes, x.leadTime, x.shipFrom].filter(Boolean).join(" ");
  if (FREIGHT_NEG.test(text)) return { tick: false, why: "excluded-words" };
  if ((x.freight ?? 0) > 0 && (x.total === undefined || sumCheck(x).status === "ok")) return { tick: true, why: "freight-in-total" };
  if (FREIGHT_POS.test(text)) return { tick: true, why: "included-words" };
  return { tick: false, why: "none" };
}

export type VendorPdfLineCheck = { math: LineMath; derivedAmount: boolean; catalog: CatalogMatch };
export type VendorPdfChecks = { lines: VendorPdfLineCheck[]; sum: SumCheck; vendor: VendorMatch; freight: FreightRule; mathFlags: number };
export function vendorPdfChecks(x: VendorPdfExtraction, ctx: { parts: readonly CatalogMatchPart[]; companies: readonly VendorCompanyLike[] }): VendorPdfChecks {
  const index = buildCatalogIndex(ctx.parts);
  return {
    lines: (x.lines ?? []).map((l, i) => ({
      math: lineMath(l),
      derivedAmount: filledLine(l, i).derivedAmount,
      catalog: catalogMatch(l.mfrPartNumber, index, x.vendor),
    })),
    sum: sumCheck(x),
    vendor: vendorCompanyMatch(x.vendor, ctx.companies),
    freight: includesFreightRule(x),
    mathFlags: mathFlagCount(x),
  };
}

/** Lines whose math is off + 1 when the sum is off. No catalog or companies needed (diff.ts and the run detail use it). */
export function mathFlagCount(x: VendorPdfExtraction): number {
  const off = (x.lines ?? []).filter((l) => lineMath(l).status === "off").length;
  return off + (sumCheck(x).status === "off" ? 1 : 0);
}

const FREIGHT_WHY: Record<FreightRule["why"], string> = {
  "freight-in-total": "the PDF's total includes the freight",
  "included-words": "the PDF says freight is included",
  "excluded-words": "the PDF says freight is extra",
  none: "",
};

/** The banner's lines, warnings first. The vendor line is a warning when the form already has a different vendor
 *  or several companies match, otherwise an info line ("linked to …"). */
export function checkNotes(c: VendorPdfChecks, x: VendorPdfExtraction, form: { vendor: string; vendorCompanyId: string | null }): Array<{ tone: "warn" | "info"; text: string }> {
  const warn: string[] = [];
  const info: string[] = [];
  const ls = x.lines ?? [];
  c.lines.forEach((lc, i) => {
    const l = ls[i];
    if (lc.math.status === "off" && lc.math.expected !== null && l && l.qty !== undefined && l.unitPrice !== undefined && l.amount !== undefined) {
      warn.push(`Line ${i + 1}: ${l.qty} × ${usd(l.unitPrice)} = ${usd(lc.math.expected)} — the PDF says ${usd(l.amount)}.`);
    }
  });
  if (c.sum.status === "off" && c.sum.total !== null) {
    warn.push(`Lines + freight + tax = ${usd(c.sum.expected)}; the PDF's total is ${usd(c.sum.total)} (off by ${usd(Math.abs(c.sum.diff))}). The form uses the PDF's total.`);
  }
  if (c.sum.status === "excludes-extras") warn.push("The PDF total leaves out freight / tax.");
  if (x.vendor) {
    const nameDiffers = form.vendor.trim() !== "" && normalizeCompanyName(form.vendor) !== normalizeCompanyName(x.vendor);
    // The form already links a different company than the one the PDF's name matches.
    const idDiffers = form.vendorCompanyId !== null && c.vendor.status === "one" && form.vendorCompanyId !== c.vendor.companyId;
    if (nameDiffers || idDiffers) warn.push(`The PDF reads “${x.vendor}” — the form has “${form.vendor.trim() || "another vendor"}”.`);
    else if (c.vendor.status === "many") warn.push(`The PDF reads “${x.vendor}” — matches ${c.vendor.count} vendor companies — pick one.`);
    else if (c.vendor.status === "one") info.push(`The PDF reads “${x.vendor}” — linked to ${c.vendor.name}.`);
  }
  if (c.freight.tick && FREIGHT_WHY[c.freight.why]) info.push(`Quote includes freight ticked — ${FREIGHT_WHY[c.freight.why]}.`);
  const matched = c.lines.filter((l) => l.catalog?.kind === "match").length;
  if (matched > 0) info.push(`${matched} of ${c.lines.length} lines match catalog parts.`);
  const derived = c.lines.flatMap((l, i) => (l.derivedAmount ? [i + 1] : []));
  if (derived.length) info.push(`Amounts computed from qty × unit price on line${derived.length === 1 ? "" : "s"} ${derived.join(", ")}.`);
  return [...warn.map((text) => ({ tone: "warn" as const, text })), ...info.map((text) => ({ tone: "info" as const, text }))];
}
