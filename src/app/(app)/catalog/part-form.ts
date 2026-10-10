/**
 * Pure halves of catalog/actions.ts, so the harness can test them.
 */
import { normalizeVisibility } from "@/lib/portal-visibility";
import { isFabricPart } from "@/lib/fabric-part";
import { cleanTypeCode } from "@/lib/design/device-types";
import { cleanTagFields, type TagFields } from "@/lib/design/conduit-riser/tags";
import { CABLE_OD_MAX_IN, cleanCableOd } from "@/lib/design/conduit-riser/cable-od";
import { cleanRackFacts, rackFactsFromForm } from "@/lib/rack/part-facts";
import type { RackPartFacts } from "@/lib/rack/types";

function num(v: FormDataEntryValue | null): number {
  const n = parseFloat(String(v ?? "").replace(/[^0-9.\-]/g, ""));
  return isNaN(n) ? 0 : n;
}

/** A positive, finite number, else undefined — a blank, zero, negative or junk
 *  value clears the field (#227). */
function positive(v: FormDataEntryValue | null): number | undefined {
  const n = num(v);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

export type OptionalPartFields = {
  manufacturerPartNumber?: string;
  manufacturerModelNumber?: string;
  mapPrice?: number;
  /** #227 — Fabric parts only: fabric cost per sq ft of sewn area (estimates add sewing, #227 late). */
  curtainAreaRate?: number;
  /** #227 — Fabric parts only: bolt width in inches. */
  boltWidthIn?: number;
  /** #245 Task 5 — an explicit Show/Hide portal-visibility override; Auto is
   *  stored as absent (undefined clears through mergeUpsert). */
  portalVisibility?: "show" | "hide" | undefined;
  /** #292 — Fabric parts only: weight, its basis and flame rating (cut sheets). */
  oz?: number;
  ozBasis?: "lin-yd" | "sq-yd";
  flameRating?: string;
  /** #321 — the part's own Grid designator code; blank/invalid clears it. */
  designatorCode?: string;
  /** #321 — the riser tag defaults; all blank clears them. */
  tagDefaults?: TagFields;
  /** #328 B1 — a per-length part's outside diameter (inches); blank/invalid clears it. */
  cableOdIn?: number;
} & RackPartFacts;

export const FLAME_RATING_MAX = 120;

/**
 * Fields the part modal may or may not render. A key the form did NOT submit
 * stays out of the patch, so mergeUpsert keeps the stored value; a submitted
 * blank clears it (an explicit undefined wins in mergeUpsert). Same rule
 * upsertPart already applies to `ports`. The two fabric fields render only on
 * a Fabric part (#227), so any other part's save never touches them.
 */
export function optionalPartFields(fd: FormData): OptionalPartFields {
  const text = (k: string) => String(fd.get(k) || "").trim() || undefined;
  const out: OptionalPartFields = {};
  if (fd.has("manufacturerPartNumber")) out.manufacturerPartNumber = text("manufacturerPartNumber");
  if (fd.has("manufacturerModelNumber")) out.manufacturerModelNumber = text("manufacturerModelNumber");
  if (fd.has("mapPrice")) out.mapPrice = num(fd.get("mapPrice"));
  if (fd.has("curtainAreaRate")) out.curtainAreaRate = positive(fd.get("curtainAreaRate"));
  if (fd.has("boltWidthIn")) out.boltWidthIn = positive(fd.get("boltWidthIn"));
  if (fd.has("oz")) out.oz = positive(fd.get("oz"));
  if (fd.has("ozBasis")) {
    const b = String(fd.get("ozBasis") || "");
    out.ozBasis = out.oz !== undefined && (b === "lin-yd" || b === "sq-yd") ? b : undefined;
  }
  if (fd.has("flameRating")) out.flameRating = String(fd.get("flameRating") || "").trim().slice(0, FLAME_RATING_MAX) || undefined;
  if (fd.has("designatorCode")) out.designatorCode = cleanTypeCode(fd.get("designatorCode")) ?? undefined;
  if (TAG_DEFAULT_KEYS.some((k) => fd.has(`tag_${k}`))) out.tagDefaults = tagDefaultsFromForm(fd);
  if (fd.has("cableOdIn")) out.cableOdIn = cleanCableOd(fd.get("cableOdIn")) ?? undefined;
  if (fd.has("portalVisibility")) {
    const v = normalizeVisibility(fd.get("portalVisibility"));
    out.portalVisibility = v === "auto" ? undefined : v;
  }
  // #296: rack data — same rule (only submitted keys; a blank clears). An
  // invalid value is dropped here; rackFactsProblem refuses the save first.
  const rack = cleanRackFacts(rackFactsFromForm(fd));
  if (rack.ok) Object.assign(out, rack.patch);
  return out;
}

const TAG_DEFAULT_KEYS = ["box", "face", "mount", "height", "pd"] as const;

/** #321: the part's tag defaults from `tag_*` inputs. A blank field is simply
 *  not set (a part default has no "deliberate blank"); nothing set → undefined. */
export function tagDefaultsFromForm(fd: FormData): TagFields | undefined {
  const raw: Record<string, string> = {};
  for (const k of TAG_DEFAULT_KEYS) {
    const v = String(fd.get(`tag_${k}`) ?? "").trim();
    if (v) raw[k] = v;
  }
  return cleanTagFields(raw);
}

/** #328 B1: server-side gate for the cable outside diameter. null = fine (blank
 *  clears, or the form carries no such field); else the message the part modal shows. */
export function cableOdProblem(fd: FormData): string | null {
  if (!fd.has("cableOdIn")) return null;
  const raw = String(fd.get("cableOdIn") ?? "").trim();
  if (!raw || cleanCableOd(raw) !== null) return null;
  return `Outside diameter must be a number above 0 and at most ${CABLE_OD_MAX_IN.toFixed(1)} inches.`;
}

/** #296: server-side gate for the Rack data section. null = fine (or the form
 *  carries no rack fields); else the message the part modal shows. */
export function rackFactsProblem(fd: FormData): string | null {
  const r = cleanRackFacts(rackFactsFromForm(fd));
  return r.ok ? null : r.error;
}

/** A sane ceiling for a sewn fabric's $/sq ft (#227 final wave B) — the real
 *  book runs a few dollars; anything past this is a typo (a bolt price, cents). */
export const FABRIC_AREA_RATE_MAX = 500;

/**
 * Server-side gate for the fabric rate (#227 final wave B): only a fabric part
 * (#264: isFabricPart — category Fabric, or Theatrical/Soft Goods sold per
 * sq ft) carries one, and never above FABRIC_AREA_RATE_MAX. `rate` is what
 * optionalPartFields parsed (undefined = cleared or not submitted — always
 * fine). null = fine, else the message the part modal shows.
 */
export function fabricRateProblem(category: string, rate: number | undefined, unit?: string | null): string | null {
  if (rate === undefined) return null;
  if (!isFabricPart({ category, unit }))
    return "Only a fabric part (category Fabric, or Theatrical/Soft Goods sold per sq ft) carries a fabric $/sq ft rate — clear the rate or change the category.";
  if (rate > FABRIC_AREA_RATE_MAX)
    return `A fabric rate over $${FABRIC_AREA_RATE_MAX}/sq ft looks like a typo — enter the cost per sq ft of sewn fabric.`;
  return null;
}

/** #292: only a fabric part carries weight / flame rating (the fields render only there; this is the server gate). */
export function fabricFactsProblem(category: string, unit: string | null | undefined, f: Pick<OptionalPartFields, "oz" | "ozBasis" | "flameRating">): string | null {
  if (f.oz === undefined && f.ozBasis === undefined && f.flameRating === undefined) return null;
  return isFabricPart({ category, unit }) ? null : "Only a fabric part carries a weight or flame rating — clear them or change the category.";
}

/**
 * `specSort` (order within an article) legitimately wants to be 0 — the
 * first item. `Number(v) || undefined` treats 0 as falsy and silently clears
 * it back to "unset" on every save. Only blank/NaN/non-finite input clears
 * the field; an explicit 0 (or any other finite number) is kept.
 */
export function specSortValue(v: unknown): number | undefined {
  const n = Number(v);
  return Number.isFinite(n) && String(v ?? "").trim() !== "" ? n : undefined;
}

/** The same-as rules the Spec panel's save enforces. null = fine. */
export function validateSameAs(
  sku: string,
  sameAs: string,
  target: { sku: string; specSameAs?: string } | null
): string | null {
  const want = String(sameAs || "").trim();
  if (!want) return null;
  if (want.toUpperCase() === String(sku || "").trim().toUpperCase()) return "A part cannot be the same spec as itself.";
  if (!target) return `Same spec as ${want} — no such part.`;
  if ((target.specSameAs || "").trim()) {
    return `${want} is itself a "same spec as" pointer — point at the part that holds the text.`;
  }
  return null;
}
