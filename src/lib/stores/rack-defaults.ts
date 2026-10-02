import { getBlob, setBlob } from "@/db/doc-store";
import { RACK_DEFAULTS_BLOB, sanitizeRackDefaults, type RackDefaults } from "@/lib/rack/defaults";

/**
 * #296 (D579) — the rack tray's default blank and vent SKUs. One settings
 * blob, no table and no migration (the portal_departments idiom):
 *   rack_defaults   { defaults: RackDefaults }   full replacement
 * The value lives under one key because setBlob merges top-level keys — a
 * cleared SKU must actually clear.
 */
export async function getRackDefaults(): Promise<RackDefaults> {
  const row = await getBlob<Record<string, unknown>>(RACK_DEFAULTS_BLOB, {});
  return sanitizeRackDefaults(row.defaults);
}

/** Replace the saved defaults with the cleaned input; returns what was stored. */
export async function saveRackDefaults(input: unknown): Promise<RackDefaults> {
  const value = sanitizeRackDefaults(input);
  await setBlob(RACK_DEFAULTS_BLOB, { defaults: value });
  return value;
}
