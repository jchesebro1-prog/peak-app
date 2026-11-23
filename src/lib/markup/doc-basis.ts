/**
 * Convert-on-read (#367, spec §5.1): a `quotes` / `projects` doc without the
 * `pricingBasis: "markup"` stamp stores margins. Every stored pricing fraction
 * converts EXACTLY to markup; line prices, totals and values are never touched
 * (no sell amount moves). Pure; used by src/db/doc-store.ts on every read.
 * The same read hook drops a stored Rewards credit line from a quote
 * (`dropStoredCreditLines`, below).
 */
import { PRICING_BASIS, marginToMarkup, markupPctString } from "./index";

export const BASIS_KEY = "pricingBasis";
/** The only collections that store pricing percentages (designs compute theirs at promotion). */
export const BASIS_COLLECTIONS: ReadonlySet<string> = new Set(["quotes", "projects"]);

type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => !!v && typeof v === "object" && !Array.isArray(v);
const conv = (o: Rec, key: string) => {
  const v = o[key];
  if (typeof v === "number" && Number.isFinite(v)) o[key] = marginToMarkup(v);
};

function convService(sub: unknown): void {
  if (!isRec(sub)) return;
  if (isRec(sub.rates)) {
    conv(sub.rates, "margin");
    conv(sub.rates, "partsMargin");
  }
  conv(sub, "partsMargin");
}

function convSpec(spec: unknown): void {
  if (!isRec(spec) || !Array.isArray(spec.sections)) return;
  for (const sec of spec.sections) {
    if (!isRec(sec) || !isRec(sec.laborGroups)) continue;
    for (const rec of Object.values(sec.laborGroups)) {
      if (!isRec(rec) || !isRec(rec.draft) || typeof rec.draft.margin !== "string" || !rec.draft.margin.trim()) continue;
      const pct = parseFloat(rec.draft.margin);
      if (Number.isFinite(pct)) rec.draft.margin = markupPctString(marginToMarkup(pct / 100));
    }
  }
}

function convPayload(o: Rec): void {
  conv(o, "margin");
  conv(o, "tierMargin");
  convSpec(o.spec);
  convService(o.flameTest);
  convService(o.repair);
  convService(o.inspection);
}

function quoteInPlace(out: Rec): void {
  convPayload(out);
  if (Array.isArray(out.revisions)) for (const r of out.revisions) if (isRec(r)) convPayload(r);
  out[BASIS_KEY] = PRICING_BASIS;
}

function projectInPlace(out: Rec): void {
  conv(out, "margin");
  out[BASIS_KEY] = PRICING_BASIS;
}

/** Pure: a converted COPY (the input is never touched); a stamped doc comes back as-is. */
export function convertQuoteDoc<T extends Rec>(doc: T): T {
  if (doc[BASIS_KEY] === PRICING_BASIS) return doc;
  const out = structuredClone(doc) as Rec;
  quoteInPlace(out);
  return out as T;
}

export function convertProjectDoc<T extends Rec>(doc: T): T {
  if (doc[BASIS_KEY] === PRICING_BASIS) return doc;
  const out = structuredClone(doc) as Rec;
  projectInPlace(out);
  return out as T;
}

/**
 * The Customer Rewards credit was removed (2026-11-23). A quote saved while it
 * existed could carry one line flagged `rewardCredit: true` (a negative price).
 * Such a line is dropped from the live `spec.sections` on read, so it can never
 * reach pricing or a customer document. Read-time only: nothing is written for
 * it, and `revisions` (frozen copies) are left exactly as stored.
 */
const isStoredCreditLine = (it: unknown): boolean => isRec(it) && it.rewardCredit === true;

function dropStoredCreditLines(quote: Rec): void {
  if (!isRec(quote.spec) || !Array.isArray(quote.spec.sections)) return;
  for (const sec of quote.spec.sections) {
    if (isRec(sec) && Array.isArray(sec.items) && sec.items.some(isStoredCreditLine)) {
      sec.items = sec.items.filter((it) => !isStoredCreditLine(it));
    }
  }
}

/**
 * The doc store's one read hook. Works IN PLACE: every row the store hands
 * it is freshly parsed JSON nobody else holds, and a legacy quote that is never
 * re-saved (Daylite history) is converted on every read — cloning thousands of
 * specs per list read would be the slow part, not the arithmetic.
 */
export function hydrateDoc<T extends Rec>(coll: string, doc: T): T {
  if (coll === "quotes") dropStoredCreditLines(doc);
  if (doc[BASIS_KEY] === PRICING_BASIS) return doc;
  if (coll === "quotes") quoteInPlace(doc);
  else if (coll === "projects") projectInPlace(doc);
  return doc;
}
