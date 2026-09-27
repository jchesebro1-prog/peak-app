/**
 * Estimate numbers (#223, docs/superpowers/specs/2026-09-26-estimate-numbers-design.md).
 *
 * The number people see, say, search and print for a quote or a lead:
 * `FLM-1002`, `EST-1005-2`, `OPP-1005`. One shared counter (`estNo`, from the
 * Postgres sequence `estimate_number_seq`) with a prefix per quote type; a
 * lead's number carries to its quotes, and extra quotes on the same
 * opportunity get `-2`, `-3` (`estSuffix`).
 *
 * Internal ids (`Q-2041`, `L-1050`, `Q-dl-…`) stay the keys — URLs, foreign
 * keys, Blob paths. This module only formats. Allocation lives in the
 * database (`assign_estimate_numbers()`, drizzle `*_estimate_numbers.sql`)
 * behind `src/lib/stores/estimate-numbers.ts`.
 *
 * Pure: no store or db import, so `"use client"` files may import it.
 */

export const ESTIMATE_TYPES = ["system", "flame_test", "inspection", "repair", "rental", "consulting"] as const;
export type EstimateType = (typeof ESTIMATE_TYPES)[number];

export const ESTIMATE_PREFIX: Record<EstimateType | "opportunity", string> = {
  system: "EST",
  flame_test: "FLM",
  inspection: "RIG",
  repair: "REP",
  rental: "RNT",
  consulting: "CON",
  opportunity: "OPP",
};

const KNOWN_PREFIXES: ReadonlySet<string> = new Set(Object.values(ESTIMATE_PREFIX));

export type QuoteNumberFields = {
  id?: string;
  estNo?: number | null;
  estSuffix?: number | null;
  quoteType?: string | null;
};

export type LeadNumberFields = { id?: string; estNo?: number | null };

/** A usable counter value: a positive integer. */
export function isEstimateNo(n: unknown): n is number {
  return typeof n === "number" && Number.isSafeInteger(n) && n > 0;
}

/** The quote prefix for a quoteType; absent/unknown is a system quote. */
export function prefixForQuoteType(t: string | null | undefined): string {
  const key = t || "system";
  return (ESTIMATE_TYPES as readonly string[]).includes(key)
    ? ESTIMATE_PREFIX[key as EstimateType]
    : ESTIMATE_PREFIX.system;
}

/** `FLM-1002` / `EST-1005-2`, or null when the quote has no number yet. */
export function formatQuoteNumber(q: QuoteNumberFields): string | null {
  if (!isEstimateNo(q.estNo)) return null;
  const base = `${prefixForQuoteType(q.quoteType)}-${q.estNo}`;
  return isEstimateNo(q.estSuffix) && q.estSuffix >= 2 ? `${base}-${q.estSuffix}` : base;
}

/** `OPP-1005`, or null when the lead has no number yet. */
export function formatLeadNumber(l: LeadNumberFields): string | null {
  return isEstimateNo(l.estNo) ? `${ESTIMATE_PREFIX.opportunity}-${l.estNo}` : null;
}

/** What to show for a quote — its number, else its internal id (never blank). */
export function displayQuoteNumber(q: QuoteNumberFields & { id: string }): string {
  return formatQuoteNumber(q) ?? q.id;
}

/** What to show for a lead — its number, else its internal id (never blank). */
export function displayLeadNumber(l: LeadNumberFields & { id: string }): string {
  return formatLeadNumber(l) ?? l.id;
}

export type ParsedEstimateNumber = { estNo: number; suffix: number | null; prefix: string | null };

/**
 * Read a typed estimate number, case- and separator-tolerant:
 * `flm-1002`, `FLM1002`, `1002`, `#1002`, `1005-2`, `est 1005 2`.
 * A suffix of 1 names the first (unsuffixed) quote; a suffix of 0 is invalid.
 * A dot never separates a suffix (`1002.5` is not a number).
 * Returns null for anything else, including old internal ids (`Q-2041`: a
 * one-letter prefix is not an estimate prefix) and unknown prefixes.
 */
export function parseEstimateNumber(raw: string | null | undefined): ParsedEstimateNumber | null {
  const s = String(raw ?? "").trim().toUpperCase().replace(/^#\s*/, "");
  const m = /^(?:([A-Z]{3})[\s\-_#.]*)?(\d{1,9})(?:[\s\-_/]+(\d{1,3}))?$/.exec(s);
  if (!m) return null;
  const prefix = m[1] ?? null;
  if (prefix !== null && !KNOWN_PREFIXES.has(prefix)) return null;
  const estNo = Number(m[2]);
  if (!isEstimateNo(estNo)) return null;
  const suffix = m[3] ? Number(m[3]) : null;
  if (suffix !== null && suffix < 1) return null;
  return { estNo, suffix, prefix };
}

/** The suffix a quote answers to: its `-2`, `-3`…, or 1 for the first quote. */
function effectiveSuffix(q: QuoteNumberFields): number {
  return isEstimateNo(q.estSuffix) && q.estSuffix >= 2 ? q.estSuffix : 1;
}

/** A parsed number names this quote: same counter value and, when typed, the
 *  same suffix (`-1` = the unsuffixed first quote). The number wins — the
 *  counter is shared, so estNo + suffix is unique, and a quote's type (hence
 *  its prefix) can change after the number was printed. A typed prefix only
 *  ranks (quoteSearchRank). A bare `1005` matches `EST-1005` and `EST-1005-2`. */
export function quoteNumberMatches(q: QuoteNumberFields, p: ParsedEstimateNumber): boolean {
  if (!isEstimateNo(q.estNo) || q.estNo !== p.estNo) return false;
  return p.suffix === null || effectiveSuffix(q) === p.suffix;
}

/** A parsed number names this lead: same counter value under any prefix
 *  (`FLM-1005` finds its opportunity `OPP-1005`); never a suffix. */
export function leadNumberMatches(l: LeadNumberFields, p: ParsedEstimateNumber): boolean {
  if (!isEstimateNo(l.estNo) || l.estNo !== p.estNo) return false;
  return p.suffix === null;
}

/** Search-result tiers: lower sorts first. */
export const SEARCH_RANK = { exactNumber: 0, numberOtherPrefix: 1, text: 2 } as const;

const compact = (v: string) => v.replace(/[\s\-_#./]+/g, "").toUpperCase();

/**
 * The one quote search rule (quotes hub `?q=`, ⌘K), as a rank: null when the
 * term misses; SEARCH_RANK.exactNumber for an exact number whose typed prefix
 * (if any) is this quote's; numberOtherPrefix for an exact number under
 * another prefix; text for a case-insensitive substring of the displayed
 * number (also with separators stripped, so `flm100` finds FLM-1005), the OLD
 * internal id, the name or the customer — so "Q-2041" still finds its quote.
 */
export function quoteSearchRank(
  q: QuoteNumberFields & { id: string; name?: string | null; customer?: string | null },
  term: string
): number | null {
  const t = term.trim().toLowerCase();
  if (!t) return SEARCH_RANK.text;
  const parsed = parseEstimateNumber(t);
  if (parsed && quoteNumberMatches(q, parsed)) {
    return parsed.prefix === null || parsed.prefix === prefixForQuoteType(q.quoteType)
      ? SEARCH_RANK.exactNumber
      : SEARCH_RANK.numberOtherPrefix;
  }
  const shown = formatQuoteNumber(q);
  const hit = [q.id, shown, q.name, q.customer].some((f) => typeof f === "string" && f.toLowerCase().includes(t));
  if (hit) return SEARCH_RANK.text;
  const ct = compact(t);
  return ct && shown && compact(shown).includes(ct) ? SEARCH_RANK.text : null;
}

/** quoteSearchRank as a filter: does the term find this quote at all? */
export function quoteMatchesSearch(
  q: QuoteNumberFields & { id: string; name?: string | null; customer?: string | null },
  term: string
): boolean {
  return quoteSearchRank(q, term) !== null;
}

/** A store patch minus the allocated number — numbers never change after allocation. */
export function withoutEstimateFields<T extends object>(patch: T): Omit<T, "estNo" | "estSuffix"> {
  const out = { ...patch } as Record<string, unknown>;
  delete out.estNo;
  delete out.estSuffix;
  return out as Omit<T, "estNo" | "estSuffix">;
}
