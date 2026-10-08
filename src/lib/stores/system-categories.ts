import { getBlob, setBlob } from "@/db/doc-store";
import { SYSTEM_CATEGORIES_BLOB, sanitizeSystemCategories, type SystemCategory } from "@/lib/system-categories";

/**
 * Estimator Phase 6 — the system categories settings blob (no table, no
 * migration; survives the go-live wipe like every settings blob):
 *   system_categories   { categories: SystemCategory[] }
 * Reading never writes: a missing blob returns the seven defaults and they are
 * persisted only when an admin first saves.
 */

export async function getSystemCategories(): Promise<SystemCategory[]> {
  return sanitizeSystemCategories(await getBlob<Record<string, unknown>>(SYSTEM_CATEGORIES_BLOB, {}));
}

export async function saveSystemCategories(next: unknown): Promise<SystemCategory[]> {
  const clean = sanitizeSystemCategories(next);
  await setBlob(SYSTEM_CATEGORIES_BLOB, { categories: clean });
  return clean;
}
