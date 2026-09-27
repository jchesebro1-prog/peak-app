/**
 * The Grid BOM, grouped by category (#230) — pure and client-safe (the
 * grid-bom.ts rule): the editor's BOM sidebar renders what this returns and
 * the spec harness pins it.
 *
 * Seven headings in Jeff's order — Rigging, Curtains, Lighting, Audio,
 * Video, Controls, General. The keys are the Quick Design system keys
 * (SysKey) plus "general", so per-system figures (#231 wire pull, #232
 * labor) land in the group of the same key with no mapping table.
 *
 * Where a line lands:
 *  - a placed device or a wire run → groupOfPart: the system Auto painted
 *    it for (auto tag / D320 origin) when that is exactly one BOM system;
 *    else a control device type (CONTROLS_TYPE_KEYS) → Controls; else the
 *    part's Grid scope (device type first, #226), Unscoped → General;
 *  - a curtain drop-in → Curtains;
 *  - a custom item (#212) → its `system` (absent → General);
 *  - an accessory → the heading it was added under (its stored `scope`);
 *  - a labor line (#232) → the heading of its system (the keys are the
 *    same), printed last and counted in that heading's total.
 *
 * #232: each heading's labor is computed by buildGridQuote over that
 * heading's non-labor lines — the same partition this function makes, over
 * tier-priced lines — so the editor and the quote agree on which lines
 * count as a system's material.
 */
import type { BomLine } from "./grid-bom";
import { customItemPartId, type CustomItemSystem, type GridCustomItem } from "./grid-custom-items";
import { isGridLayer, scopeOfPart, type GridLayer, type ScopedPartLite } from "./grid-scopes";
import type { GridLaborLine } from "./wire-labor";

export const BOM_GROUPS = [
  { key: "rigging", label: "Rigging" },
  { key: "curtains", label: "Curtains" },
  { key: "lighting", label: "Lighting" },
  { key: "audio", label: "Audio" },
  { key: "video", label: "Video" },
  { key: "controls", label: "Controls" },
  { key: "general", label: "General" },
] as const;

export type BomGroupKey = (typeof BOM_GROUPS)[number]["key"];

export const BOM_GROUP_KEYS: readonly BomGroupKey[] = BOM_GROUPS.map((g) => g.key);

export function isBomGroupKey(v: unknown): v is BomGroupKey {
  return typeof v === "string" && (BOM_GROUP_KEYS as readonly string[]).includes(v);
}

export function bomGroupLabel(key: BomGroupKey): string {
  return BOM_GROUPS.find((g) => g.key === key)?.label ?? "General";
}

/**
 * #226 seed device types that print under Controls rather than their layer:
 * consoles/networking, dimming/power control and rigging control — the
 * Quick Design "controls" system's equipment. The Grid's layers keep their
 * own scope (a console still sits on the Lighting layer); only the BOM
 * heading differs.
 */
export const CONTROLS_TYPE_KEYS: readonly string[] = ["control-networking", "dimming-power", "rigging-control"];

const LAYER_GROUP: Record<GridLayer, BomGroupKey> = {
  Lighting: "lighting",
  Rigging: "rigging",
  Curtains: "curtains",
  Audio: "audio",
  Video: "video",
  Unscoped: "general",
};

export function groupOfLayer(layer: GridLayer): BomGroupKey {
  return LAYER_GROUP[layer] ?? "general";
}

/** The grouping slice of a part — PartLite satisfies it structurally. */
export type GroupablePart = ScopedPartLite & { deviceType?: string | null };

export function groupOfPart(part: GroupablePart | null | undefined, autoSystems?: ReadonlySet<string>): BomGroupKey {
  if (autoSystems && autoSystems.size) {
    const hits = [...autoSystems].filter((s): s is BomGroupKey => isBomGroupKey(s) && s !== "general");
    if (hits.length === 1) return hits[0];
  }
  if (part?.deviceType && CONTROLS_TYPE_KEYS.includes(part.deviceType)) return "controls";
  return groupOfLayer(scopeOfPart(part));
}

/** The placement slice groupOfPart's Auto provenance needs (GridPlacement fits). */
export type AutoPlacementLite = {
  partId: string;
  curtain?: unknown;
  auto?: { scope: string } | null;
  autoOrigin?: { scope: string } | null;
};

/** partId → the Auto systems its placements were painted for (auto tag, else D320 origin). */
export function autoSystemsByPart(placements: ReadonlyArray<AutoPlacementLite>): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  for (const pl of placements) {
    if (pl.curtain) continue;
    const s = pl.auto?.scope ?? pl.autoOrigin?.scope;
    if (!s) continue;
    const set = out.get(pl.partId) ?? new Set<string>();
    set.add(s);
    out.set(pl.partId, set);
  }
  return out;
}

/** The custom-item `system` each heading stores (General stores none). */
export const CUSTOM_SYSTEM_OF_GROUP: Record<BomGroupKey, CustomItemSystem | null> = {
  rigging: "Rigging",
  curtains: "Curtains",
  lighting: "Lighting",
  audio: "Audio",
  video: "Video",
  controls: "Controls",
  general: null,
};

export function groupOfCustomSystem(system: string | null | undefined): BomGroupKey {
  if (system === "Controls") return "controls";
  return isGridLayer(system) ? LAYER_GROUP[system] : "general";
}

export type BomSource = "device" | "accessory" | "wire" | "curtain" | "custom" | "labor";

export type GroupedBomLine = BomLine & {
  group: BomGroupKey;
  source: BomSource;
  /** Accessory lines only: the stored accessory id (edit / remove). */
  accessoryId?: string;
  /** Accessory lines only: the part has left the library (#230 final wave B). */
  removed?: true;
  /** Labor lines only (#232): the server-computed line (pct, mult, override). */
  labor?: GridLaborLine;
};

/** A labor line's heading: its system when that is a BOM heading, else General. */
export function groupOfLaborSystem(system: string): BomGroupKey {
  return isBomGroupKey(system) ? system : "general";
}

export type BomGroup = { key: BomGroupKey; label: string; lines: GroupedBomLine[]; value: number };

/** Tag every BOM line with its group and source. Within a group the order is
 *  devices, accessories, wires, curtains, custom items, labor. */
export function groupedBomLines(input: {
  devices: readonly BomLine[];
  wires: readonly BomLine[];
  curtains: readonly BomLine[];
  custom: readonly BomLine[];
  customItems: readonly GridCustomItem[];
  accessories: ReadonlyArray<BomLine & { accessoryId: string; group: BomGroupKey }>;
  parts: ReadonlyArray<GroupablePart & { id: string }>;
  placements: ReadonlyArray<AutoPlacementLite>;
  /** #232: the option's labor lines (buildGridQuote's `labor`), when known. */
  labor?: readonly GridLaborLine[];
}): GroupedBomLine[] {
  const byId = new Map(input.parts.map((p) => [p.id, p]));
  const auto = autoSystemsByPart(input.placements);
  const customGroup = new Map(input.customItems.map((it) => [customItemPartId(it.id), groupOfCustomSystem(it.system)]));
  return [
    ...input.devices.map((l): GroupedBomLine => ({ ...l, source: "device", group: groupOfPart(byId.get(l.partId), auto.get(l.partId)) })),
    ...input.accessories.map((l): GroupedBomLine => ({ ...l, source: "accessory" })),
    ...input.wires.map((l): GroupedBomLine => ({ ...l, source: "wire", group: groupOfPart(byId.get(l.partId)) })),
    ...input.curtains.map((l): GroupedBomLine => ({ ...l, source: "curtain", group: "curtains" })),
    ...input.custom.map((l): GroupedBomLine => ({ ...l, source: "custom", group: customGroup.get(l.partId) ?? "general" })),
    ...(input.labor ?? []).map(
      (l): GroupedBomLine => ({
        partId: l.sku,
        desc: l.desc,
        unit: "lot",
        qty: 1,
        list: l.amount,
        ext: l.amount,
        source: "labor",
        group: groupOfLaborSystem(l.system),
        labor: l,
      })
    ),
  ];
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** All seven groups in order — empty ones included, so every heading can
 *  take an accessory — each with its lines and its sell total. */
export function bomGroups(lines: readonly GroupedBomLine[]): BomGroup[] {
  return BOM_GROUPS.map(({ key, label }) => {
    const mine = lines.filter((l) => l.group === key);
    return { key, label, lines: mine, value: round2(mine.reduce((a, l) => a + l.ext, 0)) };
  });
}
