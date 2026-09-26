/**
 * #214 — the Link popup's one search box: companies, venues and people in
 * three groups of at most 8, ranked the way every other typeahead ranks
 * (typeaheadMatches). Pure — the server action loads the rows and calls
 * rankLinkTargets; test:specs covers the ranking.
 */
import { typeaheadMatches } from "@/lib/search/typeahead-rank";

export type LinkTargetKind = "company" | "venue" | "person";

export type LinkTargetHit = {
  kind: LinkTargetKind;
  /** company id · venue CustomerLocation id (what thread.siteId stores) · contact id */
  id: string;
  label: string;
  sub: string;
  /** the company a venue belongs to / a person's home company */
  companyId: string | null;
  companyName: string;
};

export type LinkTargetGroups = {
  companies: LinkTargetHit[];
  venues: LinkTargetHit[];
  people: LinkTargetHit[];
};

export const LINK_TARGET_MAX = 8;
export const LINK_TARGET_MIN_QUERY = 2;

export type CompanyCandidate = { id: string; name: string; city?: string | null; state?: string | null };
export type SiteCandidate = {
  /** the CustomerLocation id (docLocId) */
  id: string;
  companyId: string;
  name?: string | null;
  locationName?: string | null;
  address?: string | null;
  city?: string | null;
  state?: string | null;
};
export type PersonCandidate = {
  id: string;
  name: string;
  title?: string | null;
  companyId: string | null;
  emails: readonly string[];
};

function tokens(q: string): string[] {
  return q.toLowerCase().split(/\s+/).filter(Boolean);
}

function allIn(q: string, hay: string): boolean {
  const h = hay.toLowerCase();
  return tokens(q).every((t) => h.includes(t));
}

/** 0 = the name starts with the query, 1 = a word in it does, 2 = elsewhere. */
export function nameRank(q: string, name: string): number {
  const s = q.trim().toLowerCase();
  const n = (name || "").toLowerCase();
  if (!s) return 2;
  if (n.startsWith(s)) return 0;
  if (n.includes(" " + s)) return 1;
  return 2;
}

function place(city?: string | null, state?: string | null): string {
  return [city, state].filter(Boolean).join(", ");
}

function siteLabel(s: SiteCandidate): string {
  return (s.name || "").trim() || (s.locationName || "").trim() || "Venue";
}

export function emptyLinkTargets(): LinkTargetGroups {
  return { companies: [], venues: [], people: [] };
}

export function rankLinkTargets(
  q: string,
  data: {
    companies: readonly CompanyCandidate[];
    sites: readonly SiteCandidate[];
    people: readonly PersonCandidate[];
  },
  only?: LinkTargetKind
): LinkTargetGroups {
  const query = (q || "").trim();
  if (query.length < LINK_TARGET_MIN_QUERY) return emptyLinkTargets();
  const nameOf = new Map(data.companies.map((c) => [c.id, c.name]));
  const out = emptyLinkTargets();

  if (!only || only === "company") {
    out.companies = typeaheadMatches(
      query,
      data.companies,
      (qq, c) => allIn(qq, `${c.name} ${c.city || ""}`),
      (qq, c) => nameRank(qq, c.name),
      LINK_TARGET_MAX
    ).map((c) => ({
      kind: "company",
      id: c.id,
      label: c.name || c.id,
      sub: place(c.city, c.state),
      companyId: c.id,
      companyName: c.name || c.id,
    }));
  }
  if (!only || only === "venue") {
    out.venues = typeaheadMatches(
      query,
      data.sites.filter((s) => nameOf.has(s.companyId)),
      (qq, s) => allIn(qq, `${siteLabel(s)} ${s.locationName || ""} ${s.address || ""} ${s.city || ""}`),
      (qq, s) => nameRank(qq, siteLabel(s)),
      LINK_TARGET_MAX
    ).map((s) => {
      const companyName = nameOf.get(s.companyId) || s.companyId;
      return {
        kind: "venue",
        id: s.id,
        label: siteLabel(s),
        sub: [companyName, [s.address, place(s.city, s.state)].filter(Boolean).join(", ")]
          .filter(Boolean)
          .join(" · "),
        companyId: s.companyId,
        companyName,
      };
    });
  }
  if (!only || only === "person") {
    out.people = typeaheadMatches(
      query,
      // A contact's homeCompanyId can point at a company that's since been
      // soft-deleted (softDeleteCompany doesn't cascade to its contacts) —
      // drop those, same rule the venues filter above already applies via
      // nameOf.has. A person with no home company is unaffected.
      data.people.filter((p) => !p.companyId || nameOf.has(p.companyId)),
      (qq, p) => allIn(qq, `${p.name} ${p.emails.join(" ")}`),
      (qq, p) => nameRank(qq, p.name),
      LINK_TARGET_MAX
    ).map((p) => {
      const companyName = p.companyId ? nameOf.get(p.companyId) || "" : "";
      return {
        kind: "person",
        id: p.id,
        label: p.name || p.emails[0] || p.id,
        sub: [p.title, companyName].filter(Boolean).join(" · ") || p.emails[0] || "",
        companyId: p.companyId,
        companyName,
      };
    });
  }
  return out;
}
