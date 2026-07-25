/**
 * Catalog taxonomy — groups, trades, and the admin-editable category map
 * (punch #39, catalog beta build-out, Task 1).
 *
 * `CatalogPart.category` (src/lib/stores/catalog.ts) is an existing
 * load-bearing free-text field: ~40 granular values across ~10.7k imported
 * parts. `Fabric` and `Labor` are semantic (curtain configurator / labor
 * engine) and are EXCLUDED here entirely — they get no map entry and no
 * group/trade.
 *
 * The six beta groups and three trades are a NEW layer resolved through this
 * mapping, keyed on the existing category strings — parts are NOT rewritten.
 * The mapping lives in appSettings as a sparse patch over DEFAULT_CATEGORY_MAP
 * (see `catalogCategoryMap` in src/lib/settings.ts), admin-edited at runtime
 * (Task 2's mapping editor).
 */

export const TRADES = ["Lighting", "Rigging", "AV"] as const;
export type Trade = (typeof TRADES)[number];

export const GROUPS = [
  "Lighting Controls",
  "Fixtures",
  "Video Controls",
  "Speakers",
  "Audio Controls",
  "Curtains",
] as const;
export type CatalogGroup = (typeof GROUPS)[number];

export type CategoryMapEntry = { group?: CatalogGroup; trade?: Trade };
export type CategoryMap = Record<string, CategoryMapEntry>;

/** Jeff's locked rollup: which trade each of the six groups belongs to. */
export const GROUP_TRADES: Record<CatalogGroup, Trade> = {
  "Lighting Controls": "Lighting",
  Fixtures: "Lighting",
  "Video Controls": "AV",
  Speakers: "AV",
  "Audio Controls": "AV",
  Curtains: "Rigging",
};

/**
 * Seeds every known imported category (from Task 0 recon). Keep this list in
 * the file — it is the durable record of the recon, not just a bootstrap
 * value. `Fabric` and `Labor` deliberately get NO entry (excluded domains).
 */
export const DEFAULT_CATEGORY_MAP: CategoryMap = {
  // Fixtures — one of the six groups; category string equals the group name.
  Fixtures: { group: "Fixtures", trade: "Lighting" },

  // Rigging hardware — trade only, no group (not one of the six beta buckets).
  Track: { trade: "Rigging" },
  Pipe: { trade: "Rigging" },
  Loftblocks: { trade: "Rigging" },
  Headblocks: { trade: "Rigging" },
  "Mule Block": { trade: "Rigging" },
  Arbor: { trade: "Rigging" },
  "Standard Arbor": { trade: "Rigging" },
  "Front Arbor": { trade: "Rigging" },
  "Floor Block": { trade: "Rigging" },
  "Manual Hoist": { trade: "Rigging" },
  "Motorized Hoist": { trade: "Rigging" },
  "Rope Lock": { trade: "Rigging" },
  Hardware: { trade: "Rigging" },
  Shoes: { trade: "Rigging" },
  "Wire Mesh Strain Reliefs": { trade: "Rigging" },
  Mounts: { trade: "Rigging" },

  // Curtains — one of the six groups; no imported parts use this category
  // yet, seeded as the identity entry so starter-set imports resolve for free.
  Curtains: { group: "Curtains", trade: "Rigging" },

  // AV — trade only, no group.
  Networking: { trade: "AV" },
  Racks: { trade: "AV" },
  "Rack Accessories": { trade: "AV" },
  "Rack Options": { trade: "AV" },
  Connectors: { trade: "AV" },
  "Cable Assemblies": { trade: "AV" },

  // Identity entries for the remaining group names (Fixtures and Curtains
  // are seeded above with an explicit trade too) so starter-set imports
  // whose `category` IS the group name resolve with zero admin work. Trade
  // is left to the GROUP_TRADES fallback in tradeOf.
  "Lighting Controls": { group: "Lighting Controls" },
  "Video Controls": { group: "Video Controls" },
  Speakers: { group: "Speakers" },
  "Audio Controls": { group: "Audio Controls" },

  // Fabric and Labor: NO entry (excluded domains — see file header).
};

/** Defaults ⊕ stored (stored wins per key). */
export function resolveCategoryMap(stored?: CategoryMap): CategoryMap {
  if (!stored) return DEFAULT_CATEGORY_MAP;
  return { ...DEFAULT_CATEGORY_MAP, ...stored };
}

export function groupOf(
  part: { category: string },
  map: CategoryMap
): CatalogGroup | null {
  return map[part.category]?.group ?? null;
}

/** part.trade override wins; else map[category].trade ?? GROUP_TRADES[group]. */
export function tradeOf(
  part: { category: string; trade?: string },
  map: CategoryMap
): Trade | null {
  if (part.trade && (TRADES as readonly string[]).includes(part.trade)) {
    return part.trade as Trade;
  }
  const entry = map[part.category];
  if (entry?.trade) return entry.trade;
  if (entry?.group) return GROUP_TRADES[entry.group];
  return null;
}
