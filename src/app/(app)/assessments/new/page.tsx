import Link from "next/link";
import { requirePerm } from "@/lib/session";
import { ASSESSMENT_DEF, VISIT_TYPES } from "@/lib/assessments/defs";
import { allCompanies, getCompany } from "@/lib/identity/companies";
import { docLocId, getSite, sitesForCompany } from "@/lib/identity/sites";
import { getVisit } from "@/lib/stores/site-visits";
import { activeUsers } from "@/lib/users";
import type { NewAssessmentPrefill } from "../types";
import NewAssessmentForm from "./controls";

export const metadata = { title: "New assessment — Quartzite-6" };

function one(v: string | string[] | undefined): string {
  return (Array.isArray(v) ? v[0] ?? "" : v ?? "").trim().slice(0, 120);
}

/** Today in Chicago as YYYY-MM-DD (the visit date default). */
function chicagoToday(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Chicago", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

const SEARCH_MAX = 25;

/**
 * Start an assessment (#337, spec §2 "Starting"): customer → venue → space → visit type → scopes → date → assessor.
 * Pre-fills from ?company=, ?site=, ?visit= (the site visit's customer and venue), ?lead= and ?project=. Without a
 * customer it shows a name search; picking one reloads with ?company= so the venues load server-side.
 */
export default async function NewAssessmentPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const [user, sp] = await Promise.all([requirePerm("create"), searchParams]);
  let companyId = one(sp.company);
  let siteId = one(sp.site);
  const visitId = one(sp.visit);
  const leadId = one(sp.lead);
  const projectId = one(sp.project);
  const q = one(sp.q);

  let visitNote = "";
  if (visitId) {
    const v = await getVisit(visitId);
    if (!v) visitNote = `Site visit ${visitId} wasn't found.`;
    else {
      // A doc location id is the venue's legacyLocId ('loc1', shared across companies) or its own sites.id, so it
      // only means something inside the visit's customer.
      if (v.customerId) {
        companyId = v.customerId;
        const site = v.locationId ? (await sitesForCompany(v.customerId)).find((s) => docLocId(s) === v.locationId || s.id === v.locationId) : undefined;
        if (site) siteId = site.id;
      }
    }
  }
  if (siteId && !companyId) {
    const s = await getSite(siteId);
    if (s) companyId = s.companyId;
  }

  const company = companyId ? await getCompany(companyId) : null;
  const [sites, users] = await Promise.all([company ? sitesForCompany(company.id) : Promise.resolve([]), activeUsers()]);
  const passThrough = (extra: Record<string, string>) => {
    const u = new URLSearchParams();
    for (const [k, v] of Object.entries({ lead: leadId, project: projectId, ...extra })) if (v) u.set(k, v);
    return `/assessments/new?${u.toString()}`;
  };

  let matches: { id: string; name: string }[] = [];
  if (!company && q) {
    const ql = q.toLowerCase();
    matches = (await allCompanies()).filter((c) => (c.name || "").toLowerCase().includes(ql)).slice(0, SEARCH_MAX).map((c) => ({ id: c.id, name: c.name }));
  }

  const vt = VISIT_TYPES[0];
  const prefill: NewAssessmentPrefill = {
    company: company ? { id: company.id, name: company.name } : null,
    sites: sites.map((s) => ({ id: s.id, name: s.name || s.locationName || s.id })),
    siteId: sites.some((s) => s.id === siteId) ? siteId : "",
    leadId, visitId: visitNote ? "" : visitId, projectId,
    visitDate: chicagoToday(),
    users: users.map((u) => ({ id: u.id, name: u.name })),
    meId: user.id,
    scopes: ASSESSMENT_DEF.scopes.map((s) => ({
      code: s.code,
      title: s.title,
      on: s.code === "S0" || !!vt.scopes.find((x) => x.code === s.code)?.on,
      // Slice 1: Rigging is screened only.
      depths: s.depths?.length ? ["screen"] : [],
    })),
    visitTypes: VISIT_TYPES.map((v) => ({ key: v.key, title: v.title })),
  };

  return (
    <div className="pk-content" style={{ maxWidth: 760 }}>
      <Link href="/assessments" style={{ fontSize: 12, color: "#8c919c", textDecoration: "none" }}>← Assessments</Link>
      <div style={{ fontSize: 23, fontWeight: 600, letterSpacing: "-.015em", margin: "4px 0 16px" }}>New assessment</div>
      {visitNote && <div style={{ fontSize: 13, color: "#8c3b26", marginBottom: 10 }}>{visitNote}</div>}

      <div className="pk-card" style={{ padding: "14px 20px", marginBottom: 14, maxWidth: 640 }}>
        <div className="pk-field-label">Customer</div>
        {company ? (
          <div style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 14 }}>
            <b>{company.name}</b>
            <Link href={passThrough({})} style={{ fontSize: 12, color: "var(--accent)", textDecoration: "none" }}>change</Link>
          </div>
        ) : (
          <>
            <form method="get" action="/assessments/new" style={{ display: "flex", gap: 8 }}>
              {leadId && <input type="hidden" name="lead" value={leadId} />}
              {projectId && <input type="hidden" name="project" value={projectId} />}
              <input className="pk-input" name="q" defaultValue={q} placeholder="Search customers by name" autoFocus />
              <button type="submit" className="pk-btn-outline" style={{ padding: "0 14px" }}>Search</button>
            </form>
            {q && (
              <div style={{ marginTop: 8, display: "grid", gap: 2 }}>
                {matches.map((m) => (
                  <Link key={m.id} href={passThrough({ company: m.id })} style={{ fontSize: 13.5, color: "#24272e", textDecoration: "none", padding: "6px 4px", borderBottom: "1px solid #f2f3f6" }}>
                    {m.name}
                  </Link>
                ))}
                {matches.length === 0 && <div style={{ fontSize: 13, color: "#8c919c" }}>No customers match “{q}”.</div>}
                {matches.length === SEARCH_MAX && <div style={{ fontSize: 12, color: "#8c919c" }}>Showing the first {SEARCH_MAX}. Type more of the name to narrow it.</div>}
              </div>
            )}
          </>
        )}
      </div>

      {company && <NewAssessmentForm p={prefill} />}
    </div>
  );
}
