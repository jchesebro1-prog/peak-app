import { get as getCustomer } from "@/lib/stores/customers";
import { getAll as getAllFlameJobs, type FlameJob, type FlameJobVenue } from "@/lib/stores/flame-jobs";
import {
  completedAtOf,
  getAll as getAllInspections,
  type InspectionRecord,
} from "@/lib/stores/inspections";
import { getAll as getAllQuotes, type Quote } from "@/lib/stores/quotes";

/**
 * Portal service quotes (#248 Task 1) — scope pre-fill: each of the
 * customer's venues gets a curtain/line-set count guessed from its history,
 * in the renewal-outreach source order (src/lib/renewal-outreach.ts
 * ensureFlameRenewalQuote / ensureInspectionRenewalQuote): the venue's latest
 * COMPLETED flame job / inspection record (inspection: same level) wins;
 * failing that, the venue's latest quote of that type; failing that, no
 * guess — the customer types it. Read-only; nothing here writes.
 */

export type PortalService = { kind: "flame" } | { kind: "inspection"; level: 1 | 2 };

export type VenueScope = {
  venueId: string;
  label: string;
  count: number | null;
  source: "job" | "quote" | null;
  sourceYear: number | null;
};

/** Minimal structural view of a saved flame-test quote subdoc. */
type FlameSubdocLike = { venues?: Array<{ id?: string | null; curtains?: number }> };
/** Minimal structural view of a saved inspection quote subdoc. */
type InspectionSubdocLike = {
  level?: number | string;
  venues?: Array<{ id?: string | null; lineSets?: number }>;
};

/**
 * Pure: job wins over quote, else no guess. `at` is an epoch-ms timestamp —
 * `sourceYear` is derived from it here so callers never have to.
 */
export function pickScopeCount(input: {
  job?: { count: number; at: number } | null;
  quote?: { count: number; at: number } | null;
}): { count: number | null; source: "job" | "quote" | null; sourceYear: number | null } {
  const pick = input.job ? { ...input.job, source: "job" as const } : input.quote ? { ...input.quote, source: "quote" as const } : null;
  if (!pick) return { count: null, source: null, sourceYear: null };
  return { count: pick.count, source: pick.source, sourceYear: new Date(pick.at).getFullYear() };
}

/** The latest completed flame job covering this venue (across possibly
 *  multi-venue jobs), else null. Falls back to the whole job's
 *  `curtainsTotal` only if the matched venue row itself has no `curtains`
 *  (a malformed row) — a normal row always has one, so this is a defensive
 *  fallback, not a "venue not found" case (a job is only ever selected as
 *  `best` because its venues array DID contain this venue). */
function latestFlameJobFor(jobs: FlameJob[], venueId: string): { count: number; at: number } | null {
  let best: FlameJob | null = null;
  let bestVenue: FlameJobVenue | null = null;
  for (const j of jobs) {
    const jv = (j.venues || []).find((v) => v.id === venueId);
    if (!jv) continue;
    if (!best || (j.completedAt || 0) > (best.completedAt || 0)) {
      best = j;
      bestVenue = jv;
    }
  }
  if (!best) return null;
  const count = bestVenue?.curtains ?? best.curtainsTotal;
  return { count: Number(count) || 0, at: best.completedAt || 0 };
}

/** The latest completed inspection record AT this venue (records are
 *  per-venue, D53) — callers have already filtered to the wanted level. */
function latestInspectionRecordFor(
  recs: InspectionRecord[],
  venueId: string
): { count: number; at: number } | null {
  let best: InspectionRecord | null = null;
  let bestAt = 0;
  for (const r of recs) {
    if (r.locationId !== venueId) continue;
    const at = completedAtOf(r) || 0;
    if (!best || at > bestAt) {
      best = r;
      bestAt = at;
    }
  }
  return best ? { count: Number(best.lineSets) || 0, at: bestAt } : null;
}

/** The latest matching quote of `quoteType` whose subdoc lists this venue. */
function latestQuoteFor(
  quotes: Quote[],
  service: PortalService,
  venueId: string
): { count: number; at: number } | null {
  let best: Quote | null = null;
  let bestCount = 0;
  for (const q of quotes) {
    const sub =
      service.kind === "flame"
        ? (q.flameTest as FlameSubdocLike | undefined)
        : (q.inspection as InspectionSubdocLike | undefined);
    if (!sub || !Array.isArray(sub.venues)) continue;
    if (service.kind === "inspection" && Number((sub as InspectionSubdocLike).level) !== service.level) continue;
    const row = sub.venues.find((v) => v.id === venueId);
    if (!row) continue;
    const count = service.kind === "flame" ? (row as { curtains?: number }).curtains : (row as { lineSets?: number }).lineSets;
    if (typeof count !== "number") continue;
    if (!best || (q.createdAt || 0) > (best.createdAt || 0)) {
      best = q;
      bestCount = count;
    }
  }
  return best ? { count: bestCount, at: best.createdAt || 0 } : null;
}

/** One entry per customer venue, in the customer's own location order. */
export async function serviceScopeFor(customerId: string, service: PortalService): Promise<VenueScope[]> {
  const cust = await getCustomer(customerId);
  const venues = (cust?.locations || []).filter((l) => !!l.id);
  if (!venues.length) return [];

  const quoteType = service.kind === "flame" ? "flame_test" : "inspection";
  const [allQuotes, jobs, recs] = await Promise.all([
    getAllQuotes(),
    service.kind === "flame" ? getAllFlameJobs() : Promise.resolve<FlameJob[]>([]),
    service.kind === "inspection" ? getAllInspections() : Promise.resolve<InspectionRecord[]>([]),
  ]);
  const matchingQuotes = allQuotes.filter((q) => q.quoteType === quoteType && q.customerId === customerId);
  const completedJobs =
    service.kind === "flame" ? jobs.filter((j) => j.customerId === customerId && j.stage === "completed") : [];
  // Number(r.level) === service.level (never levelMeta(r.level).key): levelMeta
  // has a lenient DISPLAY fallback — an unmatched/missing level defaults to
  // Level 1 — which would wrongly count a record with NO level as an L1 match.
  const completedRecs =
    service.kind === "inspection"
      ? recs.filter((r) => r.customerId === customerId && r.stage === "completed" && Number(r.level) === service.level)
      : [];

  return venues.map((loc) => {
    const venueId = loc.id as string;
    const job =
      service.kind === "flame" ? latestFlameJobFor(completedJobs, venueId) : latestInspectionRecordFor(completedRecs, venueId);
    const quote = job ? null : latestQuoteFor(matchingQuotes, service, venueId);
    const picked = pickScopeCount({ job, quote });
    return { venueId, label: loc.label || loc.locationName || "Venue", ...picked };
  });
}
