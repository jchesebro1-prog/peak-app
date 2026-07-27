import type { PartLite } from "./grid-bom";
import { isPerLengthUnit } from "./grid-bom";

/* ------------------------------------------------------------------ *
 * The Grid — labor auto-suggest (D113 item 5, logged D114). Pure and
 * dependency-free like its siblings; the editor's BOM panel and the
 * quote action share it.
 *
 * DaVinci carries "BomServices" — service lines derived from the BOM.
 * This v1 keeps the rule deliberately small: every painted device earns
 * `hoursPerDevice` install hours (a pricing-rules knob), bucketed by
 * discipline guessed from the part's category, priced at the catalog's
 * own labor rates (role "labor", matching discipline). Suggestions are
 * editable and optional at quote time — the rule proposes, the human
 * disposes. No labor parts in the catalog → no suggestions: rates are
 * never invented.
 * ------------------------------------------------------------------ */

export type LaborPartLite = PartLite & {
  /** Catalog labor rows carry these ('RIG' | 'LIG' | 'AUD' | 'VID' + role). */
  discipline?: string;
  role?: string;
};

export type LaborSuggestion = {
  partId: string;
  desc: string;
  /** $/hr list rate from the catalog row. */
  rate: number;
  hours: number;
  discipline: string;
};

/** Category → discipline, by keyword. Unknown trades default to rigging —
 *  Peak's home discipline and the conservative (highest-rate) bucket. */
function disciplineOf(category: string): string {
  const c = category.toLowerCase();
  if (c.includes("light")) return "LIG";
  if (c.includes("audio") || c.includes("sound")) return "AUD";
  if (c.includes("video") || c.includes("projection")) return "VID";
  return "RIG";
}

/** Round up to the half hour — labor is scheduled, not metered. */
function halfHourUp(h: number): number {
  return Math.ceil(h * 2) / 2;
}

export function suggestLabor(
  placements: Array<{ partId: string; curtain?: unknown }>,
  parts: PartLite[],
  laborParts: LaborPartLite[],
  hoursPerDevice: number
): LaborSuggestion[] {
  if (!(hoursPerDevice > 0)) return [];
  const byId = new Map(parts.map((p) => [p.id, p]));
  const labor = laborParts.filter((p) => (p.role || "").toLowerCase() === "labor");
  if (!labor.length) return [];

  // Devices per discipline — wire, labor, and per-length rows don't count.
  const deviceCount = new Map<string, number>();
  for (const pl of placements) {
    // Curtains (punch #49) are not devices: hanging a 40 ft grand drape has
    // nothing to do with an hours-per-device rule, and its partId points at a
    // fabric row. No suggestion is better than an invented one.
    if (pl.curtain) continue;
    const part = byId.get(pl.partId);
    if (!part) continue;
    const cat = part.category.toLowerCase();
    if (cat.includes("labor") || cat.includes("wire") || cat.includes("cable")) continue;
    if (isPerLengthUnit(part.unit)) continue;
    const d = disciplineOf(part.category);
    deviceCount.set(d, (deviceCount.get(d) || 0) + 1);
  }

  const out: LaborSuggestion[] = [];
  for (const [discipline, n] of deviceCount) {
    const rateRow =
      labor.find((p) => (p.discipline || "").toUpperCase() === discipline) || labor[0];
    const hours = halfHourUp(n * hoursPerDevice);
    if (hours <= 0) continue;
    out.push({
      partId: rateRow.id,
      desc: rateRow.desc,
      rate: rateRow.list,
      hours,
      discipline,
    });
  }
  return out.sort((a, b) => b.hours * b.rate - a.hours * a.rate);
}
