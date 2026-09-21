import { activeUsers } from "@/lib/users";
import { all as allCustomers } from "@/lib/stores/customers";

/**
 * Attendee search (S13 full-build, calendar event modal) — merges the team
 * roster with every customer contact so the picker covers "who Jeff would
 * actually invite" without a dedicated people table. Free-text email typed
 * with no match is still accepted by the modal itself; this just powers the
 * suggestion list.
 */

export type PersonMatch = {
  name: string;
  email: string;
  source: "team" | "contact";
  /** company name, for contacts only — helps disambiguate same-name people */
  context: string;
};

export async function searchPeople(query: string, limit = 8): Promise<PersonMatch[]> {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const out: PersonMatch[] = [];

  for (const u of await activeUsers()) {
    if (out.length >= limit) break;
    if (u.name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q)) {
      out.push({ name: u.name, email: u.email, source: "team", context: "" });
    }
  }

  if (out.length < limit) {
    for (const co of await allCustomers()) {
      for (const c of co.contacts) {
        if (out.length >= limit) break;
        if (!c.email) continue;
        if (c.name.toLowerCase().includes(q) || c.email.toLowerCase().includes(q)) {
          out.push({ name: c.name, email: c.email, source: "contact", context: co.name });
        }
      }
      if (out.length >= limit) break;
    }
  }

  return out;
}
