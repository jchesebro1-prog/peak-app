/* ------------------------------------------------------------------ *
 * The Grid — stock symbols: colour by group, icon by category (spec
 * 2026-09-25, supersedes the D154 shape vocabulary as the primary look).
 * Pure and client-safe like grid-symbols/grid-bom: the editor, riser,
 * Grid Settings and the spec harness all import it. No doc-store, no DB.
 *
 * Icon:   entry.icon → entry.shape (legacy alias) → category icon
 *         → stored settings.gridCategoryShapes[category] (legacy alias)
 *         → "device".
 * Colour: entry.color → group colour → trade colour → the Grid entry's
 *         own scope (Lighting/Rigging/Curtains/Audio/Video) → "Other".
 * Category names match trimmed + case-insensitive (CatalogPart.category
 * is free text), exactly like shapeFor.
 * ------------------------------------------------------------------ */
import {
  GROUPS,
  GROUP_TRADES,
  TRADES,
  resolveCategoryMap,
  type CatalogGroup,
  type CategoryMap,
  type CategoryMapEntry,
  type Trade,
} from "../catalog-taxonomy";
import { isGridShape, type GridShape } from "./grid-symbols";
import { GENERATED_GRID_ICONS, type GridIconEl } from "./grid-icons.generated";

export type { GridIconEl } from "./grid-icons.generated";

export type GridIcon = {
  id: string;
  label: string;
  tags: string[];
  els: GridIconEl[];
  source: "tabler" | "legacy";
};

/* ------------------------- legacy shapes ------------------------- */

const p = (d: string): GridIconEl => ({ t: "path", a: { d } });

/** The eight D154 shapes, redrawn as 24-unit glyphs so an old per-entry
 *  `shape` or stored category shape keeps meaning what it meant. The three
 *  glyph shapes are the old 30-unit paths scaled by 0.8 about (12,12). */
const LEGACY_SHAPE_ICONS: Record<GridShape, GridIcon> = {
  rect: { id: "shape-rect", label: "Shape: rectangle", tags: ["legacy", "shape", "rectangle"], source: "legacy", els: [p("M5 7h14a2 2 0 0 1 2 2v6a2 2 0 0 1 -2 2h-14a2 2 0 0 1 -2 -2v-6a2 2 0 0 1 2 -2z")] },
  circle: { id: "shape-circle", label: "Shape: circle", tags: ["legacy", "shape", "circle"], source: "legacy", els: [p("M4 12a8 8 0 1 0 16 0a8 8 0 1 0 -16 0")] },
  triangle: { id: "shape-triangle", label: "Shape: triangle", tags: ["legacy", "shape", "triangle"], source: "legacy", els: [p("M12 4l9 16h-18z")] },
  diamond: { id: "shape-diamond", label: "Shape: diamond", tags: ["legacy", "shape", "diamond"], source: "legacy", els: [p("M12 3l9 9l-9 9l-9 -9z")] },
  hexagon: { id: "shape-hexagon", label: "Shape: hexagon", tags: ["legacy", "shape", "hexagon"], source: "legacy", els: [p("M7.5 4h9l4.5 8l-4.5 8h-9l-4.5 -8z")] },
  speaker: { id: "shape-speaker", label: "Shape: speaker", tags: ["legacy", "shape", "speaker"], source: "legacy", els: [p("M5.6 8.8L9.6 8.8L15.2 4.8L15.2 19.2L9.6 15.2L5.6 15.2Z"), p("M17.6 8.8Q20.8 12 17.6 15.2")] },
  light: { id: "shape-light", label: "Shape: light", tags: ["legacy", "shape", "light"], source: "legacy", els: [p("M7.2 9.6a4.8 4.8 0 1 1 9.6 0a4.8 4.8 0 1 1 -9.6 0"), p("M9.6 16.8L14.4 16.8"), p("M10.4 19.2L13.6 19.2")] },
  camera: { id: "shape-camera", label: "Shape: camera", tags: ["legacy", "shape", "camera"], source: "legacy", els: [p("M4.8 8L14.4 8L14.4 16L4.8 16Z"), p("M14.4 11.2L19.2 8.8L19.2 15.2L14.4 12.8Z")] },
};

/** GridShape → its registered icon id (the legacy alias). */
export const LEGACY_SHAPE_ICON: Record<GridShape, string> = Object.fromEntries(
  Object.entries(LEGACY_SHAPE_ICONS).map(([shape, icon]) => [shape, icon.id])
) as Record<GridShape, string>;

/* --------------------------- registry ---------------------------- */

/** Tabler picks (sorted by id) then the eight legacy shapes. */
export const GRID_ICONS: readonly GridIcon[] = [
  ...GENERATED_GRID_ICONS.map((g) => ({ id: g.id, label: g.label, tags: g.tags, els: g.els, source: "tabler" as const })),
  ...Object.values(LEGACY_SHAPE_ICONS),
];

const ICON_BY_ID = new Map(GRID_ICONS.map((i) => [i.id, i]));

/** The glyph for anything without a better answer — never render blank. */
export const GENERIC_ICON_ID = "device";

export function isGridIconId(v: unknown): v is string {
  return typeof v === "string" && ICON_BY_ID.has(v);
}

/** Unknown ids fall back to the generic device icon (never undefined). */
export function iconById(id: string | null | undefined): GridIcon {
  return (id && ICON_BY_ID.get(id)) || ICON_BY_ID.get(GENERIC_ICON_ID)!;
}

/** Every whitespace token must appear in the id, label or a tag. An empty
 *  query returns the whole registry. Label-prefix hits sort first, then by
 *  label — deterministic for the picker and the tests. */
export function searchIcons(q: string, limit = GRID_ICONS.length): GridIcon[] {
  const tokens = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (!tokens.length) return GRID_ICONS.slice(0, limit);
  const hits = GRID_ICONS.filter((i) => {
    const hay = `${i.id} ${i.label} ${i.tags.join(" ")}`.toLowerCase();
    return tokens.every((t) => hay.includes(t));
  });
  const first = tokens[0];
  const rank = (i: GridIcon) => (i.label.toLowerCase().startsWith(first) || i.id.startsWith(first) ? 0 : 1);
  return hits
    .sort((a, b) => rank(a) - rank(b) || a.label.localeCompare(b.label))
    .slice(0, limit);
}

/* ------------------------ category icons ------------------------- */

/** Shipped defaults: every DEFAULT_CATEGORY_MAP category plus the live Grid
 *  library categories (seeded entries and fromPricing's "Other"). */
export const DEFAULT_CATEGORY_ICONS: Record<string, string> = {
  // Lighting
  Fixtures: "fixture",
  Fixture: "fixture",
  Lighting: "bulb",
  "Lighting Controls": "lighting-controls",
  // Rigging (trade-only categories)
  Track: "track",
  Pipe: "pipe",
  Loftblocks: "loft-block",
  Headblocks: "head-block",
  "Mule Block": "mule-block",
  Arbor: "arbor",
  "Standard Arbor": "arbor",
  "Front Arbor": "arbor",
  "Floor Block": "floor-block",
  "Manual Hoist": "hand-winch",
  "Motorized Hoist": "motor",
  "Rope Lock": "rope-lock",
  Hardware: "hardware",
  Shoes: "shoe",
  "Wire Mesh Strain Reliefs": "mesh-grip",
  Mounts: "mount",
  Curtains: "curtain",
  Rigging: "rigging",
  // AV
  Networking: "network",
  Racks: "rack",
  "Rack Accessories": "rack-accessories",
  "Rack Options": "rack-options",
  Connectors: "connector",
  "Cable Assemblies": "cable",
  "Video Controls": "video-controls",
  Speakers: "speaker",
  "Audio Controls": "audio-controls",
  Cameras: "camera",
  Video: "display",
  Control: "controller",
  // Grid-owned
  Assembly: "assembly",
  Other: GENERIC_ICON_ID,
};

const norm = (s: string | null | undefined) => (s || "").trim().toLowerCase();

/** Defaults ⊕ stored, merged PER CATEGORY (unlike gridCategoryShapes' whole-
 *  map replacement) so a default added later still shows after an admin
 *  edits one. A stored key replaces the default whose trimmed/lower-cased
 *  name matches; unknown icon ids in `stored` are ignored. Always fresh. */
export function resolveCategoryIcons(stored?: Record<string, string> | null): Record<string, string> {
  const byNorm = new Map<string, [string, string]>();
  for (const [k, v] of Object.entries(DEFAULT_CATEGORY_ICONS)) byNorm.set(norm(k), [k, v]);
  if (stored && typeof stored === "object") {
    for (const [k, v] of Object.entries(stored)) {
      if (norm(k) && isGridIconId(v)) byNorm.set(norm(k), [k.trim(), v]);
    }
  }
  return Object.fromEntries(byNorm.values());
}

export const MAX_CATEGORY_ICONS = 200;

/** What saveCategoryIconsAction persists: trimmed keys (≤60 chars), known
 *  icon ids only, capped at MAX_CATEGORY_ICONS; empty → null (= defaults). */
export function cleanCategoryIcons(map: Record<string, unknown> | null | undefined): Record<string, string> | null {
  const clean: Record<string, string> = {};
  for (const [k, v] of Object.entries(map || {})) {
    const category = String(k ?? "").trim().slice(0, 60);
    if (!category || !isGridIconId(v)) continue;
    clean[category] = v;
    if (Object.keys(clean).length >= MAX_CATEGORY_ICONS) break;
  }
  return Object.keys(clean).length ? clean : null;
}

/* --------------------------- colours ----------------------------- */

export const SYMBOL_COLOR_KEYS = [...GROUPS, ...TRADES, "Other"] as const;
export type SymbolColorKey = (typeof SYMBOL_COLOR_KEYS)[number];

/** Okabe–Ito hues, darkened until white glyphs clear 3:1 (the harness pins
 *  every value). Lighting family = oranges/browns, AV = blues/green/magenta,
 *  Rigging = olive/violet, grey for anything unmapped. */
export const DEFAULT_SYMBOL_COLORS: Record<SymbolColorKey, string> = {
  "Lighting Controls": "#a66f00",
  Fixtures: "#d55e00",
  "Video Controls": "#0072b2",
  Speakers: "#008060",
  "Audio Controls": "#b0508a",
  Curtains: "#8c7b00",
  Lighting: "#7f4f24",
  Rigging: "#5e4b8b",
  AV: "#4b5db0",
  Other: "#6b7280",
};

export const SYMBOL_COLOR_LABEL: Record<SymbolColorKey, string> = {
  "Lighting Controls": "Lighting Controls (group)",
  Fixtures: "Fixtures (group)",
  "Video Controls": "Video Controls (group)",
  Speakers: "Speakers (group)",
  "Audio Controls": "Audio Controls (group)",
  Curtains: "Curtains (group)",
  Lighting: "Lighting (trade)",
  Rigging: "Rigging (trade)",
  AV: "AV (trade)",
  Other: "Other / unmapped",
};

const HEX_RE = /^#[0-9a-f]{6}$/i;
export function isHexColor(v: unknown): v is string {
  return typeof v === "string" && HEX_RE.test(v);
}

export function isSymbolColorKey(v: unknown): v is SymbolColorKey {
  return typeof v === "string" && (SYMBOL_COLOR_KEYS as readonly string[]).includes(v);
}

/** Defaults ⊕ stored per key; bad keys/values ignored; lower-cased hex. */
export function resolveSymbolColors(stored?: Record<string, string> | null): Record<SymbolColorKey, string> {
  const out = { ...DEFAULT_SYMBOL_COLORS };
  if (stored && typeof stored === "object") {
    for (const [k, v] of Object.entries(stored)) if (isSymbolColorKey(k) && isHexColor(v)) out[k] = v.toLowerCase();
  }
  return out;
}

/** What saveSymbolColorsAction persists: known keys, #rrggbb only
 *  (lower-cased); at most SYMBOL_COLOR_KEYS.length entries; empty → null. */
export function cleanSymbolColors(map: Record<string, unknown> | null | undefined): Record<string, string> | null {
  const clean: Record<string, string> = {};
  for (const [k, v] of Object.entries(map || {})) {
    if (isSymbolColorKey(k) && isHexColor(v)) clean[k] = v.toLowerCase();
  }
  return Object.keys(clean).length ? clean : null;
}

/** WCAG relative-luminance contrast of `hex` against white. */
export function contrastOnWhite(hex: string): number {
  const c = hex.replace("#", "");
  const ch = [0, 2, 4].map((i) => {
    const v = parseInt(c.slice(i, i + 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  const lum = 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
  return 1.05 / (lum + 0.05);
}

/** Darken `hex` by `amount` (0–1) — the badge's subtle outline. */
export function darken(hex: string, amount = 0.25): string {
  const c = hex.replace("#", "");
  const out = [0, 2, 4]
    .map((i) => Math.round(parseInt(c.slice(i, i + 2), 16) * (1 - amount)))
    .map((v) => v.toString(16).padStart(2, "0"))
    .join("");
  return `#${out}`;
}

/* --------------------------- resolver ---------------------------- */

/** Everything symbolLook needs, resolved once per request on the server and
 *  passed (plain JSON) to client components. */
export type SymbolContext = {
  categoryIcons: Record<string, string>;
  colors: Record<SymbolColorKey, string>;
  categoryMap: CategoryMap;
  /** RAW stored settings.gridCategoryShapes (never the old seed) — only an
   *  admin's explicit D154 choice is honoured as a fallback. */
  legacyCategoryShapes: Record<string, string> | null;
};

export function symbolContext(
  settings:
    | {
        gridCategoryIcons?: Record<string, string> | null;
        gridSymbolColors?: Record<string, string> | null;
        catalogCategoryMap?: CategoryMap;
        gridCategoryShapes?: Record<string, string> | null;
      }
    | null
    | undefined
): SymbolContext {
  return {
    categoryIcons: resolveCategoryIcons(settings?.gridCategoryIcons),
    colors: resolveSymbolColors(settings?.gridSymbolColors),
    categoryMap: resolveCategoryMap(settings?.catalogCategoryMap),
    legacyCategoryShapes: settings?.gridCategoryShapes ?? null,
  };
}

/** Structurally satisfied by PartLite (grid-bom) — pass a part straight in. */
export type SymbolEntry = {
  category?: string | null;
  icon?: string | null;
  color?: string | null;
  shape?: string | null;
  group?: string | null;
  trade?: string | null;
  /** GridSymbol.scope as PartLite carries it — the colour of last resort
   *  before grey, for Grid-owned categories the catalog map doesn't know
   *  ("Lighting", "Video", "Rigging"…). */
  gridScope?: string | null;
};

/** Grid scope (grid-scopes GRID_SCOPES) → colour key. */
const SCOPE_COLOR_KEY: Record<string, SymbolColorKey> = {
  Lighting: "Lighting",
  Rigging: "Rigging",
  Curtains: "Curtains",
  Audio: "AV",
  Video: "AV",
};

export type SymbolLook = {
  iconId: string;
  color: string;
  /** The D154 shape this entry resolves to (entry shape → stored legacy
   *  category shape → "rect") — kept for back-compat callers only. */
  shape: GridShape;
  /** True when the entry itself carries an icon, colour or legacy shape. */
  overridden: boolean;
};

function lookup<T>(map: Record<string, T> | null | undefined, category: string | null | undefined): T | undefined {
  if (!map) return undefined;
  const c = category ?? "";
  if (Object.prototype.hasOwnProperty.call(map, c)) return map[c];
  const want = norm(c);
  if (!want) return undefined;
  for (const [k, v] of Object.entries(map)) if (norm(k) === want) return v;
  return undefined;
}

const isGroup = (v: unknown): v is CatalogGroup => typeof v === "string" && (GROUPS as readonly string[]).includes(v);
const isTrade = (v: unknown): v is Trade => typeof v === "string" && (TRADES as readonly string[]).includes(v);

export function symbolLook(entry: SymbolEntry | null | undefined, ctx: SymbolContext): SymbolLook {
  const e = entry || {};
  const legacyCat = lookup(ctx.legacyCategoryShapes, e.category);
  const shape: GridShape = isGridShape(e.shape) ? e.shape : isGridShape(legacyCat) ? legacyCat : "rect";

  let iconId: string;
  if (isGridIconId(e.icon)) iconId = e.icon;
  else if (isGridShape(e.shape)) iconId = LEGACY_SHAPE_ICON[e.shape];
  else {
    const cat = lookup(ctx.categoryIcons, e.category);
    if (isGridIconId(cat)) iconId = cat;
    else if (isGridShape(legacyCat)) iconId = LEGACY_SHAPE_ICON[legacyCat];
    else iconId = GENERIC_ICON_ID;
  }

  let color: string;
  if (isHexColor(e.color)) color = e.color.toLowerCase();
  else {
    const m: CategoryMapEntry | undefined = lookup(ctx.categoryMap, e.category);
    const group = isGroup(e.group) ? e.group : m?.group ?? null;
    const trade = isTrade(e.trade) ? e.trade : m?.trade ?? (group ? GROUP_TRADES[group] : null);
    const scopeKey = e.gridScope ? SCOPE_COLOR_KEY[e.gridScope] : undefined;
    color = group ? ctx.colors[group] : trade ? ctx.colors[trade] : scopeKey ? ctx.colors[scopeKey] : ctx.colors.Other;
  }

  const overridden = isGridIconId(e.icon) || isHexColor(e.color) || isGridShape(e.shape);
  return { iconId, color, shape, overridden };
}

/* ---------------------------- legend ----------------------------- */

export type LegendRow = { key: string; iconId: string; color: string; label: string };

/** One row per distinct icon+colour actually drawn, first-seen order. An
 *  entry whose look differs from its category default is labelled
 *  "<category> — <desc>" (the #131 riser rule), otherwise just the category. */
export function legendRows(
  entries: Array<SymbolEntry & { desc?: string | null }>,
  ctx: SymbolContext
): LegendRow[] {
  const rows: LegendRow[] = [];
  for (const e of entries) {
    const look = symbolLook(e, ctx);
    const key = `${look.iconId}|${look.color}`;
    if (rows.some((r) => r.key === key)) continue;
    const category = (e.category || "").trim() || "Uncategorized";
    const base = symbolLook({ category: e.category, group: e.group, trade: e.trade, gridScope: e.gridScope }, ctx);
    const differs = base.iconId !== look.iconId || base.color !== look.color;
    rows.push({ key, iconId: look.iconId, color: look.color, label: differs && e.desc ? `${category} — ${e.desc}` : category });
  }
  return rows;
}

/* ------------------------ settings rows -------------------------- */

export type SymbolCategoryRow = { category: string; gridScope: string | null };

/** The Category icons card's rows: every live category — the shipped icon
 *  defaults, the catalog taxonomy seed, live catalog categories, the Grid
 *  library's categories and any stored override — de-duplicated trimmed +
 *  case-insensitively (first spelling wins), Fabric/Labor excluded (never
 *  devices), sorted. A category the Grid library uses carries that entry's
 *  scope so its preview colour matches the plan. */
export function symbolCategoryRows(input: {
  catalogCategories: string[];
  grid: Array<{ category: string; scope?: string | null }>;
  stored?: Record<string, string> | null;
  taxonomy?: string[];
}): SymbolCategoryRow[] {
  const rows = new Map<string, SymbolCategoryRow>();
  const scopeOf = new Map<string, string>();
  for (const g of input.grid) {
    const k = norm(g.category);
    if (k && g.scope && !scopeOf.has(k)) scopeOf.set(k, g.scope);
  }
  const add = (raw: string) => {
    const category = (raw || "").trim();
    const k = norm(category);
    if (!k || k === "fabric" || k === "labor" || rows.has(k)) return;
    rows.set(k, { category, gridScope: scopeOf.get(k) ?? null });
  };
  for (const c of Object.keys(DEFAULT_CATEGORY_ICONS)) add(c);
  for (const c of input.taxonomy || []) add(c);
  for (const c of input.catalogCategories) add(c);
  for (const g of input.grid) add(g.category);
  for (const c of Object.keys(input.stored || {})) add(c);
  return Array.from(rows.values()).sort((a, b) => a.category.localeCompare(b.category));
}

/** The shipped default icon for a category (trimmed, case-insensitive), or
 *  the generic device — what "Reset" on one Category icons row goes back to. */
export function defaultIconFor(category: string): string {
  return lookup(DEFAULT_CATEGORY_ICONS, category) ?? GENERIC_ICON_ID;
}

/** A representative glyph for each colour swatch's preview badge. */
export const COLOR_KEY_SAMPLE_ICON: Record<SymbolColorKey, string> = {
  "Lighting Controls": "lighting-controls",
  Fixtures: "fixture",
  "Video Controls": "video-controls",
  Speakers: "speaker",
  "Audio Controls": "audio-controls",
  Curtains: "curtain",
  Lighting: "bulb",
  Rigging: "rigging",
  AV: "network",
  Other: GENERIC_ICON_ID,
};
