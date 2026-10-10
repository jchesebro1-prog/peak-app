/**
 * #323 — builds the matcher's MatchIndex from the live stores. Server-only
 * (DB): never import from a "use client" module (pinned in
 * scripts/test-meetings-323.ts — the repo has no `server-only` package).
 *
 * Doc records (site visits, surveys, recordings) carry a venue as the
 * per-company doc location id (`docLocId`: a migrated venue's legacyLocId,
 * else the site's own id); the matcher works in `sites.id`, so every such
 * reference goes through `${companyId}|${locationId}` → site id here.
 */
import { and, eq, or } from "drizzle-orm";
import { getDb } from "@/db";
import { contactEmails, customerDomains, sites as sitesTable } from "@/db/schema";
import { allCompanies } from "@/lib/identity/companies";
import { allContacts } from "@/lib/identity/contacts";
import { docLocId, getAllSites } from "@/lib/identity/sites";
import { activeUsers } from "@/lib/users";
import { allVisits } from "@/lib/stores/site-visits";
import { getAll as allSurveys } from "@/lib/stores/surveys";
import { open as openLeads } from "@/lib/stores/leads";
import { getAllProjects } from "@/lib/stores/projects";
import { isActive } from "@/lib/pipelines";
import { allEngagements } from "@/lib/stores/engagements";
import { OPEN_ENGAGEMENT_STAGES } from "@/lib/consulting-stages";
import { getSettings } from "@/lib/settings";
import { venueTypesFrom } from "@/lib/venue-types";
import { chicagoDayRange } from "./chicago-day";
import { prepareMatchIndex, type MatchIndex, type MatchVisit, type MatchWork } from "./match";

/** Same rule as the inbox's INTERNAL_DOMAIN (lib/inbox-identity). */
const INTERNAL_DOMAINS = ["peaksystemsgroup.com"];
const DEFAULT_VISIT_MS = 2 * 3600_000;

export async function buildMatchIndex(): Promise<MatchIndex> {
  const db = await getDb();
  const [companies, sites, contacts, users, visits, surveys, leads, projects, engagements, emailRows, domainRows, settings] = await Promise.all([
    allCompanies(), getAllSites(), allContacts(), activeUsers(), allVisits(), allSurveys(), openLeads(), getAllProjects(), allEngagements(),
    db.select({ contactId: contactEmails.contactId, email: contactEmails.email }).from(contactEmails),
    db.select({ domain: customerDomains.domain, customerId: customerDomains.customerId }).from(customerDomains),
    // the venue-type labels ("Gym Stage", "Black box"…) are the type half of every derived venue name
    getSettings().catch(() => null),
  ]);
  const liveCompany = new Set(companies.map((c) => c.id));

  const siteByDocLoc = new Map<string, string>();
  for (const s of sites) {
    siteByDocLoc.set(`${s.companyId}|${s.id}`, s.id);
    siteByDocLoc.set(`${s.companyId}|${docLocId(s)}`, s.id);
  }
  const siteFor = (companyId: string | null, locationId: string | null) =>
    companyId && locationId ? siteByDocLoc.get(`${companyId}|${locationId}`) ?? null : null;

  // records name their assignee by team-member NAME (app convention)
  const userIdByName = new Map(users.map((u) => [u.name.trim().toLowerCase(), u.id]));
  const assignee = (name: string | null | undefined) => userIdByName.get((name || "").trim().toLowerCase()) ?? null;

  const mv: MatchVisit[] = [];
  for (const v of visits) {
    if (v.startAt == null) continue;
    mv.push({
      kind: "site_visit", id: v.id, label: `Site visit ${v.id}`, companyId: v.customerId, siteId: siteFor(v.customerId, v.locationId),
      startMs: v.startAt, endMs: v.endAt != null && v.endAt > v.startAt ? v.endAt : v.startAt + DEFAULT_VISIT_MS,
      assigneeUserId: assignee(v.assignedTo),
    });
  }
  for (const s of surveys) {
    const day = chicagoDayRange(s.scheduledDate);
    if (!day) continue;
    mv.push({
      kind: "survey", id: s.id, label: `Survey ${s.id}`, companyId: s.customerId, siteId: siteFor(s.customerId, s.locationId),
      startMs: day[0], endMs: day[1], assigneeUserId: assignee(s.assignedTo),
    });
  }

  const work: MatchWork[] = [];
  for (const l of leads) if (l.customerId) work.push({ type: "lead", id: l.id, label: l.org || l.id, companyId: l.customerId });
  for (const p of projects) if (p.customerId && isActive(p)) work.push({ type: "project", id: p.id, label: p.name || p.id, companyId: p.customerId });
  for (const e of engagements) {
    if (e.companyId && OPEN_ENGAGEMENT_STAGES.includes(e.status)) work.push({ type: "engagement", id: e.id, label: e.name || e.id, companyId: e.companyId });
  }

  const emailsByContact = new Map<string, string[]>();
  for (const r of emailRows) {
    const e = (r.email || "").trim().toLowerCase();
    if (!e) continue;
    emailsByContact.set(r.contactId, [...(emailsByContact.get(r.contactId) || []), e]);
  }

  const domainCompanies: Record<string, string[]> = {};
  for (const r of domainRows) {
    const d = (r.domain || "").trim().toLowerCase();
    if (!d || !liveCompany.has(r.customerId)) continue;
    const list = (domainCompanies[d] ||= []);
    if (!list.includes(r.customerId)) list.push(r.customerId);
  }

  // cores (company + venue, venue-type words stripped) are computed here once, not per meeting
  return prepareMatchIndex({
    companies: companies.map((c) => ({ id: c.id, name: c.name, keywords: Array.isArray(c.keywords) ? c.keywords : [] })),
    sites: sites.map((s) => ({ id: s.id, companyId: s.companyId, name: s.name, locationName: s.locationName })),
    contacts: contacts.map((c) => ({
      id: c.id, companyId: c.homeCompanyId, firstName: c.firstName || "", lastName: c.lastName || "", emails: emailsByContact.get(c.id) || [],
    })),
    users: users.map((u) => ({
      id: u.id, name: u.name, emails: [u.email, u.googleEmail].filter((e): e is string => !!e).map((e) => e.toLowerCase()),
    })),
    internalDomains: INTERNAL_DOMAINS,
    domainCompanies,
    visits: mv,
    openWork: work,
  }, venueTypesFrom(settings?.venueTypes).map((t) => t.label));
}

/** A doc record's `(customerId, locationId)` → `sites.id`, scoped to the company
 *  (legacy ids like 'loc1' repeat across companies). Without a company only a
 *  real site id resolves. */
export async function siteIdForDocLoc(customerId: string | null, locationId: string | null): Promise<string | null> {
  if (!locationId) return null;
  const db = await getDb();
  const rows = await db
    .select({ id: sitesTable.id })
    .from(sitesTable)
    .where(
      customerId
        ? and(eq(sitesTable.deleted, false), eq(sitesTable.companyId, customerId),
            or(eq(sitesTable.legacyLocId, locationId), eq(sitesTable.id, locationId)))
        : and(eq(sitesTable.deleted, false), eq(sitesTable.id, locationId))
    )
    .limit(1);
  return rows[0]?.id ?? null;
}
