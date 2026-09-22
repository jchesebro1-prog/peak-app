import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { companies, contactEmails, contacts } from "@/db/schema";

/** The address maps to one live contact with a live home company, or to
 *  more than one live customer (never auto-pick between them), or to nobody. */
export type ContactLookup =
  | { contactId: string; customerId: string }
  | { ambiguous: string[] }
  | null;

/** #96 — exact-address → contact + home company, via the indexed
 *  contact_emails table (never a customer-doc scan). Addresses are stored
 *  as typed (see identity/contacts.ts setEmails), so match case-insensitively.
 *  Soft-deleted contacts and companies are invisible here; when the live rows
 *  span more than one customer the answer is `{ ambiguous }`. */
export async function contactByEmail(email: string): Promise<ContactLookup> {
  const e = (email || "").trim().toLowerCase();
  if (!e) return null;
  const db = await getDb();
  const rows = await db
    .select({ contactId: contactEmails.contactId, customerId: contacts.homeCompanyId })
    .from(contactEmails)
    .innerJoin(contacts, eq(contacts.id, contactEmails.contactId))
    .leftJoin(companies, eq(companies.id, contacts.homeCompanyId))
    .where(
      and(
        sql`lower(${contactEmails.email}) = ${e}`,
        eq(contacts.deleted, false),
        // left join: a company row that exists and is soft-deleted hides its
        // contacts; a missing row (legacy id) behaves as before.
        sql`${companies.deleted} IS NOT TRUE`
      )
    )
    .orderBy(desc(contacts.updatedAt))
    .limit(10);
  return pickContactHit(rows);
}

/** Batched form for the re-sweep (#96): one query for every address, same
 *  deleted filters and newest-first ordering, keyed by lowercased address.
 *  Addresses with no live row are simply absent from the map. */
export async function contactsByEmails(emails: string[]): Promise<Map<string, ContactLookup>> {
  const out = new Map<string, ContactLookup>();
  const wanted = Array.from(new Set(emails.map((x) => (x || "").trim().toLowerCase()).filter(Boolean)));
  if (!wanted.length) return out;
  const db = await getDb();
  const rows = await db
    .select({
      email: sql<string>`lower(${contactEmails.email})`,
      contactId: contactEmails.contactId,
      customerId: contacts.homeCompanyId,
    })
    .from(contactEmails)
    .innerJoin(contacts, eq(contacts.id, contactEmails.contactId))
    .leftJoin(companies, eq(companies.id, contacts.homeCompanyId))
    .where(
      and(
        inArray(sql`lower(${contactEmails.email})`, wanted),
        eq(contacts.deleted, false),
        sql`${companies.deleted} IS NOT TRUE`
      )
    )
    .orderBy(desc(contacts.updatedAt));
  const byEmail = new Map<string, Array<{ contactId: string; customerId: string | null }>>();
  for (const r of rows) {
    const list = byEmail.get(r.email) ?? [];
    list.push({ contactId: r.contactId, customerId: r.customerId });
    byEmail.set(r.email, list);
  }
  for (const [e, list] of byEmail) out.set(e, pickContactHit(list));
  return out;
}

/** Shared reducer for the single and batched lookups: newest-first rows for
 *  one address → one hit, an ambiguity, or nothing. */
export function pickContactHit(
  rows: Array<{ contactId: string; customerId: string | null }>
): ContactLookup {
  const live = rows.filter((r): r is { contactId: string; customerId: string } => !!r.customerId);
  if (!live.length) return null;
  const customerIds = Array.from(new Set(live.map((r) => r.customerId)));
  if (customerIds.length > 1) return { ambiguous: customerIds };
  return { contactId: live[0].contactId, customerId: live[0].customerId };
}
