/**
 * #296 (D579) — the default blank and vent panel SKUs the Assembly Builder's
 * rack tray arms. One settings blob, `rack_defaults`; this is its pure half
 * (the store is `src/lib/stores/rack-defaults.ts`).
 */
export const RACK_DEFAULTS_BLOB = "rack_defaults";
export const RACK_DEFAULT_SKU_MAX = 80;

export type RackDefaults = { blankSku?: string; ventSku?: string };

const cleanSku = (v: unknown): string | undefined => {
  if (typeof v !== "string") return undefined;
  const s = v.trim();
  return s && s.length <= RACK_DEFAULT_SKU_MAX ? s : undefined;
};

/** Keeps `blankSku` and `ventSku` when each is a trimmed, non-empty SKU of at most 80 characters; drops everything else. */
export function sanitizeRackDefaults(input: unknown): RackDefaults {
  if (!input || typeof input !== "object" || Array.isArray(input)) return {};
  const o = input as Record<string, unknown>;
  const blankSku = cleanSku(o.blankSku);
  const ventSku = cleanSku(o.ventSku);
  return { ...(blankSku ? { blankSku } : {}), ...(ventSku ? { ventSku } : {}) };
}
