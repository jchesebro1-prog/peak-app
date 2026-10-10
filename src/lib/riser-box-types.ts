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

export type BoxTypeRowError = { row: number; field: "code" | "description" | "list"; message: string };
export type BoxTypesCheck = { ok: true; types: CRBoxType[] } | { ok: false; errors: BoxTypeRowError[] };

/**
 * Strict form for a SAVE (#321 polish; copies the conduit-sizes pattern, but
 * per row): every row that `sanitizeBoxTypes` would silently drop is named —
 * blank or invalid code, a repeated code, a blank or over-long description —
 * as `{ row (0-based), field, message }`, plus a `list` error over the cap.
 * Fully blank rows are skipped (the card's empty "+ Add" row). `row` indexes
 * the array as received. `sanitizeBoxTypes` remains the read path.
 */
export function validateBoxTypeRows(raw: unknown): BoxTypesCheck {
  const list = Array.isArray(raw) ? raw : [];
  const errors: BoxTypeRowError[] = [];
  const seen = new Set<string>();
  const kept: unknown[] = [];
  list.forEach((r, row) => {
    const o = r && typeof r === "object" ? (r as Record<string, unknown>) : null;
    const rawCode = o?.code;
    const nonString = rawCode !== undefined && rawCode !== null && typeof rawCode !== "string";
    const code = typeof rawCode === "string" ? rawCode.trim().toUpperCase() : "";
    const description = cleanText(o?.description, 10_000);
    if (!nonString && !code && !description) return;
    kept.push(r);
    if (nonString) errors.push({ row, field: "code", message: `Row ${row + 1}: a code is 1–${BOX_CODE_MAX} letters or digits.` });
    else if (!code) errors.push({ row, field: "code", message: `Row ${row + 1}: enter a code.` });
    else if (!CODE_RE.test(code)) errors.push({ row, field: "code", message: `Row ${row + 1} (${code.slice(0, 12)}): a code is 1–${BOX_CODE_MAX} letters or digits.` });
    else if (seen.has(code)) errors.push({ row, field: "code", message: `Row ${row + 1} (${code}): that code is listed twice.` });
    else seen.add(code);
    const tag = code && !nonString ? ` (${code.slice(0, 12)})` : "";
    if (!description) errors.push({ row, field: "description", message: `Row ${row + 1}${tag}: enter a description.` });
    else if (description.length > BOX_DESC_MAX) errors.push({ row, field: "description", message: `Row ${row + 1}${tag}: a description is at most ${BOX_DESC_MAX} characters.` });
  });
  if (kept.length > BOX_TYPES_MAX) errors.push({ row: -1, field: "list", message: `At most ${BOX_TYPES_MAX} box types.` });
  if (errors.length) return { ok: false, errors };
  return { ok: true, types: sanitizeBoxTypes(kept) };
}
