/**
 * Catalog price dates (PUNCHLIST #133, D156) + the price-book glance
 * (PUNCHLIST #14). Pure and import-free so the Home card, the Catalog
 * banner, the store's stamping rule and the spec harness all share one
 * definition of "when is this price from" without touching the database.
 *
 * Two dates feed every answer:
 * - `part.pricedAt` — epoch ms of the price list this line's price came
 *   from; the store stamps it ONLY when `list` or `cost` actually changes
 *   (see nextPricedAt), so it means "when this price last moved".
 * - `settings.priceListEffective[mfrKey(mfr)]` — the manufacturer's
 *   "price list effective" date, set by the Catalog banner (the one-time
 *   backfill) and by every import that writes rows. A list confirmed on
 *   day D confirms every line on it, so a line's effective date is the
 *   LATER of its own date and the book date.
 */

const DAY = 86400000;

/** 18 months. A book whose oldest effective date is this old is "outdated". */
export const OUTDATED_AFTER_MS = 548 * DAY;

export function isOutdated(at: number, now: number = Date.now()): boolean {
  return now - at >= OUTDATED_AFTER_MS;
}

/** Manufacturer key: lowercase, non-alphanumerics stripped — the same
 *  normalization the importer's `norm()` applies to headers, so
 *  "Meyer Sound" / "meyer-sound" / "MEYER SOUND" are one book. */
export function mfrKey(name: string | null | undefined): string {
  return String(name == null ? "" : name)
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

export type PriceListEffective = Record<string, number>;
export type PriceDateSettings = { priceListEffective?: PriceListEffective | null };

function validMs(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) && v > 0 ? v : null;
}

/** The date a part's price is effective as of, or null when nothing dates it. */
export function effectivePriceDate(
  part: { mfr?: string; pricedAt?: number },
  settings: PriceDateSettings = {}
): number | null {
  const own = validMs(part.pricedAt);
  const key = mfrKey(part.mfr);
  const book = key ? validMs(settings.priceListEffective?.[key]) : null;
  if (own == null) return book;
  if (book == null) return own;
  return Math.max(own, book);
}

/**
 * The store's stamping rule (lib/stores/catalog upsert/mergeUpsert):
 * - a brand-new part is stamped with `at` (unless the incoming doc already
 *   carries a date, e.g. a backfill script);
 * - an existing part whose `list` or `cost` changed is stamped with `at`;
 * - otherwise the date stays what it was (the incoming full-replace doc
 *   normally carries the existing value; a legacy part stays undated —
 *   never invent a date for a price nobody confirmed).
 */
export function nextPricedAt(
  existing: { list?: number; cost?: number; pricedAt?: number } | null | undefined,
  next: { list?: number; cost?: number; pricedAt?: number },
  at: number
): number | undefined {
  const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
  if (!existing) return next.pricedAt ?? at;
  const changed = n(existing.list) !== n(next.list) || n(existing.cost) !== n(next.cost);
  if (changed) return at;
  return next.pricedAt ?? existing.pricedAt;
}

/** `<input type="date">` value → epoch ms at local NOON; blank/invalid → `now`.
 *  Noon, not midnight: the server actions parse this on Vercel (UTC), and a
 *  UTC midnight renders as the previous calendar day in every US browser
 *  (the banner input/pill, both builders' "prices as of") — and hydrates
 *  mismatched. Noon stays on the same calendar day in every zone within
 *  ±11 h; the same date-only convention the task due dates use
 *  (`due + "T12:00:00"` in projects/estimator/designs actions). */
export function parseEffectiveDate(input: string | null | undefined, now: number): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec((input || "").trim());
  if (!m) return now;
  const t = new Date(+m[1], +m[2] - 1, +m[3], 12, 0, 0, 0).getTime();
  return Number.isFinite(t) ? t : now;
}

/** Epoch ms → local `YYYY-MM-DD` (the value shape `<input type="date">` wants). */
export function isoDateOf(ms: number): string {
  const d = new Date(ms);
  const p = (n: number) => (n < 10 ? "0" + n : "" + n);
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export type PriceBookRow = {
  /** Two-letter monogram for the Home card tile. */
  mono: string;
  /** Display spelling — the most common stored spelling of the manufacturer. */
  name: string;
  /** mfrKey(name); "" for the Unbranded bucket (no manufacturer to date). */
  key: string;
  count: number;
  /** Oldest effective date among the book's parts; null unless EVERY part has one. */
  effectiveAt: number | null;
  outdated: boolean;
  unknown: boolean;
};

function monoOf(name: string): string {
  return name
    .split(/\s+/)
    .map((w) => w[0] || "")
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

/**
 * Price books grouped by manufacturer key. "Oldest wins" (#14 decision A):
 * the book's date is its oldest part's effective date, and a part with no
 * date at all is older than anything — so a book is `unknown` until every
 * part is dated (its own pricedAt or the manufacturer's book date), which
 * is exactly what the Catalog banner's date input provides in one click.
 */
export function priceBooks(
  parts: Array<{ mfr?: string; pricedAt?: number }>,
  settings: PriceDateSettings = {},
  opts: { now?: number; limit?: number } = {}
): PriceBookRow[] {
  const now = opts.now ?? Date.now();
  const limit = opts.limit ?? 6;
  type Acc = { names: Map<string, number>; count: number; dated: number; oldest: number | null };
  const by = new Map<string, Acc>();
  for (const pt of parts) {
    const name = (pt.mfr || "").trim();
    const key = mfrKey(name);
    const acc = by.get(key) || { names: new Map<string, number>(), count: 0, dated: 0, oldest: null };
    acc.count += 1;
    if (name) acc.names.set(name, (acc.names.get(name) || 0) + 1);
    const at = effectivePriceDate(pt, settings);
    if (at != null) {
      acc.dated += 1;
      acc.oldest = acc.oldest == null ? at : Math.min(acc.oldest, at);
    }
    by.set(key, acc);
  }
  return [...by.entries()]
    .map(([key, acc]) => {
      const name = key
        ? [...acc.names.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))[0][0]
        : "Unbranded";
      const effectiveAt = acc.dated === acc.count ? acc.oldest : null;
      return {
        mono: monoOf(name),
        name,
        key,
        count: acc.count,
        effectiveAt,
        outdated: effectiveAt != null && isOutdated(effectiveAt, now),
        unknown: effectiveAt == null,
      };
    })
    .sort((a, b) => b.count - a.count)
    .slice(0, limit);
}
