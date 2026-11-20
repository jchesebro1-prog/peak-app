"use server";

import { requireUser } from "@/lib/session";
import { allCompanies } from "@/lib/identity/companies";
import { allContacts, displayName } from "@/lib/identity/contacts";
import { emailsMatching } from "@/lib/identity/lookup";
import { docLocId, getAllSites } from "@/lib/identity/sites";
import {
  emptyLinkTargets,
  rankLinkTargets,
  LINK_TARGET_MIN_QUERY,
  type LinkTargetGroups,
  type LinkTargetKind,
} from "@/lib/search/link-targets";

/** One search across companies (name, city), venues (name, address, city)
 *  and people (name, email) — ≤ 8 per group. `only` narrows to one kind. */
export async function searchLinkTargetsAction(
  q: string,
  only?: LinkTargetKind
): Promise<LinkTargetGroups> {
  await requireUser();
  const query = (q || "").trim();
  if (query.length < LINK_TARGET_MIN_QUERY) return emptyLinkTargets();
  const wantSites = !only || only === "venue";
  const wantPeople = !only || only === "person";
  const longest = query.split(/\s+/).sort((a, b) => b.length - a.length)[0] || "";
  const [companies, sites, people, emails] = await Promise.all([
    allCompanies(),
    wantSites ? getAllSites() : Promise.resolve([]),
    wantPeople ? allContacts() : Promise.resolve([]),
    wantPeople ? emailsMatching(longest) : Promise.resolve(new Map<string, string[]>()),
  ]);
  return rankLinkTargets(
    query,
    {
      companies: companies.map((c) => ({ id: c.id, name: c.name, city: c.city, state: c.state })),
      sites: sites.map((s) => ({
        id: docLocId(s),
        companyId: s.companyId,
        name: s.name,
        locationName: s.locationName,
        address: s.address,
        city: s.city,
        state: s.state,
      })),
      people: people.map((p) => ({
        id: p.id,
        name: displayName(p),
        title: p.title,
        companyId: p.homeCompanyId,
        emails: emails.get(p.id) ?? [],
      })),
    },
    only
  );
}
