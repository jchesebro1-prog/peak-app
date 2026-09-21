import { eq, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { contactEmails, contacts } from "@/db/schema";

/** #96 — exact-address → contact + home company, via the indexed
 *  contact_emails table (never a customer-doc scan). Addresses are stored
 *  as typed (see identity/contacts.ts setEmails), so match case-insensitively. */
export async function contactByEmail(
  email: string
): Promise<{ contactId: string; customerId: string } | null> {
  const e = (email || "").trim().toLowerCase();
  if (!e) return null;
  const db = await getDb();
  const rows = await db
    .select({ contactId: contactEmails.contactId, customerId: contacts.homeCompanyId })
    .from(contactEmails)
    .innerJoin(contacts, eq(contacts.id, contactEmails.contactId))
    .where(sql`lower(${contactEmails.email}) = ${e}`)
    .limit(5);
  const withCompany = rows.find((r) => !!r.customerId);
  return withCompany ? { contactId: withCompany.contactId, customerId: withCompany.customerId! } : null;
}
