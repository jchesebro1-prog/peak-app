/**
 * Conduit riser (#321) — conduit sizes: what a priced conduit run buys, by
 * size (`1"` → a per-foot catalog part). One settings blob `conduit_sizes` =
 * `{ sizes: ConduitSize[] }`; nothing stored → six seed sizes with no parts
 * (a priced run on an unmapped size refuses the quote by name), a saved empty
 * list stays empty. Pure and client-safe; the store is
 * src/lib/stores/conduit-sizes.ts.
 */
import type { ConduitSize } from "@/lib/design/conduit-riser/pricing";

export const CONDUIT_SIZES_BLOB = "conduit_sizes";
export const CONDUIT_SIZES_MAX = 20;
export const CONDUIT_SIZE_MAX = 12;
const PART_ID_MAX = 120;

export const DEFAULT_CONDUIT_SIZES: readonly ConduitSize[] = ['1/2"', '3/4"', '1"', '1-1/4"', '1-1/2"', '2"'].map((size) => ({ size }));

const cleanText = (v: unknown, max: number): string =>
  typeof v === "string" ? v.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, max).trim() : "";

/** Whatever arrives (`{ sizes }`, a bare array, junk) → ≤ 20 rows, size ≤ 12 chars and unique (first wins), part optional. Order is kept. */
export function sanitizeConduitSizes(raw: unknown): ConduitSize[] {
  const arr = Array.isArray(raw) ? raw : raw && typeof raw === "object" && Array.isArray((raw as Record<string, unknown>).sizes) ? ((raw as Record<string, unknown>).sizes as unknown[]) : [];
  const seen = new Set<string>();
  const out: ConduitSize[] = [];
  for (const r of arr) {
    if (out.length >= CONDUIT_SIZES_MAX) break;
    if (!r || typeof r !== "object") continue;
    const o = r as Record<string, unknown>;
    const size = cleanText(o.size, CONDUIT_SIZE_MAX);
    if (!size || seen.has(size)) continue;
    seen.add(size);
    const partId = typeof o.partId === "string" ? o.partId.replace(/[\u0000-\u001f\u007f]+/g, " ").trim().slice(0, PART_ID_MAX).trim() : "";
    out.push(partId ? { size, partId } : { size });
  }
  return out;
}

export type ConduitSizesCheck = { ok: true; sizes: ConduitSize[] } | { ok: false; error: string };

/** Strict form for a SAVE: names the first row that would be dropped (blank / too-long / repeated size) or the row cap, so a bad row is refused instead of vanishing under "Saved.". */
export function validateConduitSizeRows(raw: unknown): ConduitSizesCheck {
  const list = Array.isArray(raw) ? raw : [];
  if (list.length > CONDUIT_SIZES_MAX) return { ok: false, error: `At most ${CONDUIT_SIZES_MAX} sizes.` };
  const seen = new Set<string>();
  for (let i = 0; i < list.length; i++) {
    const o = list[i] && typeof list[i] === "object" ? (list[i] as Record<string, unknown>) : null;
    const size = cleanText(o?.size, 200);
    if (!size) return { ok: false, error: `Row ${i + 1}: enter a size.` };
    if (size.length > CONDUIT_SIZE_MAX) return { ok: false, error: `Row ${i + 1} (${size}): a size is at most ${CONDUIT_SIZE_MAX} characters.` };
    if (seen.has(size)) return { ok: false, error: `Row ${i + 1} (${size}): that size is listed twice.` };
    seen.add(size);
  }
  return { ok: true, sizes: sanitizeConduitSizes(list) };
}
