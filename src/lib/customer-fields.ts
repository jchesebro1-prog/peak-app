/**
 * Customer custom fields (#23) — PURE definition + value helpers. ZERO
 * imports of any kind: this module is spec-tested, client-bundled (the edit
 * modal calls defsForType live) and server-trusted (the save actions call
 * the validators), so it must never reach a store, the db layer, or even a
 * value list that does.
 *
 * The system copies the catalogCategoryMap tier-3 precedent: definitions
 * live in AppSettingsData.customerFieldDefs (FULL REPLACEMENT on save —
 * resolveFieldDefs(stored) = stored ?? [], no code defaults), values live
 * per-company in the relational companies.custom jsonb column keyed by
 * CustomFieldDef.id. Ids are minted from the label at create time
 * (slugifyFieldId, server-side) and are IMMUTABLE after — they key stored
 * values, so renaming a label never re-keys data.
 *
 * appliesTo holds venue-type names (the CUSTOMER_TYPES vocabulary in
 * companies/lib.ts); [] means "all types". Deliberately NOT validated
 * against the type list here — value lists are configuration, not schema
 * (the identity/config.ts philosophy): an unknown type simply never
 * matches, harmlessly.
 */

export const FIELD_KINDS = ["text", "number", "date", "select", "checkbox"] as const;
export type FieldKind = (typeof FIELD_KINDS)[number];

export type CustomFieldDef = {
  /** Stable slug, minted from the label at create; immutable after. */
  id: string;
  label: string; // ≤ MAX_LABEL
  kind: FieldKind;
  /** select only: 1..MAX_OPTIONS entries, each ≤ MAX_OPTION_LEN. */
  options?: string[];
  /** Venue types this field shows for; [] = all types. */
  appliesTo: string[];
};

/** The value shape stored in companies.custom (date = epoch-ms number). */
export type CustomFieldValues = Record<string, string | number | boolean | null>;

export const MAX_FIELD_DEFS = 30;
export const MAX_LABEL = 60;
export const MAX_OPTIONS = 20;
export const MAX_OPTION_LEN = 40;
export const MAX_TEXT_LEN = 500;

/** stored ?? [] — there are no code defaults (the wireTypes idiom). */
export function resolveFieldDefs(
  stored: CustomFieldDef[] | null | undefined
): CustomFieldDef[] {
  return Array.isArray(stored) ? stored : [];
}

/** Mint a stable id from a label, suffixing past taken ids. */
export function slugifyFieldId(label: string, taken: Set<string> | string[]): string {
  const t = taken instanceof Set ? taken : new Set(taken);
  const base =
    (label || "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "field";
  let id = base;
  let i = 2;
  while (t.has(id)) {
    id = `${base}-${i}`;
    i++;
  }
  return id;
}

/** The defs that apply to a venue type — empty appliesTo = all types. */
export function defsForType(defs: CustomFieldDef[], type: string): CustomFieldDef[] {
  return defs.filter((d) => !d.appliesTo?.length || d.appliesTo.includes(type));
}

/**
 * Server-side value gate (never trust the client): unknown ids stripped,
 * kind-checked per def — text trimmed (≤ MAX_TEXT_LEN; whitespace-only →
 * null), number coerced-or-dropped, date must be an epoch-ms number,
 * select must be one of the def's options, checkbox must be boolean.
 * null always clears.
 */
export function validateFieldValues(
  defs: CustomFieldDef[],
  input: Record<string, unknown> | null | undefined
): CustomFieldValues {
  const out: CustomFieldValues = {};
  if (!input || typeof input !== "object") return out;
  for (const d of defs) {
    if (!(d.id in input)) continue;
    const v = (input as Record<string, unknown>)[d.id];
    if (v === null) {
      out[d.id] = null;
      continue;
    }
    switch (d.kind) {
      case "text": {
        if (typeof v === "string") out[d.id] = v.trim().slice(0, MAX_TEXT_LEN) || null;
        break;
      }
      case "number": {
        const n =
          typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
        if (Number.isFinite(n)) out[d.id] = n;
        break;
      }
      case "date": {
        if (typeof v === "number" && Number.isFinite(v)) out[d.id] = v;
        break;
      }
      case "select": {
        if (typeof v === "string" && (d.options ?? []).includes(v)) out[d.id] = v;
        break;
      }
      case "checkbox": {
        if (typeof v === "boolean") out[d.id] = v;
        break;
      }
    }
  }
  return out;
}

/** Whole-list validation for the admin save — first failure wins. */
export function validateFieldDefs(
  defs: CustomFieldDef[]
): { ok: true } | { ok: false; error: string } {
  if (defs.length > MAX_FIELD_DEFS)
    return { ok: false, error: `At most ${MAX_FIELD_DEFS} custom fields.` };
  const seen = new Set<string>();
  for (const d of defs) {
    if (!d.id || !/^[a-z0-9-]+$/.test(d.id))
      return { ok: false, error: `"${d.label || d.id}" has an invalid id.` };
    if (seen.has(d.id)) return { ok: false, error: `Duplicate field id "${d.id}".` };
    seen.add(d.id);
    if (!(d.label || "").trim()) return { ok: false, error: `Field "${d.id}" needs a label.` };
    if (d.label.length > MAX_LABEL)
      return { ok: false, error: `"${d.label.slice(0, 20)}…" — labels cap at ${MAX_LABEL} chars.` };
    if (!(FIELD_KINDS as readonly string[]).includes(d.kind))
      return { ok: false, error: `"${d.label}" has an unknown kind.` };
    if (d.kind === "select") {
      const opts = d.options ?? [];
      if (!opts.length)
        return { ok: false, error: `"${d.label}" is a dropdown but has no options.` };
      if (opts.length > MAX_OPTIONS)
        return { ok: false, error: `"${d.label}" — at most ${MAX_OPTIONS} options.` };
      for (const o of opts)
        if (!o.trim() || o.length > MAX_OPTION_LEN)
          return { ok: false, error: `"${d.label}" has an empty or over-${MAX_OPTION_LEN}-char option.` };
    }
  }
  return { ok: true };
}
