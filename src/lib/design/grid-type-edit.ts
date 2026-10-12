/**
 * Grid notes #2 — the Grid's Type control (Property Editor + Spreadsheet):
 * which catalog parts a selection's Type edit touches, what each will read as
 * afterwards, and whether a device's designator prefix would change. Pure and
 * client-safe (the grid-bom rule); the write is setPartDeviceTypeAction.
 */
import type { PartLite } from "./grid-bom";
import { effectiveTypeCode, normalizeRawCategory, typeLabel, type DeviceType } from "./device-types";
import { cleanDesignator } from "./designators";

/** The PartLite slice the Type control reads. */
export type TypeEditPart = Pick<
  PartLite,
  "id" | "pricingPartId" | "kind" | "virtual" | "allowance" | "catalogCategory" | "deviceTypeOverride" | "categoryDeviceType" | "deviceType" | "designatorCode"
>;

/** A part whose type an admin can set: a catalog-linked device (gridPartsFrom
 *  stamped its raw category) — never an assembly, allowance or virtual part. */
export function isTypeEditable(p: TypeEditPart | null | undefined): p is TypeEditPart & { catalogCategory: string } {
  return !!p && p.catalogCategory !== undefined && !p.virtual && !p.allowance && p.kind !== "assembly" && !(p.id || "").startsWith("asm:");
}

/** The catalog SKU a Type edit writes for this part. */
export const typeEditSku = (p: TypeEditPart): string => p.pricingPartId || p.id;

export type TypeEditTarget = { sku: string; part: TypeEditPart & { catalogCategory: string } };

/** The distinct editable catalog parts behind a selection's devices
 *  (curtains and non-editable parts left out), in first-seen order. */
export function typeEditTargets(
  pls: ReadonlyArray<{ partId: string; curtain?: unknown }>,
  partById: ReadonlyMap<string, TypeEditPart>
): TypeEditTarget[] {
  const out = new Map<string, TypeEditTarget>();
  for (const pl of pls) {
    if (pl.curtain) continue;
    const part = partById.get(pl.partId);
    if (!isTypeEditable(part)) continue;
    const sku = typeEditSku(part);
    if (!out.has(sku)) out.set(sku, { sku, part });
  }
  return [...out.values()];
}

/** The select's value for these parts: their shared override, "" when none
 *  has one (Auto), MIXED otherwise. */
export const MIXED_TYPE = "__mixed";
export function sharedOverride(targets: readonly TypeEditTarget[]): string {
  const vals = new Set(targets.map((t) => t.part.deviceTypeOverride || ""));
  return vals.size === 1 ? [...vals][0] : MIXED_TYPE;
}

/** The distinct raw categories (normalized key → first spelling) of the targets. */
export function targetCategories(targets: readonly TypeEditTarget[]): Array<{ key: string; label: string }> {
  const out = new Map<string, string>();
  for (const t of targets) {
    const key = normalizeRawCategory(t.part.catalogCategory);
    if (key && !out.has(key)) out.set(key, t.part.catalogCategory.trim());
  }
  return [...out.entries()].map(([key, label]) => ({ key, label }));
}

/** "Auto" names what each part falls back to: one category → "Auto (from
 *  category: Audio → Microphones)"; several → "Auto (from each part's category)". */
export function autoTypeOptionLabel(targets: readonly TypeEditTarget[], types: readonly DeviceType[]): string {
  const cats = targetCategories(targets);
  if (cats.length !== 1) return "Auto (from each part's category)";
  const key = targets[0]?.part.categoryDeviceType ?? null;
  return `Auto (from category: ${cats[0].label} → ${key ? typeLabel(key, types) : "Unmapped"})`;
}

/** What a part's type reads as after the edit (null = unmapped). */
export function typeAfterEdit(part: TypeEditPart, typeKey: string | null, wholeCategory: boolean): string | null {
  if (wholeCategory) return typeKey;
  return typeKey ?? part.categoryDeviceType ?? null;
}

/**
 * True when a numbered device among `pls` would print a different prefix
 * after the edit — its part has no designator code of its own, and the old
 * and new types' codes differ. Designators are never renumbered by a type
 * change (Renumber → "Apply current type codes" re-issues them).
 */
export function prefixWouldChange(
  pls: ReadonlyArray<{ partId: string; curtain?: unknown; designator?: string }>,
  partById: ReadonlyMap<string, TypeEditPart>,
  typeKey: string | null,
  wholeCategory: boolean,
  types: readonly DeviceType[]
): boolean {
  const codeOf = (key: string | null | undefined) => {
    const t = key ? types.find((x) => x.key === key && !x.archived) : undefined;
    return t ? effectiveTypeCode(t) : null;
  };
  return pls.some((pl) => {
    if (pl.curtain || !cleanDesignator(pl.designator)) return false;
    const part = partById.get(pl.partId);
    if (!isTypeEditable(part) || part.designatorCode) return false;
    return codeOf(part.deviceType) !== codeOf(typeAfterEdit(part, typeKey, wholeCategory));
  });
}

export const PREFIX_HINT = "Designators keep their numbers — Renumber to apply the new prefix.";
export const TYPE_NOT_UNDOABLE = "Changes the catalog part's type everywhere it is used — not on the Grid's undo stack (⌘Z).";
