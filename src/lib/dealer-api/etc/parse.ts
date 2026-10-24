/**
 * #368 — ETC price lists → plain rows. Pure: no I/O, no env, safe anywhere.
 *
 * ETC's v0 Pricing API returns `PriceListPart`s whose prices are decimal
 * STRINGS ("1040.00"). A full list arrives as `{ parts, categoryTree,
 * repPricingCategories }`; a price-updates call as a bare array. Both go
 * through `parsePriceList`, which zod-checks each row, converts prices to
 * cents-safe numbers and drops (with a reason) any row it can't trust: no
 * part number, a currency other than USD, an unparseable price, or no price
 * at all. A missing or zero price is `null` — "ETC didn't say", never $0.
 */
import { z } from "zod";

export const ETC_LISTS = ["finished-goods", "spare-parts", "flat-rate-repair", "demo-prices"] as const;
export type EtcListKey = (typeof ETC_LISTS)[number];
/** The lists that write `list` / `cost`, in precedence order (spec §6). */
export const ETC_PRICED_LISTS: readonly EtcListKey[] = ["finished-goods", "spare-parts", "flat-rate-repair"];
export const ETC_LIST_LABEL: Record<EtcListKey, string> = {
  "finished-goods": "Finished goods",
  "spare-parts": "Spare parts",
  "flat-rate-repair": "Flat-rate repair",
  "demo-prices": "Demo prices",
};

export function isEtcListKey(v: unknown): v is EtcListKey {
  return typeof v === "string" && (ETC_LISTS as readonly string[]).includes(v);
}

export type EtcRow = {
  list: EtcListKey;
  partNumber: string;
  modelNumber: string;
  desc: string;
  /** ETC's first category path ("Fixtures > ArcSystem Pro > Accessories"), or "". */
  categoryPath: string;
  /** null = missing or zero (leave ours alone). */
  listPrice: number | null;
  netPrice: number | null;
};

export type EtcSkip = { list: EtcListKey; partNumber: string; reason: string };
export type EtcParseResult = { rows: EtcRow[]; skipped: EtcSkip[]; error: string | null };

/** Rows read from one list at most — a bound, not an expectation. */
export const ETC_MAX_ROWS_PER_LIST = 100_000;

const text = z.union([z.string(), z.number()]).nullish();
const PriceListPart = z.object({
  partNumber: text,
  modelNumber: text,
  description: text,
  shortDescription: text,
  categoryPaths: z.array(z.unknown()).nullish(),
  listPrice: text,
  netPrice: text,
  currency: text,
});

function str(v: unknown, max: number): string {
  if (v == null) return "";
  // Control characters out, whitespace collapsed.
  return String(v).replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
}

/** Decimal string (or number) → dollars rounded to cents; null = missing/zero; NaN = unparseable. */
export function etcPrice(v: unknown): number | null {
  if (v == null) return null;
  if (typeof v === "number") {
    if (!Number.isFinite(v) || v < 0) return NaN;
    return v === 0 ? null : Math.round(v * 100) / 100;
  }
  const s = String(v).trim().replace(/[$,]/g, "");
  if (!s) return null;
  if (!/^\d+(\.\d+)?$/.test(s)) return NaN;
  const n = Math.round(parseFloat(s) * 100) / 100;
  if (!Number.isFinite(n)) return NaN;
  return n === 0 ? null : n;
}

/** Accepts `{ parts: [...] }` (a full list) or a bare array (price updates). */
export function parsePriceList(json: unknown, list: EtcListKey): EtcParseResult {
  const raw: unknown = Array.isArray(json) ? json : json && typeof json === "object" ? (json as { parts?: unknown }).parts : undefined;
  if (!Array.isArray(raw)) return { rows: [], skipped: [], error: `ETC's ${ETC_LIST_LABEL[list]} list wasn't in the expected shape.` };
  const rows: EtcRow[] = [];
  const skipped: EtcSkip[] = [];
  for (const item of raw.slice(0, ETC_MAX_ROWS_PER_LIST)) {
    const p = PriceListPart.safeParse(item);
    const pn = p.success ? str(p.data.partNumber, 80) : str(item && typeof item === "object" ? (item as { partNumber?: unknown }).partNumber : "", 80);
    if (!p.success) {
      skipped.push({ list, partNumber: pn, reason: "Not a price-list row" });
      continue;
    }
    const d = p.data;
    if (!pn) {
      skipped.push({ list, partNumber: "", reason: "No part number" });
      continue;
    }
    const currency = str(d.currency, 10).toUpperCase();
    if (currency && currency !== "USD") {
      skipped.push({ list, partNumber: pn, reason: `Priced in ${currency}, not USD` });
      continue;
    }
    const listPrice = etcPrice(d.listPrice);
    const netPrice = etcPrice(d.netPrice);
    if (Number.isNaN(listPrice) || Number.isNaN(netPrice)) {
      skipped.push({ list, partNumber: pn, reason: "Price isn't a number" });
      continue;
    }
    if (listPrice == null && netPrice == null) {
      skipped.push({ list, partNumber: pn, reason: "No price" });
      continue;
    }
    const model = str(d.modelNumber, 120);
    const paths = (d.categoryPaths ?? []).map((x) => str(x, 300)).filter(Boolean);
    rows.push({
      list,
      partNumber: pn,
      modelNumber: model,
      desc: str(d.description, 500) || str(d.shortDescription, 500) || model || pn,
      categoryPath: paths[0] ?? "",
      listPrice,
      netPrice,
    });
  }
  return { rows, skipped, error: null };
}
