/**
 * Conduit riser (#321) — box types: the table Bray prints on the riser sheet
 * (code + description, "A — 1-gang standard"). One settings blob
 * `riser_box_types` = `{ types: CRBoxType[] }`; nothing stored → Bray's list,
 * an explicitly saved empty list stays empty. Pure and client-safe; the store
 * is src/lib/stores/riser-box-types.ts.
 */
import type { CRBoxType } from "@/lib/design/conduit-riser/input";

export const RISER_BOX_TYPES_BLOB = "riser_box_types";
export const BOX_TYPES_MAX = 40;
export const BOX_CODE_MAX = 4;
export const BOX_DESC_MAX = 60;

const CODE_RE = /^[A-Z0-9]{1,4}$/;
const cleanText = (v: unknown, max: number): string =>
  typeof v === "string" ? v.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, max).trim() : "";

/**
 * Whatever arrives (the blob object `{ types }`, a bare array, junk) → a valid
 * list: ≤ 40 rows, code 1–4 letters/digits uppercased and unique (first wins),
 * description required (≤ 60). Invalid rows are dropped; order is kept.
 */
export function sanitizeBoxTypes(raw: unknown): CRBoxType[] {
  const arr = Array.isArray(raw) ? raw : raw && typeof raw === "object" && Array.isArray((raw as Record<string, unknown>).types) ? ((raw as Record<string, unknown>).types as unknown[]) : [];
  const seen = new Set<string>();
  const out: CRBoxType[] = [];
  for (const r of arr) {
    if (out.length >= BOX_TYPES_MAX) break;
    if (!r || typeof r !== "object") continue;
    const o = r as Record<string, unknown>;
    const code = typeof o.code === "string" ? o.code.trim().toUpperCase() : "";
    const description = cleanText(o.description, BOX_DESC_MAX);
    if (!CODE_RE.test(code) || !description || seen.has(code)) continue;
    seen.add(code);
    out.push({ code, description });
  }
  return out;
}
