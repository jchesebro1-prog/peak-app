import { getBlob, setBlob } from "@/db/doc-store";
import { partCategoryStats, sanitizeDepartments, type Department } from "@/lib/portal-departments";
import { portalIndex } from "@/lib/portal-catalog-index";

/**
 * Portal departments store (#252). One settings blob, no table and no
 * migration — same idiom as gridDeviceTypes (src/lib/stores/device-types.ts):
 *   portal_departments   { departments: Department[] }   full replacement
 */

const DEPARTMENTS_BLOB = "portal_departments";

/** The saved list, shape-cleaned only (no known-categories check — a
 *  category that's disappeared from the catalog since is harmless, it just
 *  matches nothing). */
export async function getDepartments(): Promise<Department[]> {
  const row = await getBlob<Record<string, unknown>>(DEPARTMENTS_BLOB, {});
  const res = sanitizeDepartments(row.departments, null);
  return res.ok ? res.value : [];
}

/**
 * The Departments editor's save (spec pick 7). Reads the live catalog
 * part categories itself (via the portal index — #252 fix round 1 moved this out
 * of the caller, src/app/(app)/catalog/departments/actions.ts, so any future
 * caller gets the same defensive drop for free) and hands them to
 * sanitizeDepartments as `knownCategories`, which drops anything the catalog
 * doesn't actually have.
 *
 * Deliberately skips the index-invalidation call other blob-store saves make
 * (#252 fix round 1, DECISIONS): departments are never baked into the cached
 * PortalIndex — portal-catalog-browse.ts reads getDepartments() fresh on
 * every browse — so invalidating would only force an unrelated, expensive
 * rebuild of the whole ~37k-part index for no correctness benefit.
 */
export async function saveDepartments(input: unknown): Promise<{ ok: true; value: Department[] } | { ok: false; error: string }> {
  const ix = await portalIndex();
  // #289: departments hold parts only — package (fixture) categories are
  // never known here, so a stale "Fixture assemblies" drops on save.
  const res = sanitizeDepartments(input, partCategoryStats(ix.entries).map((s) => s.category));
  if (!res.ok) return res;
  await setBlob(DEPARTMENTS_BLOB, { departments: res.value });
  return res;
}
