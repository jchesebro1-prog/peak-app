/**
 * Venue history aggregator (D101) — SERVER ONLY.
 *
 * Reads the PGlite-backed stores that carry venue references and builds a
 * unified reverse-chronological history for a venue, matching via the pure
 * helpers in ./venue-match (which resolve through docLocId, so migrated venues
 * are not silently empty). Leads carry no venue and are excluded.
 */
import type { SiteRow } from "@/db/schema";
import { getAllSites } from "@/lib/identity/sites";
import { getCompanies } from "@/lib/identity/companies";
import { getAll as getAllQuotes } from "@/lib/stores/quotes";
import { notesForSite } from "@/lib/stores/notes";
import {
  venueDocLocId,
  docMatchesVenue,
  quoteDeepLink,
  isOpenStage,
  sortHistoryDesc,
  type VenueHistoryRow,
} from "./venue-match";
import { displayQuoteNumber } from "@/lib/estimate-number";
import { listDocsFiltered } from "@/db/doc-store";
import type { CollectionName } from "@/db/doc-tables";

export type VenueDirRow = {
  site: SiteRow;
  companyName: string;
  city: string;
  lastActivity: number | null;
};

/** Jeff 2026-10-15 #11 — the directory reads only these fields of each record (a SQL projection), never whole
 *  quotes / jobs; the same stores the history below reads in full. */
type ActivityRow = { id: string; customerId?: string | null; locationId?: string | null; updatedAt?: number };
function activityRows(coll: CollectionName, fields: readonly string[]): Promise<ActivityRow[]> {
  return listDocsFiltered<ActivityRow>(coll, { fields });
}
const AT = ["customerId", "locationId", "updatedAt"] as const;

/**
 * Every venue with its owning company, city, and last-activity timestamp.
 * Loads each store once and buckets activity by `${customerId}|${locationId}`,
 * so the directory is a single pass over the data.
 */
export async function loadVenueDirectory(): Promise<VenueDirRow[]> {
  const [sites, quotes] =
    await Promise.all([
      getAllSites(),
      activityRows("quotes", AT),
    ]);

  // Bucket the latest activity ts per `${customerId}|${locationId}`.
  const latest = new Map<string, number>();
  const bump = (customerId: string | null | undefined, locationId: string | null | undefined, ts: number) => {
    if (!customerId || !locationId || !ts) return;
    const k = customerId + "|" + locationId;
    const cur = latest.get(k) ?? 0;
    if (ts > cur) latest.set(k, ts);
  };
  for (const r of quotes) bump(r.customerId, r.locationId, Number(r.updatedAt) || 0);

  /* Company names in ONE query (punch #91). This used to await getCompany()
     inside the site loop — memoized per company, so "only" one serialized
     round trip per DISTINCT company, which is still ~1,700 of them against
     the real directory and made this page take >10s. */
  const companyRows = await getCompanies(
    Array.from(new Set(sites.map((s) => s.companyId).filter(Boolean)))
  );
  const rows: VenueDirRow[] = [];
  for (const site of sites) {
    const name = companyRows.get(site.companyId)?.name ?? site.companyId;
    const key = site.companyId + "|" + venueDocLocId(site);
    rows.push({
      site,
      companyName: name,
      city: site.city ?? "",
      lastActivity: latest.get(key) ?? null,
    });
  }
  return rows;
}

/** The full reverse-chronological history for one venue, across all stores. */
export async function loadVenueHistory(site: SiteRow): Promise<VenueHistoryRow[]> {
  const companyId = site.companyId;
  const locId = venueDocLocId(site);

  const [quotes, notes] =
    await Promise.all([
      getAllQuotes(),
      // #323 — notes filed on this venue (sites.id), e.g. a meeting to-do decided "note"
      notesForSite(site.id).catch((e: unknown) => {
        console.error("[venue-history] notes read failed —", (e as Error)?.message || e);
        return [];
      }),
    ]);

  const rows: VenueHistoryRow[] = [];

  for (const q of quotes.filter((r) => docMatchesVenue(r, companyId, locId))) {
    rows.push({
      id: q.id, kind: "quote", title: q.name || displayQuoteNumber(q), subtitle: "Quote",
      ts: q.updatedAt, status: q.status, open: isOpenStage("quote", q.status),
      href: quoteDeepLink(q.quoteType ?? "", q.id), // quoteType is optional; "" → Estimator
    });
  }
  for (const n of notes) {
    const firstLine = n.text.split("\n").map((l) => l.trim()).find(Boolean) || "Note";
    rows.push({
      id: n.id, kind: "note", title: firstLine.length > 120 ? firstLine.slice(0, 119) + "…" : firstLine,
      subtitle: n.by ? `Note · ${n.by}` : "Note",
      ts: n.at, status: "note", open: false,
      href: "/companies/" + encodeURIComponent(companyId),
    });
  }

  return sortHistoryDesc(rows);
}
