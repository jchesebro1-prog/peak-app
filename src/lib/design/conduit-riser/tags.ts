/**
 * Riser tag fields (#321) — the Bray tag block's BOX · FACE · MOUNT · HT and
 * P/D, plus location, power-type letter and power-controls contents.
 *
 * A catalog part carries defaults (`tagDefaults`); a placement overrides per
 * field (`tag`). An empty-string override is a deliberate blank (the store
 * keeps one if written; the Tag panel never writes one in v1). Pure.
 */

import { crText } from "./model";

export type PdCell = "P" | "D" | "P/D" | "";
export type TagFields = { box?: string; face?: string; mount?: string; height?: string; pd?: PdCell };
export type PlacementTag = TagFields & { location?: string; power?: string; contents?: string };
export type EffectiveTag = {
  box: string;
  face: string;
  mount: string;
  height: string;
  pd: PdCell;
  location: string;
  power: string;
  contents: string;
};

export const TAG_LIMITS = { box: 4, face: 8, mount: 4, height: 8, location: 24, power: 2, contents: 60 } as const;

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

function cleanPd(v: unknown): PdCell | undefined {
  if (typeof v !== "string") return undefined;
  const s = v.trim().toUpperCase().replace(/\s+/g, "");
  return s === "P" || s === "D" || s === "P/D" || s === "" ? (s as PdCell) : undefined;
}

/** One field: absent stays absent; a string (even "") is kept, cleaned. */
function field(v: unknown, max: number, upper: boolean): string | undefined {
  if (typeof v !== "string") return undefined;
  const s = crText(v, max);
  return upper ? s.toUpperCase() : s;
}

function cleanFieldsInto(raw: Record<string, unknown>, out: PlacementTag): void {
  const box = field(raw.box, TAG_LIMITS.box, true);
  const face = field(raw.face, TAG_LIMITS.face, true);
  const mount = field(raw.mount, TAG_LIMITS.mount, true);
  const height = field(raw.height, TAG_LIMITS.height, false);
  const pd = cleanPd(raw.pd);
  if (box !== undefined) out.box = box;
  if (face !== undefined) out.face = face;
  if (mount !== undefined) out.mount = mount;
  if (height !== undefined) out.height = height;
  if (pd !== undefined) out.pd = pd;
}

/** A part's tag defaults, cleaned; undefined when nothing is set. */
export function cleanTagFields(raw: unknown): TagFields | undefined {
  if (!isObj(raw)) return undefined;
  const out: PlacementTag = {};
  cleanFieldsInto(raw, out);
  return Object.keys(out).length ? (out as TagFields) : undefined;
}

/** A placement's overrides, cleaned; undefined when nothing is set. */
export function cleanPlacementTag(raw: unknown): PlacementTag | undefined {
  if (!isObj(raw)) return undefined;
  const out: PlacementTag = {};
  cleanFieldsInto(raw, out);
  const location = field(raw.location, TAG_LIMITS.location, false);
  const power = field(raw.power, TAG_LIMITS.power, true);
  const contents = field(raw.contents, TAG_LIMITS.contents, false);
  if (location !== undefined) out.location = location;
  if (power !== undefined) out.power = power;
  if (contents !== undefined) out.contents = contents;
  return Object.keys(out).length ? out : undefined;
}

/** Part defaults, overridden per field by the placement; location falls back
 *  to the containing space's name. */
export function effectiveTag(
  placementTag: PlacementTag | undefined,
  partDefaults: TagFields | undefined,
  spaceName: string
): EffectiveTag {
  const p = placementTag || {};
  const d = partDefaults || {};
  return {
    box: p.box ?? d.box ?? "",
    face: p.face ?? d.face ?? "",
    mount: p.mount ?? d.mount ?? "",
    height: p.height ?? d.height ?? "",
    pd: p.pd ?? d.pd ?? "",
    location: p.location ?? spaceName,
    power: p.power ?? "",
    contents: p.contents ?? "",
  };
}

/** Every tag field a placement can override — the keys a patch may carry. */
export const TAG_FIELD_KEYS = ["box", "face", "mount", "height", "pd", "location", "power", "contents"] as const;
export type TagFieldKey = (typeof TAG_FIELD_KEYS)[number];
/** A per-field edit: a key absent = leave alone, a string = set (cleaned; ""
 *  is a deliberate blank), null = remove that field's override. */
export type TagPatch = Partial<Record<TagFieldKey, string | null>>;

/** True when `v` is a well-formed patch: an object whose keys are tag fields
 *  and values string | null — and a `pd` string is a real P/D cell ("", "P",
 *  "D" or "P/D", any case or spacing), never silently dropped. */
export function isTagPatch(v: unknown): v is TagPatch {
  return (
    isObj(v) &&
    Object.entries(v).every(
      ([k, x]) => (TAG_FIELD_KEYS as readonly string[]).includes(k) && (x === null || (typeof x === "string" && (k !== "pd" || cleanPd(x) !== undefined)))
    )
  );
}

/** Fields the store upper-cases on write (cleanPlacementTag). */
const UPPER_FIELDS: ReadonlySet<TagFieldKey> = new Set(["box", "face", "mount", "power", "pd"]);
const sameValue = (k: TagFieldKey, a: string, b: string) =>
  UPPER_FIELDS.has(k) ? a.trim().toUpperCase() === b.trim().toUpperCase() : a.trim() === b.trim();

/**
 * The riser Tag panel's save (#321 final review). `values` is what the form
 * shows, `effective` what it started from, `overrides` the placement's own
 * fields. Per field: a value still matching what it showed (any case for the
 * upper-cased fields) sends nothing — so retyping the inherited default never
 * creates an override; a cleared field the device overrides sends `null` —
 * revert to the part default (or the space name) — never `""`; clearing an
 * inherited value sends nothing. A deliberate blank isn't offered in v1. Pure.
 */
export function tagPanelPatch(values: EffectiveTag, effective: EffectiveTag, overrides: PlacementTag | undefined): TagPatch {
  const own = (overrides || {}) as Partial<Record<TagFieldKey, string>>;
  const patch: TagPatch = {};
  for (const k of TAG_FIELD_KEYS) {
    const v = values[k] ?? "";
    const cur = own[k];
    // Untouched — what it showed (a stored blank included) — is never a write.
    if (sameValue(k, v, effective[k] ?? "")) continue;
    if (!v.trim()) {
      if (cur !== undefined) patch[k] = null;
    } else if (cur === undefined || !sameValue(k, v, cur)) {
      patch[k] = v;
    }
  }
  return patch;
}

/**
 * Apply a patch to a placement's overrides: merge per field, clean the result
 * (cleanPlacementTag), and report `previous` — a patch that restores exactly
 * the prior value of only the touched fields (their old string, or null when
 * they had no override). An all-empty result is `tag: undefined`. Pure.
 */
export function applyTagPatch(current: PlacementTag | undefined, patch: TagPatch): { tag: PlacementTag | undefined; previous: TagPatch } {
  const cur: Record<string, string> = { ...((current || {}) as Record<string, string>) };
  const previous: TagPatch = {};
  for (const key of TAG_FIELD_KEYS) {
    if (!(key in patch) || patch[key] === undefined) continue;
    previous[key] = cur[key] !== undefined ? cur[key] : null;
    const v = patch[key];
    if (v === null) delete cur[key];
    else cur[key] = v;
  }
  return { tag: cleanPlacementTag(cur), previous };
}
