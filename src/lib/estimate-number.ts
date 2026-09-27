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
 * Returns null for anything else, including old internal ids (`Q-2041`: a
 * one-letter prefix is not an estimate prefix) and unknown prefixes.
 */
export function parseEstimateNumber(raw: string | null | undefined): ParsedEstimateNumber | null {
  const s = String(raw ?? "").trim().toUpperCase().replace(/^#\s*/, "");
  const m = /^(?:([A-Z]{3})[\s\-_#.]*)?(\d{1,9})(?:[\s\-_./]+(\d{1,3}))?$/.exec(s);
  if (!m) return null;
  const prefix = m[1] ?? null;
  if (prefix !== null && !KNOWN_PREFIXES.has(prefix)) return null;
  const estNo = Number(m[2]);
  if (!isEstimateNo(estNo)) return null;
  const suffixNum = m[3] ? Number(m[3]) : null;
  return { estNo, suffix: suffixNum !== null && suffixNum >= 2 ? suffixNum : null, prefix };
}

/** A parsed number names this quote: same counter value, and — when typed —
 *  the same prefix and suffix. A bare `1005` matches `EST-1005` and `EST-1005-2`. */
export function quoteNumberMatches(q: QuoteNumberFields, p: ParsedEstimateNumber): boolean {
  if (!isEstimateNo(q.estNo) || q.estNo !== p.estNo) return false;
  if (p.prefix !== null && p.prefix !== prefixForQuoteType(q.quoteType)) return false;
  if (p.suffix !== null && (isEstimateNo(q.estSuffix) ? q.estSuffix : null) !== p.suffix) return false;
  return true;
}

/** A parsed number names this lead: same counter value; prefix OPP or none; no suffix. */
export function leadNumberMatches(l: LeadNumberFields, p: ParsedEstimateNumber): boolean {
  if (!isEstimateNo(l.estNo) || l.estNo !== p.estNo) return false;
  if (p.prefix !== null && p.prefix !== ESTIMATE_PREFIX.opportunity) return false;
  return p.suffix === null;
}

/**
 * The one quote search rule (quotes hub `?q=`, ⌘K): a typed estimate number
 * (exact, via parseEstimateNumber), or a case-insensitive substring of the
 * displayed number, the OLD internal id, the name or the customer — so
 * "Q-2041" still finds the quote it always found.
 */
export function quoteMatchesSearch(
  q: QuoteNumberFields & { id: string; name?: string | null; customer?: string | null },
  term: string
): boolean {
  const t = term.trim().toLowerCase();
  if (!t) return true;
  const parsed = parseEstimateNumber(t);
  if (parsed && quoteNumberMatches(q, parsed)) return true;
  // A typed prefix that isn't this quote's type rules it out ("EST-1005" never
  // finds FLM-1005). Otherwise fall through, so partial typing ("flm-10" →
  // parses as FLM + 10) still finds FLM-1005 as a substring.
  if (parsed && parsed.prefix !== null && parsed.prefix !== prefixForQuoteType(q.quoteType)) return false;
  return [q.id, formatQuoteNumber(q), q.name, q.customer].some(
    (f) => typeof f === "string" && f.toLowerCase().includes(t)
  );
}

/** A store patch minus the allocated number — numbers never change after allocation. */
export function withoutEstimateFields<T extends object>(patch: T): Omit<T, "estNo" | "estSuffix"> {
  const out = { ...patch } as Record<string, unknown>;
  delete out.estNo;
  delete out.estSuffix;
  return out as Omit<T, "estNo" | "estSuffix">;
}
