/* Assessments engine (#340, Task 9) — "Quote these findings", the pure half: the selection rule (one customer, one
   venue), the finding keys a URL or form carries, the repair builder's pre-fill (category / priority / scope /
   notes / source) and the Estimator system built from findings (zero-priced lines the estimator prices). No db /
   next imports — the server half is quote-from-findings.ts. */
import { SYSTEM_PRICE_STEP } from "@/app/(app)/estimator/pricing";
import type { SpecItem, SpecSection } from "@/app/(app)/estimator/types";
import type { Category } from "./defs/types";
import type { Finding } from "./findings-model";
import { findingLabel } from "./register";

/** A finding key: fd_ + 16 lowercase letters or digits (the store's rule). */
export const FINDING_KEY_RE = /^fd_[a-z0-9]{16}$/;
/** The most findings one quote is built from (keeps the builder URL well under any length limit). */
export const QUOTE_FINDINGS_MAX = 100;

export const ONE_VENUE_ERROR = "Pick findings from one venue";

/** Comma-separated (or listed) finding keys → the valid ones, de-duplicated, first-seen order, capped. */
export function parseFindingKeys(raw: unknown): string[] {
  const parts = Array.isArray(raw) ? raw : typeof raw === "string" ? raw.split(",") : [];
  const out: string[] = [];
  for (const p of parts) {
    if (typeof p !== "string") continue;
    const k = p.trim();
    if (FINDING_KEY_RE.test(k) && !out.includes(k)) out.push(k);
    if (out.length >= QUOTE_FINDINGS_MAX) break;
  }
  return out;
}

type Pickable = Pick<Finding, "key" | "customerId" | "siteId"> & { voided?: unknown };

/** Why these findings can't be quoted together (null when they can): at least one, none voided, one customer and
 *  one venue. */
export function quoteSelectionProblem(list: Pickable[]): string | null {
  if (!list.length) return "Choose the findings to quote.";
  if (list.length > QUOTE_FINDINGS_MAX) return `Quote at most ${QUOTE_FINDINGS_MAX} findings at a time.`;
  if (list.some((f) => f.voided)) return "A voided finding can't be quoted.";
  if (new Set(list.map((f) => f.customerId)).size !== 1 || new Set(list.map((f) => f.siteId)).size !== 1) return ONE_VENUE_ERROR;
  return null;
}

/** Finding category → the repair builder's category key. */
export const REPAIR_CATEGORY: Record<Category, string> = { RIG: "rigging", ELC: "electrics", STR: "structural", HAZ: "other", GEN: "other" };

/** The most common repair category among the findings; a tie goes to the one that appears first. */
export function repairCategoryFor(cats: Category[]): string {
  const counts = new Map<string, number>();
  for (const c of cats) {
    const k = REPAIR_CATEGORY[c] ?? "other";
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  let best = "other";
  let n = 0;
  for (const [k, v] of counts) if (v > n) { best = k; n = v; }
  return best;
}

/** One line of text for a finding: "<printedId> — <description>", whitespace collapsed, capped at `max`. */
export function findingLineText(f: Pick<Finding, "printedId" | "companyCode" | "siteCode" | "category" | "description">, max = 240): string {
  const s = `${findingLabel(f)} — ${(f.description ?? "").replace(/\s+/g, " ").trim()}`;
  return s.length > max ? s.slice(0, max - 1).trimEnd() + "…" : s;
}

/** "Assessment findings MPSD-LIN-RIG-001, …" — at most 10 ids, then "+ N more". */
export function findingsSourceLabel(list: Pick<Finding, "printedId" | "companyCode" | "siteCode" | "category">[]): string {
  const ids = list.map(findingLabel);
  const head = ids.slice(0, 10).join(", ");
  return `Assessment findings ${head}${ids.length > 10 ? ` + ${ids.length - 10} more` : ""}`;
}

export interface RepairPrefill {
  quoteName: string;
  category: string;
  priority: "urgent" | "standard";
  scopeItems: string[];
  notes: string;
  source: { kind: "direct"; label: string };
  findingKeys: string[];
}

type Quotable = Pick<Finding, "key" | "printedId" | "companyCode" | "siteCode" | "category" | "description" | "rating" | "recommendedAction">;

/**
 * The repair builder's intake from findings (controller: the builder prices it, nothing is created here):
 * one scope item per finding, the notes are each finding's recommended action, the category is the most common
 * mapped one, the priority is urgent when any finding needs immediate attention (else standard), and the source
 * is a direct one labelled with the printed ids.
 */
export function repairPrefillFromFindings(list: Quotable[], venueName: string): RepairPrefill {
  return {
    quoteName: `Repairs — ${venueName}`,
    category: repairCategoryFor(list.map((f) => f.category)),
    priority: list.some((f) => f.rating === "immediate") ? "urgent" : "standard",
    scopeItems: list.map((f) => findingLineText(f)),
    notes: list
      .filter((f) => typeof f.recommendedAction === "string" && f.recommendedAction.trim())
      .map((f) => `${findingLabel(f)}: ${f.recommendedAction!.trim()}`)
      .join("\n"),
    source: { kind: "direct", label: findingsSourceLabel(list) },
    findingKeys: list.map((f) => f.key),
  };
}

/** The Estimator system for "Quote these findings → Estimator quote": one zero-priced custom line per finding
 *  ("<printedId> — <description>", qty 1, ea), the recommended action as the line's internal note. The estimator
 *  prices the lines; the shape matches the Estimator's own new-system path (priceRound, auto freight). */
export function findingsEstimatorSection(list: Quotable[], opts: { sectionId: string; venueName: string; freightPct: number }): SpecSection {
  const items: SpecItem[] = list.map((f, i) => ({
    id: i + 1,
    sku: "",
    desc: findingLineText(f),
    qty: 1,
    unit: "ea",
    cost: 0,
    price: 0,
    custom: true,
    ...(f.recommendedAction && f.recommendedAction.trim() ? { internalNote: `Recommended: ${f.recommendedAction.trim()}`.slice(0, 500) } : {}),
  }));
  return {
    id: opts.sectionId,
    name: `Assessment findings — ${opts.venueName}`.slice(0, 80),
    kind: "materials",
    mfr: "",
    freightPct: opts.freightPct,
    freightAuto: true,
    priceRound: SYSTEM_PRICE_STEP,
    items,
  };
}

/** The venue ids (location ids, as `docLocId` reads them) a quote is for: its own `locationId`, plus every venue a
 *  repair quote was saved with (`repair.venues[].id`; a repair quote's `locationId` is only its FIRST venue). */
export function quoteVenueIds(q: { locationId?: string | null; repair?: unknown }): string[] {
  const ids: string[] = [];
  if (typeof q.locationId === "string" && q.locationId) ids.push(q.locationId);
  const venues = (q.repair as { venues?: unknown } | null | undefined)?.venues;
  if (Array.isArray(venues)) {
    for (const v of venues) {
      const id = v && typeof v === "object" ? (v as { id?: unknown }).id : undefined;
      if (typeof id === "string" && id && !ids.includes(id)) ids.push(id);
    }
  }
  return ids;
}

/** Can a finding at venue `locId` link to this quote? A quote that names no venue at all can (as before); one that
 *  names venues must include this one, whether as its `locationId` or among a repair quote's venues. */
export function quoteCoversVenue(q: { locationId?: string | null; repair?: unknown }, locId: string): boolean {
  const ids = quoteVenueIds(q);
  return ids.length === 0 || ids.includes(locId);
}
