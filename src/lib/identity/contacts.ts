import { and, eq, inArray } from "drizzle-orm";
import { getDb } from "@/db";
import {
  contactEmails,
  contactPhones,
  contacts,
  type ContactEmailRow,
  type ContactPhoneRow,
  type ContactRow,
  type NewContactRow,
} from "@/db/schema";

/**
 * Contacts — the identity core's people table (D85, spec §4.2/§4.3).
 * A person is one row for life; employer changes mutate homeCompanyId
 * (Phase 2 junction rows will keep the historical hat). Emails and phones
 * are child rows — load-bearing for the portal, not cosmetic.
 */

export function displayName(c: Pick<ContactRow, "firstName" | "lastName">): string {
  return `${c.firstName} ${c.lastName}`.trim();
}

function nameSorted(rows: ContactRow[]): ContactRow[] {
  return rows.sort((a, b) => displayName(a).localeCompare(displayName(b)));
}

export async function allContacts(opts?: {
  includeDeleted?: boolean;
}): Promise<ContactRow[]> {
  const db = await getDb();
  const rows = opts?.includeDeleted
    ? await db.select().from(contacts)
    : await db.select().from(contacts).where(eq(contacts.deleted, false));
  return nameSorted(rows);
}

export async function contactsForCompany(
  companyId: string | null | undefined
): Promise<ContactRow[]> {
  if (!companyId) return [];
  const db = await getDb();
  const rows = await db
    .select()
    .from(contacts)
    .where(
      and(eq(contacts.homeCompanyId, companyId), eq(contacts.deleted, false))
    );
  // Primary contact first, then alphabetical — matches the directory's
  // contacts[0]-is-primary convention the composed store preserves.
  return rows.sort(
    (a, b) =>
      Number(b.isPrimary) - Number(a.isPrimary) ||
      displayName(a).localeCompare(displayName(b))
  );
}

export async function contactsForCompanies(
  ids: string[]
): Promise<Map<string, ContactRow[]>> {
  const out = new Map<string, ContactRow[]>();
  if (!ids.length) return out;
  const db = await getDb();
  const rows = await db
    .select()
    .from(contacts)
    .where(
      and(inArray(contacts.homeCompanyId, ids), eq(contacts.deleted, false))
    );
  for (const r of rows) {
    const key = r.homeCompanyId as string;
    const list = out.get(key) ?? [];
    list.push(r);
    out.set(key, list);
  }
  for (const [k, v] of out)
    out.set(
      k,
      v.sort(
        (a, b) =>
          Number(b.isPrimary) - Number(a.isPrimary) ||
          displayName(a).localeCompare(displayName(b))
      )
    );
  return out;
}

export async function getContact(
  id: string | null | undefined
): Promise<ContactRow | null> {
  if (!id) return null;
  const db = await getDb();
  const rows = await db
    .select()
    .from(contacts)
    .where(and(eq(contacts.id, id), eq(contacts.deleted, false)))
    .limit(1);
  return rows[0] ?? null;
}

export async function saveContact(
  row: Omit<NewContactRow, "createdAt" | "updatedAt"> & {
    createdAt?: number;
    updatedAt?: number;
  }
): Promise<void> {
  const db = await getDb();
  const t = Date.now();
  const rest: Partial<NewContactRow> = { ...row };
  delete rest.id;
  delete rest.createdAt;
  delete rest.updatedAt;
  await db
    .insert(contacts)
    .values({ ...row, createdAt: row.createdAt ?? t, updatedAt: t })
    .onConflictDoUpdate({
      target: contacts.id,
      set: { ...rest, deleted: rest.deleted ?? false, updatedAt: t },
    });
}

export async function softDeleteContact(id: string): Promise<void> {
  const db = await getDb();
  await db
    .update(contacts)
    .set({ deleted: true, updatedAt: Date.now() })
    .where(eq(contacts.id, id));
}

/* ---------------- emails / phones (child rows, §4.3) ---------------- */

export async function emailsFor(contactId: string): Promise<ContactEmailRow[]> {
  const db = await getDb();
  const rows = await db
    .select()
    .from(contactEmails)
    .where(eq(contactEmails.contactId, contactId));
  return rows.sort((a, b) => Number(b.isPrimary) - Number(a.isPrimary));
}

export async function phonesFor(contactId: string): Promise<ContactPhoneRow[]> {
  const db = await getDb();
  const rows = await db
    .select()
    .from(contactPhones)
    .where(eq(contactPhones.contactId, contactId));
  return rows.sort((a, b) => Number(b.isPrimary) - Number(a.isPrimary));
}

export async function emailsForContacts(
  ids: string[]
): Promise<Map<string, ContactEmailRow[]>> {
  const out = new Map<string, ContactEmailRow[]>();
  if (!ids.length) return out;
  const db = await getDb();
  const rows = await db
    .select()
    .from(contactEmails)
    .where(inArray(contactEmails.contactId, ids));
  for (const r of rows) {
    const list = out.get(r.contactId) ?? [];
    list.push(r);
    out.set(r.contactId, list);
  }
  for (const [k, v] of out)
    out.set(k, v.sort((a, b) => Number(b.isPrimary) - Number(a.isPrimary)));
  return out;
}

export async function phonesForContacts(
  ids: string[]
): Promise<Map<string, ContactPhoneRow[]>> {
  const out = new Map<string, ContactPhoneRow[]>();
  if (!ids.length) return out;
  const db = await getDb();
  const rows = await db
    .select()
    .from(contactPhones)
    .where(inArray(contactPhones.contactId, ids));
  for (const r of rows) {
    const list = out.get(r.contactId) ?? [];
    list.push(r);
    out.set(r.contactId, list);
  }
  for (const [k, v] of out)
    out.set(k, v.sort((a, b) => Number(b.isPrimary) - Number(a.isPrimary)));
  return out;
}

export type ChannelInput = { value: string; label: string; isPrimary: boolean };

/** Replace a contact's email rows. Deterministic ids keep re-runs idempotent. */
export async function setEmails(
  contactId: string,
  emails: ChannelInput[]
): Promise<void> {
  const db = await getDb();
  await db.delete(contactEmails).where(eq(contactEmails.contactId, contactId));
  const clean = emails.filter((e) => (e.value || "").trim());
  if (!clean.length) return;
  if (!clean.some((e) => e.isPrimary)) clean[0].isPrimary = true;
  await db.insert(contactEmails).values(
    clean.map((e, i) => ({
      id: `ce-${contactId}-${i + 1}`,
      contactId,
      email: e.value.trim(),
      label: e.label || "work",
      isPrimary: !!e.isPrimary,
    }))
  );
}

/** Replace a contact's phone rows. */
export async function setPhones(
  contactId: string,
  phones: ChannelInput[]
): Promise<void> {
  const db = await getDb();
  await db.delete(contactPhones).where(eq(contactPhones.contactId, contactId));
  const clean = phones.filter((p) => (p.value || "").trim());
  if (!clean.length) return;
  if (!clean.some((p) => p.isPrimary)) clean[0].isPrimary = true;
  await db.insert(contactPhones).values(
    clean.map((p, i) => ({
      id: `cp-${contactId}-${i + 1}`,
      contactId,
      phone: p.value.trim(),
      label: p.label || "work",
      isPrimary: !!p.isPrimary,
    }))
  );
}
