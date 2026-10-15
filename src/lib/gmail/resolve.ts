/**
 * #96 §1 — who a sender is. Pure over injected lookups so it's spec-testable;
 * bridge.ts and linking.ts supply the real ones (contact_emails / customer_domains).
 */
import { domainOf, isPublicDomain } from "./config";

export type Resolution =
  | { kind: "linked"; customerId: string; contactId?: string; via: "contact" | "domain" }
  | { kind: "ambiguous"; candidates: Array<{ customerId: string }> }
  /** #345 — `contactId`: the sender is a known contact whose only company is
   *  a placeholder ("UNKNOWN" …) — the contact without a customer. */
  | { kind: "unknown"; contactId?: string };

/** What the contact step can answer: one hit, or the live rows span more
 *  than one customer (never auto-pick between them), or nobody. */
export type ContactHit =
  | { contactId: string; customerId: string }
  /** `contacts`: the live rows, newest first, when the lookup has them */
  | { ambiguous: string[]; contacts?: Array<{ contactId: string; customerId: string }> }
  | null;

export type ResolveLookups = {
  contactByEmail: (email: string) => Promise<ContactHit>;
  customersByDomain: (domain: string) => Promise<string[]>;
  /** #345 — which of these customer ids are placeholder companies
   *  ("UNKNOWN", "TBD" …): treated as no company at every step. Absent = none. */
  placeholderIds?: (customerIds: string[]) => Promise<ReadonlySet<string>>;
};

export async function resolveSender(email: string, lookups: ResolveLookups): Promise<Resolution> {
  const e = (email || "").trim().toLowerCase();
  if (!e) return { kind: "unknown" };
  const real = async (ids: string[]): Promise<string[]> => {
    const uniq = Array.from(new Set(ids));
    if (!uniq.length || !lookups.placeholderIds) return uniq;
    const ph = await lookups.placeholderIds(uniq);
    return uniq.filter((id) => !ph.has(id));
  };
  // a known contact parked under a placeholder company: kept as the contact,
  // never as a customer — the domain step may still find the real one
  let contactOnly: string | undefined;
  const hit = await lookups.contactByEmail(e);
  if (hit && "ambiguous" in hit) {
    const ids = await real(hit.ambiguous);
    if (ids.length > 1) return { kind: "ambiguous", candidates: ids.map((customerId) => ({ customerId })) };
    if (ids.length === 1) {
      const contactId = hit.contacts?.find((c) => c.customerId === ids[0])?.contactId;
      return { kind: "linked", customerId: ids[0], ...(contactId ? { contactId } : {}), via: "contact" };
    }
    // every customer was a placeholder: keep the (newest) contact, as below
    contactOnly = hit.contacts?.[0]?.contactId;
  } else if (hit) {
    if ((await real([hit.customerId])).length) return { kind: "linked", customerId: hit.customerId, contactId: hit.contactId, via: "contact" };
    contactOnly = hit.contactId;
  }
  const none: Resolution = contactOnly ? { kind: "unknown", contactId: contactOnly } : { kind: "unknown" };
  const d = domainOf(e);
  if (!d || isPublicDomain(d)) return none;
  const owners = await real(await lookups.customersByDomain(d));
  if (owners.length === 1) return { kind: "linked", customerId: owners[0], via: "domain" };
  if (owners.length > 1) return { kind: "ambiguous", candidates: owners.map((customerId) => ({ customerId })) };
  return none;
}
