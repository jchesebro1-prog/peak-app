import { and, eq, inArray } from "drizzle-orm";
import { getDb } from "@/db";
import {
  companies,
  sites,
  type CompanyRow,
  type NewCompanyRow,
} from "@/db/schema";

/**
 * Companies — the identity core's organization table (D85, spec §4.1).
 * Server-authoritative: no doc-store sync, writes only through server
 * actions. Ids are the customer-directory slugs ('lakefront', …) so every
 * doc-store customerId keeps resolving unchanged.
 */

export async function allCompanies(opts?: {
  includeDeleted?: boolean;
}): Promise<CompanyRow[]> {
  const db = await getDb();
  const rows = opts?.includeDeleted
    ? await db.select().from(companies)
    : await db.select().from(companies).where(eq(companies.deleted, false));
  return rows.sort((a, b) => (a.name || "").localeCompare(b.name || ""));
}

export async function getCompany(
  id: string | null | undefined
): Promise<CompanyRow | null> {
  if (!id) return null;
  const db = await getDb();
  const rows = await db
    .select()
    .from(companies)
    .where(and(eq(companies.id, id), eq(companies.deleted, false)))
    .limit(1);
  return rows[0] ?? null;
}

export async function getCompanies(
  ids: string[]
): Promise<Map<string, CompanyRow>> {
  const out = new Map<string, CompanyRow>();
  if (!ids.length) return out;
  const db = await getDb();
  const rows = await db
    .select()
    .from(companies)
    .where(and(inArray(companies.id, ids), eq(companies.deleted, false)));
  for (const r of rows) out.set(r.id, r);
  return out;
}

/** Upsert. Stamps updatedAt; createdAt only on insert. */
export async function saveCompany(
  row: Omit<NewCompanyRow, "createdAt" | "updatedAt"> & {
    createdAt?: number;
    updatedAt?: number;
  }
): Promise<void> {
  const db = await getDb();
  const t = Date.now();
  const rest: Partial<NewCompanyRow> = { ...row };
  delete rest.id;
  delete rest.createdAt;
  delete rest.updatedAt;
  await db
    .insert(companies)
    .values({ ...row, createdAt: row.createdAt ?? t, updatedAt: t })
    .onConflictDoUpdate({
      target: companies.id,
      set: { ...rest, deleted: rest.deleted ?? false, updatedAt: t },
    });
}

/**
 * Soft delete a company and its sites. Contacts keep their homeCompanyId —
 * the row stays as history ("junctions keep the historical hat", §4.2 spirit);
 * they simply stop composing into the directory once the company is gone.
 */
export async function softDeleteCompany(id: string): Promise<void> {
  const db = await getDb();
  const t = Date.now();
  await db
    .update(companies)
    .set({ deleted: true, updatedAt: t })
    .where(eq(companies.id, id));
  await db
    .update(sites)
    .set({ deleted: true, updatedAt: t })
    .where(eq(sites.companyId, id));
}
