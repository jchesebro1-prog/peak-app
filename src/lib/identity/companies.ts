import { and, eq, inArray } from "drizzle-orm";
import { CODE_RE } from "@/lib/assessments/codes";
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

/**
 * Is this id already in use by ANY company row, soft-deleted included?
 * Deliberately narrower than `getCompany` (which filters `deleted = false`
 * and is the app's "does this company exist" question): id-minting must not
 * hand out a slug a deleted row still holds, because `saveCompany`'s upsert
 * would revive that row and overwrite its record (#122 C1).
 */
export async function companyIdTaken(id: string): Promise<boolean> {
  if (!id) return false;
  const db = await getDb();
  const rows = await db
    .select({ id: companies.id })
    .from(companies)
    .where(eq(companies.id, id))
    .limit(1);
  return rows.length > 0;
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
  // shortCode is written only by setCompanyShortCode (#340): a regular save
  // never writes, clears or inserts it.
  const { shortCode: _sc, ...clean } = row;
  void _sc;
  const rest: Partial<NewCompanyRow> = { ...clean };
  delete rest.id;
  delete rest.createdAt;
  delete rest.updatedAt;
  await db
    .insert(companies)
    .values({ ...clean, createdAt: row.createdAt ?? t, updatedAt: t })
    .onConflictDoUpdate({
      target: companies.id,
      set: { ...rest, deleted: rest.deleted ?? false, updatedAt: t },
    });
}

/** Postgres unique_violation, seen directly or one level down (drizzle wraps driver errors in `cause`). */
export function isUniqueViolation(e: unknown): boolean {
  const x = e as { code?: string; cause?: { code?: string } } | null;
  return x?.code === "23505" || x?.cause?.code === "23505";
}

/**
 * Set (or clear, with null) a company's assessment short code (#340). The only
 * writer of `companies.short_code`. Must match CODE_RE; the partial unique
 * index from migration 0040 (lower(short_code), live rows) turns a clash into
 * a friendly error instead of a throw.
 */
export async function setCompanyShortCode(
  id: string,
  code: string | null
): Promise<{ ok: true } | { ok: false; error: string }> {
  // Normalised before validating: " lin " → "LIN". A blank string is refused,
  // never read as a clear — clearing sends null deliberately.
  const next = code === null ? null : code.trim().toUpperCase();
  if (next !== null && !CODE_RE.test(next)) {
    return { ok: false, error: "A code is 2 to 6 letters or digits (A to Z, 0 to 9)" };
  }
  const db = await getDb();
  let rows: { id: string }[];
  try {
    rows = await db
      .update(companies)
      .set({ shortCode: next, updatedAt: Date.now() })
      .where(eq(companies.id, id))
      .returning({ id: companies.id });
  } catch (e) {
    if (isUniqueViolation(e)) return { ok: false, error: "That code is already used by another company" };
    throw e;
  }
  if (!rows.length) return { ok: false, error: "Company not found" };
  return { ok: true };
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
