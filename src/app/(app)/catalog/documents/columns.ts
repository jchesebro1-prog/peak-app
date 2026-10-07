/**
 * Datasheets table — which optional columns a viewer has hidden (#303).
 * Pure: no server imports, no React, so the client table and the spec harness
 * share one set of rules. The select checkbox and the Part column are not in
 * this list on purpose — they can never be hidden.
 *
 * The stored value is the list of HIDDEN keys (not the visible ones), so a
 * column added later shows up for everyone by default.
 */

export const OPTIONAL_COLUMN_KEYS = ["quoted", "lastQuoted", "datasheet", "specsheet", "manual", "image"] as const;
export type OptionalColumnKey = (typeof OPTIONAL_COLUMN_KEYS)[number];

/** localStorage key (per viewer, per browser). */
export const COLUMNS_STORAGE_KEY = "catalog-documents-columns-v1";

/** Fixed pixel widths — the sticky Part column's `left` offset depends on CHECK_COL_W. */
export const CHECK_COL_W = 40;
export const PART_COL_W = 260;
const COLUMN_MIN_W: Record<OptionalColumnKey, number> = {
  quoted: 72,
  lastQuoted: 104,
  datasheet: 200,
  specsheet: 200,
  manual: 200,
  image: 140,
};

/** A hidden-keys array from any untrusted value: unknown keys and non-strings
 *  are dropped, duplicates collapse, and the result is in column order. */
export function sanitizeHiddenColumns(raw: unknown): OptionalColumnKey[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  for (const v of raw) if (typeof v === "string") seen.add(v);
  return OPTIONAL_COLUMN_KEYS.filter((k) => seen.has(k));
}

/** Parse the stored JSON string. Anything unreadable means "nothing hidden". */
export function parseStoredHiddenColumns(stored: string | null | undefined): OptionalColumnKey[] {
  if (!stored) return [];
  try {
    return sanitizeHiddenColumns(JSON.parse(stored));
  } catch {
    return [];
  }
}

/** The optional columns still shown, in column order. */
export function visibleColumns(hidden: readonly OptionalColumnKey[]): OptionalColumnKey[] {
  const h = new Set<string>(hidden);
  return OPTIONAL_COLUMN_KEYS.filter((k) => !h.has(k));
}

/** Total <td> count per row: select box + Part + the visible optional columns. */
export function columnCount(visible: readonly OptionalColumnKey[]): number {
  return 2 + visible.length;
}

/** Table min-width from what is actually shown, so hiding columns narrows it. */
export function tableMinWidth(visible: readonly OptionalColumnKey[]): number {
  return CHECK_COL_W + PART_COL_W + visible.reduce((sum, k) => sum + COLUMN_MIN_W[k], 0);
}

/** Flip one column in the hidden list (returns a new, sanitized list). */
export function toggleHiddenColumn(hidden: readonly OptionalColumnKey[], key: OptionalColumnKey): OptionalColumnKey[] {
  const h = new Set<string>(hidden);
  if (h.has(key)) h.delete(key);
  else h.add(key);
  return sanitizeHiddenColumns([...h]);
}
