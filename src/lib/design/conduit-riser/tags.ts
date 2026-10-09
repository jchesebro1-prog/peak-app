/**
 * Riser tag fields (#321) — the Bray tag block's BOX · FACE · MOUNT · HT and
 * P/D, plus location, power-type letter and power-controls contents.
 *
 * A catalog part carries defaults (`tagDefaults`); a placement overrides per
 * field (`tag`). An empty-string override is a deliberate blank. Pure.
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
