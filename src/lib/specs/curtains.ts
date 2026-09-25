import { fillSlots } from "@/lib/specs/outline";
import type { GridCurtain } from "@/lib/design/grid-bom";
import type { CurtainFullnessKey, SpecCurtainTemplate } from "@/lib/stores/spec-curtain-templates";

/**
 * Curtains never match a catalog part — The Grid mints SKU "CURTAIN" for every
 * one of them — so a curtain row resolves to its type's template and the
 * placement's own configuration fills the slots. Pure, so the part editor's
 * preview and Phase B's assembly cannot disagree.
 *
 * `import type` only from the store module: this runs in a client component.
 */

const FULLNESS_STOPS: Array<[number, CurtainFullnessKey]> = [
  [0, "0"],
  [50, "50"],
  [75, "75"],
  [100, "100"],
];

/** The nearest defined clause at or below the placement's fullness. */
export function fullnessKey(pct: number): CurtainFullnessKey {
  const n = Number(pct);
  if (!Number.isFinite(n) || n <= 0) return "0";
  let key: CurtainFullnessKey = "0";
  for (const [stop, k] of FULLNESS_STOPS) if (n >= stop) key = k;
  return key;
}

/**
 * One entry per type + fabric + colour + fullness. Sizes and quantities are
 * deliberately NOT in the key: the specimen defers both to the curtain
 * schedule, so two legs of the same goods are one spec entry.
 */
export function curtainGroupKey(c: GridCurtain, fabricName: string): string {
  return [
    c.type,
    String(fabricName || c.fabricSku || "").trim().toLowerCase(),
    String(c.color || "").trim().toLowerCase(),
    fullnessKey(c.fullnessPct),
  ].join("|");
}

function feet(n: number): string {
  const v = Number(n);
  if (!Number.isFinite(v)) return "";
  return Number.isInteger(v) ? String(v) : v.toFixed(1);
}

export function fillCurtainTemplate(
  tpl: SpecCurtainTemplate,
  curtain: GridCurtain,
  fabricName: string
): { title: string; body: string } {
  const key = fullnessKey(curtain.fullnessPct);
  const body = fillSlots(tpl.body, {
    name: String(curtain.name || tpl.title || "").trim(),
    material: String(fabricName || curtain.fabricSku || "").trim(),
    color: String(curtain.color || "").trim() || tpl.defaultColor,
    fullness: `${key}%`,
    fullnessClause: tpl.fullnessClauses[key] || "",
    hang: tpl.hang,
    width: feet(curtain.widthFt),
    height: feet(curtain.heightFt),
  });
  return { title: tpl.title, body };
}
