/**
 * #96 §1 — who a sender is. Pure over injected lookups so it's spec-testable;
 * bridge.ts and linking.ts supply the real ones (contact_emails / customer_domains).
 */
import { domainOf, isPublicDomain } from "./config";

export type Resolution =
  | { kind: "linked"; customerId: string; contactId?: string; via: "contact" | "domain" }
  | { kind: "ambiguous"; candidates: Array<{ customerId: string }> }
  | { kind: "unknown" };

export type ResolveLookups = {
  contactByEmail: (email: string) => Promise<{ contactId: string; customerId: string } | null>;
  customersByDomain: (domain: string) => Promise<string[]>;
};

export async function resolveSender(email: string, lookups: ResolveLookups): Promise<Resolution> {
  const e = (email || "").trim().toLowerCase();
  if (!e) return { kind: "unknown" };
  const hit = await lookups.contactByEmail(e);
  if (hit) return { kind: "linked", customerId: hit.customerId, contactId: hit.contactId, via: "contact" };
  const d = domainOf(e);
  if (!d || isPublicDomain(d)) return { kind: "unknown" };
  const owners = Array.from(new Set(await lookups.customersByDomain(d)));
  if (owners.length === 1) return { kind: "linked", customerId: owners[0], via: "domain" };
  if (owners.length > 1) return { kind: "ambiguous", candidates: owners.map((customerId) => ({ customerId })) };
  return { kind: "unknown" };
}
