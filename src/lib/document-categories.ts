/**
 * Documents (#218) — the editable category list. Pure. Stored whole in the
 * app settings row as `documentCategories` (Settings → Admin → Document
 * categories); absent reads as the seed. Keys are minted server-side from
 * the label and never change; a row dropped in the editor is kept archived
 * (old files keep their label, new uploads can't pick it). `other` always
 * exists, can't be archived, and is what an unknown key reads as.
 */
import { cleanText } from "./document-files";

export type DocumentCategory = { key: string; label: string; order: number; archived?: boolean };
export type DocumentCategoryInput = { key?: string; label: string; archived?: boolean };

export const OTHER_CATEGORY = "other";
export const MAX_DOCUMENT_CATEGORIES = 40;

export const SEED_DOCUMENT_CATEGORIES: readonly DocumentCategory[] = [
  { key: "drawings", label: "Drawings", order: 0 },
  { key: "show_files", label: "Show files", order: 1 },
  { key: "user_data", label: "User data", order: 2 },
  { key: "forms", label: "Forms", order: 3 },
  { key: "photos", label: "Photos", order: 4 },
  { key: "contracts", label: "Contracts", order: 5 },
  { key: OTHER_CATEGORY, label: "Other", order: 6 },
];

const KEY_RE = /^[a-z0-9_]{1,40}$/;

/** The stored list, sanitized: bad/duplicate keys dropped, labels trimmed,
 *  `other` guaranteed and never archived, `order` re-numbered 0…n-1. */
export function resolveDocumentCategories(stored: unknown): DocumentCategory[] {
  if (!Array.isArray(stored) || !stored.length) return SEED_DOCUMENT_CATEGORIES.map((c) => ({ ...c }));
  const seen = new Set<string>();
  const out: DocumentCategory[] = [];
  for (const raw of stored) {
    if (!raw || typeof raw !== "object") continue;
    const r = raw as Record<string, unknown>;
    const key = typeof r.key === "string" ? r.key : "";
    // Same cleaner as every other stored document text (no control chars,
    // capped by code point so an emoji is never split).
    const label = typeof r.label === "string" ? cleanText(r.label, 40) : "";
    if (!KEY_RE.test(key) || seen.has(key) || !label) continue;
    seen.add(key);
    const c: DocumentCategory = { key, label, order: Number.isFinite(r.order) ? Number(r.order) : out.length };
    if (r.archived === true && key !== OTHER_CATEGORY) c.archived = true;
    out.push(c);
  }
  if (!seen.has(OTHER_CATEGORY)) out.push({ key: OTHER_CATEGORY, label: "Other", order: Number.MAX_SAFE_INTEGER });
  return out.sort((a, b) => a.order - b.order).map((c, i) => ({ ...c, order: i }));
}

export function activeDocumentCategories(cats: readonly DocumentCategory[]): DocumentCategory[] {
  return cats.filter((c) => !c.archived);
}

export function categoryLabel(cats: readonly DocumentCategory[], key: string): string {
  return cats.find((c) => c.key === key)?.label ?? cats.find((c) => c.key === OTHER_CATEGORY)?.label ?? "Other";
}

/** Any listed key (archived included) stays; anything else reads as Other. */
export function normalizeCategory(cats: readonly DocumentCategory[], key: unknown): string {
  return typeof key === "string" && cats.some((c) => c.key === key) ? key : OTHER_CATEGORY;
}

/** New uploads may only land in an ACTIVE category; anything else is Other. */
export function uploadCategory(cats: readonly DocumentCategory[], key: unknown): string {
  return typeof key === "string" && cats.some((c) => c.key === key && !c.archived) ? key : OTHER_CATEGORY;
}

export function slugCategoryKey(label: string, taken: ReadonlySet<string>): string {
  const base = label.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 36) || "category";
  let key = base;
  let n = 2;
  while (taken.has(key)) key = `${base}_${n++}`;
  return key;
}

/** The editor's whole-list save over the stored (resolved) list. */
export function mergeDocumentCategories(
  stored: readonly DocumentCategory[],
  input: unknown
): { ok: true; categories: DocumentCategory[] } | { ok: false; error: string } {
  if (!Array.isArray(input)) return { ok: false, error: "Nothing to save." };
  const known = new Set(stored.map((c) => c.key));
  const taken = new Set(known);
  const used = new Set<string>();
  const labels = new Set<string>();
  const out: DocumentCategory[] = [];
  for (const raw of input) {
    const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
    // cleanText (control chars stripped, trimmed), capped one past the limit
    // so an over-long name is refused rather than silently cut.
    const label = typeof r.label === "string" ? cleanText(r.label, 41) : "";
    if (!label) return { ok: false, error: "Every category needs a name." };
    if ([...label].length > 40) return { ok: false, error: `"${cleanText(label, 40)}…" is longer than 40 characters.` };
    const archived = r.archived === true;
    if (!archived) {
      const lower = label.toLowerCase();
      if (labels.has(lower)) return { ok: false, error: `Two categories are named "${label}".` };
      labels.add(lower);
    }
    let key = typeof r.key === "string" ? r.key : "";
    if (key) {
      if (!known.has(key)) return { ok: false, error: `Unknown category "${key}".` };
    } else {
      key = slugCategoryKey(label, taken);
      taken.add(key);
    }
    if (used.has(key)) return { ok: false, error: `"${label}" is listed twice.` };
    used.add(key);
    const c: DocumentCategory = { key, label, order: out.length };
    if (archived) {
      if (key === OTHER_CATEGORY) return { ok: false, error: "Other can't be archived — it holds anything without a category." };
      c.archived = true;
    }
    out.push(c);
  }
  // Keys are immutable and files may still point at a row the editor
  // dropped, so a missing stored row stays — archived (Other: active).
  for (const c of stored) {
    if (used.has(c.key)) continue;
    const kept: DocumentCategory = { key: c.key, label: c.label, order: out.length };
    if (c.key !== OTHER_CATEGORY) kept.archived = true;
    out.push(kept);
  }
  if (out.length > MAX_DOCUMENT_CATEGORIES) return { ok: false, error: `At most ${MAX_DOCUMENT_CATEGORIES} categories.` };
  return { ok: true, categories: out };
}
