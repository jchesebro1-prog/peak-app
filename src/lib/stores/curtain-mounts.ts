import { getBlob, setBlob } from "@/db/doc-store";
import { getMany } from "@/lib/stores/catalog";
import { CURTAIN_MOUNTS_BLOB, sanitizeCurtainMounts, validateMountRows, type CurtainMountHardware } from "@/lib/curtain-mounts";
import { isMountTypeId, type CurtainMountTypeId } from "@/lib/curtain-cut-sheets/vocab";

/**
 * Curtain mounts store (#292 §1.6): blob `curtain_mount_hardware`, one
 * top-level key per mount type id, written per key through setBlob's jsonb
 * merge (track_series idiom). Starts EMPTY; nothing writes on its own.
 */
export async function listCurtainMounts(): Promise<Partial<Record<CurtainMountTypeId, CurtainMountHardware>>> {
  return sanitizeCurtainMounts(await getBlob<Record<string, unknown>>(CURTAIN_MOUNTS_BLOB, {}));
}

export type SaveCurtainMountResult = { ok: true; hardware: CurtainMountHardware } | { ok: false; error: string };

/** Refuses (writing nothing) an unknown mount id, any row that would be dropped (named by row), and any SKU missing from the live catalog, by name (one getMany). */
export async function saveCurtainMount(mountTypeId: unknown, rows: unknown, by: string, now = Date.now()): Promise<SaveCurtainMountResult> {
  if (!isMountTypeId(mountTypeId)) return { ok: false, error: "Unknown mount type." };
  const checked = validateMountRows(rows);
  if (!checked.ok) return checked;
  const clean = checked.rows;
  const skus = [...new Set(clean.map((r) => r.sku))];
  const live = new Set(skus.length ? (await getMany(skus)).map((p) => p.sku) : []);
  const missing = skus.filter((s) => !live.has(s));
  if (missing.length) return { ok: false, error: `Not in the catalog: ${missing.join(", ")}.` };
  const hardware: CurtainMountHardware = { rows: clean, updatedBy: by, updatedAt: now };
  await setBlob(CURTAIN_MOUNTS_BLOB, { [mountTypeId]: hardware });
  return { ok: true, hardware };
}
