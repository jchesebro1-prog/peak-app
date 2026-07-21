import { and, eq, inArray } from "drizzle-orm";
import { getDb } from "@/db";
import { sites, type NewSiteRow, type SiteRow } from "@/db/schema";

/**
 * Sites — venues owned by a company (D85, spec §4.4). "What is this job
 * called? The Site." Carried from CustomerLocation, which already had
 * per-customer ids ('loc1', …) preserved here as legacyLocId.
 */

function primaryFirst(rows: SiteRow[]): SiteRow[] {
  return rows.sort(
    (a, b) => Number(b.isPrimary) - Number(a.isPrimary) || a.id.localeCompare(b.id)
  );
}

export async function sitesForCompany(
  companyId: string | null | undefined
): Promise<SiteRow[]> {
  if (!companyId) return [];
  const db = await getDb();
  const rows = await db
    .select()
    .from(sites)
    .where(and(eq(sites.companyId, companyId), eq(sites.deleted, false)));
  return primaryFirst(rows);
}

/** All non-deleted sites across every company (for the Venues directory). */
export async function getAllSites(): Promise<SiteRow[]> {
  const db = await getDb();
  return db.select().from(sites).where(eq(sites.deleted, false));
}

export async function sitesForCompanies(
  ids: string[]
): Promise<Map<string, SiteRow[]>> {
  const out = new Map<string, SiteRow[]>();
  if (!ids.length) return out;
  const db = await getDb();
  const rows = await db
    .select()
    .from(sites)
    .where(and(inArray(sites.companyId, ids), eq(sites.deleted, false)));
  for (const r of rows) {
    const list = out.get(r.companyId) ?? [];
    list.push(r);
    out.set(r.companyId, list);
  }
  for (const [k, v] of out) out.set(k, primaryFirst(v));
  return out;
}

export async function getSite(
  id: string | null | undefined
): Promise<SiteRow | null> {
  if (!id) return null;
  const db = await getDb();
  const rows = await db
    .select()
    .from(sites)
    .where(and(eq(sites.id, id), eq(sites.deleted, false)))
    .limit(1);
  return rows[0] ?? null;
}

export async function saveSite(
  row: Omit<NewSiteRow, "createdAt" | "updatedAt"> & {
    createdAt?: number;
    updatedAt?: number;
  }
): Promise<void> {
  const db = await getDb();
  const t = Date.now();
  const rest: Partial<NewSiteRow> = { ...row };
  delete rest.id;
  delete rest.createdAt;
  delete rest.updatedAt;
  await db
    .insert(sites)
    .values({ ...row, createdAt: row.createdAt ?? t, updatedAt: t })
    .onConflictDoUpdate({
      target: sites.id,
      set: { ...rest, deleted: rest.deleted ?? false, updatedAt: t },
    });
}

export async function softDeleteSite(id: string): Promise<void> {
  const db = await getDb();
  await db
    .update(sites)
    .set({ deleted: true, updatedAt: Date.now() })
    .where(eq(sites.id, id));
}

/** The id doc records store as `locationId` — legacy alias when present. */
export function docLocId(s: SiteRow): string {
  return s.legacyLocId ?? s.id;
}
