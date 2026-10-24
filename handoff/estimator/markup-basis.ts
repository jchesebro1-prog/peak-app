/**
 * Estimator handoff — the margin → markup conversion (#367), one place for the slicer AND the browser runtime.
 *
 * The app keeps two stored-basis rules (src/lib/markup/):
 *   - quotes and projects convert on READ (`hydrateDoc` in src/db/doc-store.ts): a doc without `pricingBasis: "markup"`
 *     stores margins; every pricing fraction converts exactly, no sell amount moves, and the doc is stamped;
 *   - rate blobs (tiers, service rates, catalog default) convert ONCE (`convertRateBlobs` in src/lib/stores/pricing.ts,
 *     under updateBlob's lock): rounded to a whole percent, stamped `_pricingBasis`, the old values kept in `_marginBackup`.
 *
 * The prototype is seeded from a raw `db:export` (rows as stored: unconverted, converted, or a mix), so it applies the SAME
 * two rules with the app's own pure converters (imported, never copied) at two points that share this module:
 *   1. the slicer (slice-rules.ts), so data/*.js is already markup-basis — what the founder reads is one basis;
 *   2. the browser store's read boundary (runtime/store.ts) and `blobData` (runtime/ports.ts), so an unstamped doc from
 *      any source — an overlay saved by an older build of the same snapshot, an extra file, a hand-edited data script — shows
 *      exactly what the app would show. Both are idempotent: a stamped doc is returned untouched (honouring the stamp as
 *      hydrateDoc does), so a doc the prototype itself saved is never converted twice.
 *
 * The only thing here that is not imported is MARGIN_KEYS (stores/pricing.ts keeps it module-private, and that module reaches
 * the database); test-handoff-runtime.ts pins this copy against the original's source text.
 */
import { convertQuoteDoc } from "@/lib/markup/doc-basis";
import { BASIS_STAMP, markupSettingsPatch } from "@/lib/markup/settings";
import { PRICING_BASIS } from "@/lib/markup";

/** stores/pricing.ts MARGIN_KEYS — the margin keys each rate blob held before the markup switch, and whether it stores whole percents. */
export const MARGIN_KEYS: ReadonlyArray<readonly [blob: string, keys: readonly string[], pct: boolean]> = [
  ["pricing_rules", ["tiers.base", "tiers.copper", "tiers.silver", "tiers.gold", "tiers.platinum", "tiers.reseller", "tiers.employee", "system.baseMargin"], true],
  ["flametest_rates", ["margin"], false],
  ["repair_rates", ["margin", "partsMargin"], false],
  ["inspection_rates", ["margin"], false],
  ["catalog_rates", ["defaultMargin"], false],
];

const isRec = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

/** A quote doc on the markup basis: a stamped doc as is, an unstamped one as a converted COPY (hydrateDoc's arithmetic). Pure. */
export function quoteOnMarkupBasis<T extends Record<string, unknown>>(doc: T): T {
  return convertQuoteDoc(doc);
}

/** A rate blob's data on the markup basis: converted once (stamp + backup, whole-% rounding), a stamped or unlisted blob as is. Pure. */
export function rateBlobOnMarkupBasis(id: string, data: unknown): unknown {
  if (!isRec(data)) return data;
  const row = MARGIN_KEYS.find(([blob]) => blob === id);
  if (!row) return data;
  const patch = markupSettingsPatch(data, row[1], row[2]);
  return patch ? { ...data, ...patch } : data;
}

/** The whole blob data an empty / missing rate blob gets when it is first written: just the stamp (the app's convertRateBlobs on {}). */
export const EMPTY_STAMPED_BLOB: Readonly<Record<string, unknown>> = { [BASIS_STAMP]: PRICING_BASIS };
