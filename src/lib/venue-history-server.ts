/**
 * Venue history aggregator (D101) — SERVER ONLY.
 *
 * Reads the eight PGlite-backed stores that carry venue references and builds a
 * unified reverse-chronological history for a venue, matching via the pure
 * helpers in ./venue-match (which resolve through docLocId, so migrated venues
 * are not silently empty). Leads carry no venue and are excluded.
 */
import type { SiteRow } from "@/db/schema";
import { getAllSites } from "@/lib/identity/sites";
import { getCompany } from "@/lib/identity/companies";
import { getAll as getAllQuotes } from "@/lib/stores/quotes";
import { getAllProjects } from "@/lib/stores/projects";
import { allEngagements } from "@/lib/stores/engagements";
import { getAll as getAllFlame } from "@/lib/stores/flame-jobs";
import { getAll as getAllInspections } from "@/lib/stores/inspections";
import { getAll as getAllRepairs } from "@/lib/stores/repair-jobs";
import { getAll as getAllSurveys } from "@/lib/stores/surveys";
import { allVisits } from "@/lib/stores/site-visits";
import {
  venueDocLocId,
  docMatchesVenue,
  engagementMatchesVenue,
  quoteDeepLink,
  isOpenStage,
  sortHistoryDesc,
  type VenueHistoryRow,
} from "./venue-match";

export type VenueDirRow = {
  site: SiteRow;
  companyName: string;
  city: string;
  lastActivity: number | null;
};

/**
 * Every venue with its owning company, city, and last-activity timestamp.
 * Loads each store once and buckets activity by `${customerId}|${locationId}`,
 * so the directory is a single pass over the data.
 */
export async function loadVenueDirectory(): Promise<VenueDirRow[]> {
  const [sites, quotes, projects, engagements, flame, inspections, repairs, surveys, visits] =
    await Promise.all([
      getAllSites(),
      getAllQuotes(),
      getAllProjects(),
      allEngagements(),
      getAllFlame(),
      getAllInspections(),
      getAllRepairs(),
      getAllSurveys(),
      allVisits(),
    ]);

  // Bucket the latest activity ts per `${customerId}|${locationId}`.
  const latest = new Map<string, number>();
  const bump = (customerId: string | null | undefined, locationId: string | null | undefined, ts: number) => {
    if (!customerId || !locationId || !ts) return;
    const k = customerId + "|" + locationId;
    const cur = latest.get(k) ?? 0;
    if (ts > cur) latest.set(k, ts);
  };
  for (const q of quotes) bump(q.customerId, q.locationId, q.updatedAt);
  for (const p of projects) bump(p.customerId, p.locationId, p.updatedAt);
  for (const j of flame) bump(j.customerId, j.locationId, j.updatedAt);
  for (const r of inspections) bump(r.customerId, r.locationId, r.updatedAt);
  for (const r of repairs) bump(r.customerId, r.locationId, r.updatedAt);
  for (const s of surveys) bump(s.customerId, s.locationId, s.updatedAt);
  for (const v of visits) bump(v.customerId, v.locationId, v.startAt);
  // Engagements use companyId + siteIds (docLocId values), not customerId/locationId.
  for (const e of engagements) {
    if (!e.companyId) continue;
    for (const sid of e.siteIds ?? []) bump(e.companyId, sid, e.updatedAt);
  }

  const companyName = new Map<string, string>();
  const rows: VenueDirRow[] = [];
  for (const site of sites) {
    let name = companyName.get(site.companyId);
    if (name === undefined) {
      const co = await getCompany(site.companyId);
      name = co?.name ?? site.companyId;
      companyName.set(site.companyId, name);
    }
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

  const [quotes, projects, engagements, flame, inspections, repairs, surveys, visits] =
    await Promise.all([
      getAllQuotes(),
      getAllProjects(),
      allEngagements(),
      getAllFlame(),
      getAllInspections(),
      getAllRepairs(),
      getAllSurveys(),
      allVisits(),
    ]);

  const rows: VenueHistoryRow[] = [];

  for (const q of quotes.filter((r) => docMatchesVenue(r, companyId, locId))) {
    rows.push({
      id: q.id, kind: "quote", title: q.name || q.id, subtitle: "Quote",
      ts: q.updatedAt, status: q.status, open: isOpenStage("quote", q.status),
      href: quoteDeepLink(q.quoteType ?? "", q.id), // quoteType is optional; "" → Estimator
    });
  }
  for (const p of projects.filter((r) => docMatchesVenue(r, companyId, locId))) {
    rows.push({
      id: p.id, kind: "project", title: p.name || p.id, subtitle: "Project",
      ts: p.updatedAt, status: p.stage, open: isOpenStage("project", p.stage),
      href: "/projects?id=" + encodeURIComponent(p.id),
    });
  }
  for (const e of engagements.filter((r) => engagementMatchesVenue(r, companyId, locId))) {
    rows.push({
      id: e.id, kind: "engagement", title: e.name || e.id, subtitle: "Engagement",
      ts: e.updatedAt, status: e.status, open: isOpenStage("engagement", e.status),
      href: "/design/engagements/" + encodeURIComponent(e.id),
    });
  }
  for (const j of flame.filter((r) => docMatchesVenue(r, companyId, locId))) {
    rows.push({
      id: j.id, kind: "flame", title: j.venue || j.customer || j.id, subtitle: "Flame test",
      ts: j.updatedAt, status: j.stage, open: isOpenStage("flame", j.stage),
      href: "/flame-tests/results?job=" + encodeURIComponent(j.id),
    });
  }
  for (const r of inspections.filter((x) => docMatchesVenue(x, companyId, locId))) {
    rows.push({
      id: r.id, kind: "inspection", title: r.venue || r.customer || r.id, subtitle: "Rigging inspection",
      ts: r.updatedAt, status: r.stage, open: isOpenStage("inspection", r.stage),
      href: "/inspections/" + encodeURIComponent(r.id),
    });
  }
  for (const j of repairs.filter((r) => docMatchesVenue(r, companyId, locId))) {
    rows.push({
      id: j.id, kind: "repair", title: j.title || j.venue || j.id, subtitle: "Repair",
      ts: j.updatedAt, status: j.stage, open: isOpenStage("repair", j.stage),
      href: "/repairs/results?job=" + encodeURIComponent(j.id),
    });
  }
  for (const s of surveys.filter((r) => docMatchesVenue(r, companyId, locId))) {
    rows.push({
      id: s.id, kind: "survey", title: s.venue || s.venueType || s.id, subtitle: "Field survey",
      ts: s.updatedAt, status: s.stage, open: isOpenStage("survey", s.stage),
      href: "/field-survey?id=" + encodeURIComponent(s.id),
    });
  }
  const now = Date.now();
  for (const v of visits.filter((r) => docMatchesVenue(r, companyId, locId))) {
    rows.push({
      id: v.id, kind: "visit", title: v.reason || v.venue || v.id, subtitle: "Site visit",
      ts: v.startAt, status: v.startAt >= now ? "upcoming" : "past", open: v.startAt >= now,
      href: v.engagementId ? "/design/engagements/" + encodeURIComponent(v.engagementId) : "/calendar",
    });
  }

  return sortHistoryDesc(rows);
}
