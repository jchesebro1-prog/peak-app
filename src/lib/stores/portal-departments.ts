import { getBlob, setBlob } from "@/db/doc-store";
import { sanitizeDepartments, type Department } from "@/lib/portal-departments";
import { invalidatePortalIndex } from "@/lib/portal-catalog-index";

/**
 * Portal departments store (#251). One settings blob, no table and no
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
 * The Departments editor's save (spec pick 7). `knownCategories` is the
 * live set of catalog categories — sanitizeDepartments drops anything else.
 * Invalidates the portal index (spec pick 7's last line) so the browse
 * page's category → department map and tiles pick up the change immediately.
 */
export async function saveDepartments(
  input: unknown,
  knownCategories: readonly string[]
): Promise<{ ok: true; value: Department[] } | { ok: false; error: string }> {
  const res = sanitizeDepartments(input, knownCategories);
  if (!res.ok) return res;
  await setBlob(DEPARTMENTS_BLOB, { departments: res.value });
  invalidatePortalIndex();
  return res;
}
