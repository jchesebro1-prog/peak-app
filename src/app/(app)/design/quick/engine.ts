/**
 * Quick Design estimating engine — port of the logic class embedded in
 * app/Quick Design.dc.html (the budgetary auto-estimate path). Venue presets,
 * dimension schemas, sizing equations and roll-up formulas are carried over;
 * the prototype's DOLLARS are not (#GEM, D-GEM-4): compute() emits item keys +
 * quantities only, and src/lib/design/equipment-pricing.ts prices them from
 * the catalog-backed Equipment map. This module holds no cost data, so the
 * Grid's client components can import its presets and sizing safely.
 *
 * Pure data + math — no React, no I/O.
 */

import { drapeRule } from "@/lib/design/goods";
import { battenLenFt, venueDimsFromEstimator } from "@/lib/design/venue-dims";

/* ---------------------------------- types ---------------------------------- */

export type SysKey =
  | "rigging"
  | "curtains"
  | "lighting"
  | "controls"
  | "audio"
  | "video"
  | "acoustical"
  | "pit";

export type VenueKind = "proscenium" | "church" | "flat" | "blackbox" | "gym" | "arena";
export type TierKey = "good" | "better" | "best";
export type SizeKey = "small" | "medium" | "large";
export type DimField = "width" | "depth" | "grid" | "wing" | "ph";
export type ViewKey = "estimate" | "bom" | "plan" | "schedule" | "riser";

export type VenueDef = {
  key: string;
  label: string;
  sub: string;
  kind: VenueKind;
  w: number;
  d: number;
  g: number;
  wing: number;
  ph: number;
  sys: Record<SysKey, boolean>;
};

/** A drape's finished geometry (goods.ts drapeRule) — per panel width, panels on the line. */
export type DrapeGeom = { w: number; h: number; fullness: number; qty: number };

export type BomItem = {
  /** Equipment map row key, `system:itemKey` (#GEM, equipment-vocab.ts). */
  key: string;
  /** The equation's own item name (= the row label). */
  desc: string;
  qty: number;
  unit: string;
  /** Unit cost / unit sell — 0 until equipment-pricing.ts prices the item. */
  cost: number;
  price: number;
  /** Set by the Equipment map pricing step (#GEM): how this line priced. */
  status?: "part" | "assembly" | "allowance" | "needs-part";
  /** What priced it: SKU, fixture id or row key — and its description. */
  ref?: string;
  refDesc?: string;
  /** Curtain drapes only: the geometry the per-drape cost is computed from. */
  drape?: DrapeGeom;
};

export type SystemBlock = {
  key: SysKey;
  name: string;
  on: boolean;
  m: number;
  dot: string;
  items: BomItem[];
  rev: number;
  cost: number;
  tierFixed?: boolean;
};

export type ComputeResult = {
  lineSets: number;
  electrics: number;
  drapeArea: number;
  dimmerRacks: number;
  rigType: string;
  systems: SystemBlock[];
  rigSets: number;
};

export type TierTotals = {
  matRev: number;
  matCost: number;
  install: number;
  freight: number;
  contingency: number;
  grand: number;
  margin: number;
};

export type TierDef = {
  blurb: string;
  specs: Record<string, string>;
  sets: number | null;
  fabrics: Record<string, string>;
};
export type TierDefs = Record<TierKey, TierDef>;

/** The designer state the prototype keeps on state.a — persisted whole as `config`. */
export type AState = {
  venue: string;
  size: SizeKey;
  width: number;
  depth: number;
  grid: number;
  wing: number;
  ph: number;
  sys: Record<SysKey, boolean>;
  view: ViewKey;
  tier: TierKey;
  contingency: number;
  rigType: string;
  drape: Record<string, boolean>;
  fixtures: Record<string, boolean>;
  /** fixture type → catalog-backed Assembly Builder id */
  fixtureAssemblies?: Record<string, string>;
  ctrl: Record<string, boolean>;
  shell: Record<string, boolean>;
  pitType: string;
  /** per-tier BOM quantity overrides: tier → system → desc → qty */
  qtyOverrides: Partial<Record<TierKey, Record<string, Record<string, number>>>>;
  mode: "auto" | "manual";
  /** manual-layout placements — preserved opaquely so saved prototypes round-trip */
  placements: unknown[];
  houseHalfFt?: number | null;
  doorsL?: number[] | null;
  doorsR?: number[] | null;
  doorsBack?: number[] | null;
  planImage?: string | null;
  planName?: string | null;
  showGen?: boolean;
  /** The line-set count per tier the designer dialled (TierDefs[t].sets) at
   *  save time — carried in `config` so the SERVER prices the same rigging
   *  quantities the screen showed (#GEM D-GEM-23). Missing = the equation's
   *  own count (tierDefsDefault). */
  tierSets?: Partial<Record<TierKey, number | null>>;
};

/**
 * The basic-info slice of AState shared by Quick Design's inline config
 * panel and Grid Manual mode's Scope panel (#GEM, D-GEM-5):
 * venue/size/dimensions plus the systems-in-scope toggles and their
 * sub-config (rig type, drape/fixture/control/shell picks, pit type).
 * Deliberately excludes the fields that only make sense for Quick Design's
 * own canvas/persistence: `view` (which tab is open), `tier` (Manual's
 * Scope panel treats tier as a lens, not stored input — see
 * scopeTargetsByTier in scope-targets.ts),
 * `contingency`/`qtyOverrides` (tier-total-only, not per-system), `mode`/
 * `placements` (Auto's own sandbox canvas state), and the plan-image/door
 * fields (Auto-canvas-only).
 */
export type QuickScopeInputs = Omit<
  AState,
  | "view"
  | "tier"
  | "contingency"
  | "qtyOverrides"
  | "mode"
  | "placements"
  | "houseHalfFt"
  | "doorsL"
  | "doorsR"
  | "doorsBack"
  | "planImage"
  | "planName"
  | "showGen"
  | "tierSets"
>;

/* -------------------------------- constants -------------------------------- */

export const VENUES: VenueDef[] = [
  { key: "school", label: "Auditorium", sub: "Auditorium", kind: "proscenium", w: 36, d: 26, g: 24, wing: 12, ph: 18, sys: { rigging: true, curtains: true, lighting: true, controls: false, audio: true, video: false, acoustical: true, pit: false } },
  { key: "church", label: "Church", sub: "Worship / MPR", kind: "church", w: 34, d: 22, g: 24, wing: 0, ph: 18, sys: { rigging: false, curtains: true, lighting: true, controls: false, audio: true, video: true, acoustical: false, pit: false } },
  { key: "pac", label: "PAC", sub: "Performing arts", kind: "proscenium", w: 48, d: 34, g: 58, wing: 18, ph: 28, sys: { rigging: true, curtains: true, lighting: true, controls: true, audio: true, video: true, acoustical: true, pit: true } },
  { key: "concenter", label: "Conference", sub: "Conference center", kind: "flat", w: 50, d: 30, g: 34, wing: 0, ph: 24, sys: { rigging: true, curtains: true, lighting: true, controls: true, audio: true, video: true, acoustical: false, pit: false } },
  { key: "blackbox", label: "Black Box", sub: "Black box theater", kind: "blackbox", w: 26, d: 24, g: 18, wing: 0, ph: 16, sys: { rigging: true, curtains: true, lighting: true, controls: true, audio: true, video: false, acoustical: true, pit: false } },
  { key: "gym", label: "Gym Stage", sub: "Gymnasium stage", kind: "gym", w: 54, d: 40, g: 26, wing: 0, ph: 14, sys: { rigging: true, curtains: true, lighting: true, controls: false, audio: true, video: false, acoustical: false, pit: false } },
];

export const LIM: Record<DimField, [number, number]> = {
  width: [20, 80],
  depth: [14, 52],
  grid: [16, 84],
  wing: [4, 40],
  ph: [10, 50],
};

/** Which dimension sliders each venue kind exposes, with venue-appropriate labels. */
export const DIMSCHEMA: Record<VenueKind, Array<{ field: DimField; label: string; note: string }>> = {
  proscenium: [
    { field: "width", label: "Proscenium width", note: "Opening, edge to edge" },
    { field: "ph", label: "Proscenium height", note: "Opening, floor to header" },
    { field: "depth", label: "Stage depth", note: "Plaster line to back wall" },
    { field: "grid", label: "Grid height", note: "Floor to grid steel" },
    { field: "wing", label: "Stage wing width", note: "Offstage, each side" },
  ],
  church: [
    { field: "width", label: "Stage width", note: "Front edge, wall to wall" },
    { field: "depth", label: "Stage depth", note: "Front to back wall" },
    { field: "grid", label: "Ceiling height", note: "Floor to ceiling" },
  ],
  flat: [
    { field: "width", label: "Room width", note: "Wall to wall" },
    { field: "depth", label: "Room depth", note: "Front to back" },
    { field: "grid", label: "Ceiling height", note: "Floor to ceiling" },
  ],
  blackbox: [
    { field: "width", label: "Room width", note: "Wall to wall" },
    { field: "depth", label: "Room depth", note: "Front to back" },
    { field: "grid", label: "Grid height", note: "Floor to tension grid" },
  ],
  gym: [
    { field: "width", label: "Gym floor width", note: "Sideline to sideline" },
    { field: "depth", label: "Floor depth", note: "Stage to back wall" },
    { field: "ph", label: "Stage height", note: "Floor to proscenium header" },
    { field: "grid", label: "Ceiling height", note: "Floor to structure" },
  ],
  arena: [
    { field: "width", label: "Floor width", note: "Wall to wall" },
    { field: "depth", label: "Floor depth", note: "Front to back" },
    { field: "grid", label: "Clearance height", note: "Floor to structure" },
  ],
};

export const SIZES: Array<[SizeKey, string]> = [
  ["small", "Small"],
  ["medium", "Medium"],
  ["large", "Large"],
];
export const SIZE_MUL: Record<SizeKey, number> = { small: 0.78, medium: 1.0, large: 1.28 };

export const SHORT: Record<SysKey, string> = {
  rigging: "Rigging",
  curtains: "Curtains",
  lighting: "Fixtures",
  controls: "Controls",
  audio: "Audio",
  video: "Video",
  acoustical: "Acoustical Shell",
  pit: "Pit Filler",
};

export const SYSSUB: Record<SysKey, string> = {
  rigging: "Counterweight line sets",
  curtains: "Drapery, curtains, tracks",
  lighting: "Fixtures, dimming, electrics",
  controls: "Console, network, E-stop",
  audio: "Speakers, mixing, DSP",
  video: "Projection / LED, switching",
  acoustical: "Orchestra shell towers & ceiling",
  pit: "Pit lift cover & decking",
};

/** per-system colors — shared by the system list dots, BOM, and the plan layouts/legend */
export const SYSCOLOR: Record<SysKey, string> = {
  rigging: "#7b3f8a",
  curtains: "#b4543a",
  lighting: "#c98a2b",
  controls: "#1f7a52",
  audio: "#3155a8",
  video: "#2a7d8a",
  acoustical: "#6f6f78",
  pit: "#9a4a6a",
};

/**
 * Display order for the "systems to include" toggle list. Mirrors
 * compute()'s `defs` array order (rigging, curtains, lighting, controls,
 * acoustical, pit, audio, video) — NOT Object.keys(SHORT)'s declaration
 * order, which has audio/video before acoustical/pit. Kept as its own
 * const so ScopeInputsPanel can render the list without running compute().
 */
export const SYS_ORDER: SysKey[] = [
  "rigging",
  "curtains",
  "lighting",
  "controls",
  "acoustical",
  "pit",
  "audio",
  "video",
];

/** Per-system sub-configuration. mode 'single' = pick one; 'multi' = pick any. */
export const SUBCFG: Partial<
  Record<SysKey, { mode: "single" | "multi"; stateKey: string; options: Array<[string, string]> }>
> = {
  rigging: { mode: "single", stateKey: "rigType", options: [["counterweight", "Counterweight"], ["deadhung", "Dead Hung"], ["motorized", "Motorized"]] },
  curtains: { mode: "multi", stateKey: "drape", options: [["draw", "Draw"], ["legs", "Legs"], ["border", "Border"], ["scenerytrack", "Scenery"], ["fullstage", "Full"]] },
  lighting: { mode: "multi", stateKey: "fixtures", options: [["par", "Par"], ["front", "Front"], ["cyc", "Cyc"], ["side", "Side"], ["automated", "Mover"]] },
  controls: { mode: "multi", stateKey: "ctrl", options: [["console", "Console"], ["architectural", "Architectural"], ["data", "Data"]] },
  acoustical: { mode: "multi", stateKey: "shell", options: [["towers", "Towers"], ["ceiling", "Ceiling"], ["transport", "Transport"]] },
  pit: { mode: "single", stateKey: "pitType", options: [["legged", "Legged"], ["clearspan", "Clear-Span"]] },
};

export type TierMeta = { key: TierKey; label: string; costMul: number; priceMul: number; spec: string };
export const TIERS: TierMeta[] = [
  { key: "good", label: "Good", costMul: 0.8, priceMul: 0.84, spec: "Value spec — proven economy gear" },
  { key: "better", label: "Better", costMul: 1.0, priceMul: 1.0, spec: "Balanced spec — pro-grade, best value" },
  { key: "best", label: "Best", costMul: 1.3, priceMul: 1.42, spec: "Premium spec — top-tier, future-proof" },
];

/** Authored Good / Better / Best spec descriptions per system: [good, better, best]. */
const SPEC_DEFAULTS: Record<SysKey, [string, string, string]> = {
  rigging: ["Manual counterweight, basic line sets", "Counterweight / motor-assist, T-track guides", "Fully automated hoists, variable-speed control & monitoring"],
  curtains: ["22 oz Encore velour, fixed track", "25 oz Charisma velour, walkalong / draw track", "25 oz Memorable velour, motorized track & added fullness"],
  lighting: ["LED Pars & basic ellipsoidals, manual focus", "Pro RGBA LED wash + profile spots, DMX movers on key positions", "Full moving-light rig, color-mixing profiles, networked sACN + spares"],
  controls: ["Entry console, single universe, basic distro", "Pro console + touchscreen, multi-universe sACN, managed distro", "Flagship console + tracking backup, redundant network & architectural integration"],
  audio: ["Compact line array, single sub, digital mixer", "Pro line array + subs, networked digital console & DSP", "Premium array, cardioid subs, redundant Dante DSP"],
  video: ["1080p laser projector, manual screen", "4K laser projector, motorized screen / entry LED wall", "Dual-4K stack or fine-pitch LED wall, redundant processing"],
  acoustical: ["Rolling shell towers, fabric ceiling", "Modular towers + acoustic ceiling, lighting taps", "Automated shell, hard ceiling, motorized transport"],
  pit: ["Legged deck infill, manual rails", "Engineered legged / clear-span deck, removable rails", "Clear-span structural deck, flush finish, fast-change hardware"],
};

export function tierDefsDefault(): TierDefs {
  const base: TierDefs = {
    good: { blurb: "Value spec — proven economy gear", specs: {}, sets: null, fabrics: { draw: "RB-EN-16", legs: "RB-EN-16", border: "RB-EN-16", fullstage: "RB-EN-16" } },
    better: { blurb: "Balanced spec — pro-grade, best value", specs: {}, sets: null, fabrics: { draw: "RB-MARVEL", legs: "RB-MARVEL", border: "RB-MARVEL", fullstage: "RB-MARVEL" } },
    best: { blurb: "Premium spec — top-tier, future-proof", specs: {}, sets: null, fabrics: { draw: "RB-MV-MN", legs: "RB-MV-MN", border: "RB-MV-MN", fullstage: "RB-MV-MN" } },
  };
  (Object.keys(SHORT) as SysKey[]).forEach((k) => {
    const t = SPEC_DEFAULTS[k] || ["", "", ""];
    base.good.specs[k] = t[0];
    base.better.specs[k] = t[1];
    base.best.specs[k] = t[2];
  });
  return base;
}

/**
 * Tier definitions persistence — the prototype keeps these global,
 * per-browser (localStorage 'rss_tierdefs_v1'); ported as-is.
 */
export const TIERDEFS_STORAGE_KEY = "rss_tierdefs_v1";

export function loadTierDefs(): TierDefs {
  const merged = tierDefsDefault();
  if (typeof window === "undefined") return merged;
  try {
    const raw = JSON.parse(window.localStorage.getItem(TIERDEFS_STORAGE_KEY) || "null") as
      | Partial<Record<TierKey, Partial<TierDef>>>
      | null;
    if (!raw) return merged;
    (["good", "better", "best"] as TierKey[]).forEach((t) => {
      const r = raw[t];
      if (!r) return;
      if (typeof r.blurb === "string") merged[t].blurb = r.blurb;
      if (typeof r.sets === "number") merged[t].sets = r.sets;
      if (r.fabrics) Object.assign(merged[t].fabrics, r.fabrics);
      if (r.specs)
        Object.keys(r.specs).forEach((k) => {
          if (r.specs![k]) merged[t].specs[k] = r.specs![k];
        });
    });
  } catch {
    /* ignore */
  }
  return merged;
}

export function saveTierDefs(td: TierDefs): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(TIERDEFS_STORAGE_KEY, JSON.stringify(td));
  } catch {
    /* ignore */
  }
}

/* --------------------------------- helpers --------------------------------- */

export function clamp(v: number, a: number, b: number): number {
  return Math.max(a, Math.min(b, v));
}

/** '$' + rounded, en-US grouped — the prototype's num(). */
export function moneyRound(n: number): string {
  return "$" + Math.round(n).toLocaleString("en-US");
}

/** Design-dashboard compact money ($61.5k / $286k / $840). */
export function shortMoney(n: number): string {
  return n >= 1000 ? "$" + (n / 1000).toFixed(n >= 100000 ? 0 : 1) + "k" : "$" + Math.round(n);
}

export function sizedDims(v: VenueDef, sz: SizeKey): { width: number; depth: number; grid: number; wing: number; ph: number } {
  const m = SIZE_MUL[sz] || 1;
  const c = (f: DimField, base: number) => clamp(Math.round(base * m), LIM[f][0], LIM[f][1]);
  return { width: c("width", v.w), depth: c("depth", v.d), grid: c("grid", v.g), wing: c("wing", v.wing), ph: c("ph", v.ph) };
}

export function venueOf(s: Pick<AState, "venue">): VenueDef {
  return VENUES.find((x) => x.key === s.venue) || VENUES[0];
}

/**
 * Number of rigging line sets implied by the rigging equations (base level).
 * counterweight / dead-hung: pick(5,6,7) × floor(depth/10); motorized: summed hoist counts.
 */
export function rigSetsFor(s: AState): number {
  const fl = Math.floor;
  const D = s.depth || 0;
  const size = s.size || "medium";
  const pick = <T,>(sm: T, md: T, lg: T): T => (size === "small" ? sm : size === "large" ? lg : md);
  const dBlk = fl(D / 10);
  const rigType = s.rigType || "counterweight";
  if (rigType === "motorized") {
    const m = pick({ el: 2, lo: 2, hi: 2, vs: 0 }, { el: 3, lo: 3, hi: 3, vs: 1 }, { el: 4, lo: 4, hi: 2, vs: 2 });
    return m.el * Math.max(2, fl(D / 30)) + m.lo * dBlk + m.hi * dBlk + m.vs * dBlk;
  }
  return pick(5, 6, 7) * dBlk;
}

/**
 * Effective rigging line-set count for the active tier — the dial value
 * (tierDefs[tier].sets), falling back to the rigging-equation base.
 */
export function gridSets(s: AState, tierDefs: TierDefs): number {
  if (!s.sys || !s.sys.rigging) return compute(s).lineSets;
  const base = rigSetsFor(s) || 1;
  const td = tierDefs[s.tier || "better"];
  return Math.max(1, Math.round(td && td.sets != null ? td.sets : base));
}

/** Quick Design's curtain toggle keys (`drape.draw` etc.) → the goods.ts drape TYPE whose geometry drapeRule() returns. */
const CURTAIN_KEY_TO_TYPE: Record<string, string> = { draw: "Draw", legs: "Legs", border: "Border", fullstage: "Rear" };

/* --------------------------------- compute --------------------------------- */

/**
 * Pure function of the designer state — the refined BOM equations (#GEM:
 * QUANTITIES ONLY). Every item carries its Equipment map key (equipment-
 * vocab.ts) and no dollars; equipment-pricing.ts prices them. Sizing math is
 * unchanged, except the scenery track, which now emits FEET (count × pipe
 * length) so a per-foot catalog track can price it (D-GEM-1).
 */
export function compute(s: AState): ComputeResult {
  const C = clamp;
  const lineSets = C(Math.round(s.depth * 1.5), 12, 72);
  // Electrics are spaced by stage depth (~one per 12 ft), clamped 2–5.
  const electrics = s.sys.lighting ? C(Math.round(s.depth / 12), 2, 5) : 0;
  const drapeArea = Math.round(s.width * s.grid);
  let dimmerRacks = 0; // derived after the fixtures BOM is built
  const arrayBoxes = C(Math.round(s.width / 3), 6, 24);
  const subs = C(Math.round(s.width / 12), 2, 8);
  const projectors = C(Math.round(s.width / 24), 1, 4);

  // ---- Refined BOM equations (feet; floor blocks) ----
  const fl = Math.floor;
  const W = s.width;
  const D = s.depth;
  const G = s.grid;
  const size = s.size || "medium";
  const pick = <T,>(sm: T, md: T, lg: T): T => (size === "small" ? sm : size === "large" ? lg : md);
  const dBlk = fl(D / 10); // 10-ft depth blocks

  /**
   * Pipe (batten) length per line set, ft. Jeff, punch #50: "It is Pro Width,
   * plus 2ft on each side, so 4ft total." The rule lives in battenLenFt()
   * (venue-dims.ts) so the lineset builder and this BOM cannot disagree.
   * Gated on the venue kind ON PURPOSE: `s.width` is the proscenium opening
   * only for kind "proscenium"; the other kinds keep `sets * W`.
   */
  const pipeLenFt = venueOf(s).kind === "proscenium" ? battenLenFt(W) : W;

  type Eq = { key: string; desc: string; unit: string; qty: number; drape?: DrapeGeom };
  const eq = (key: string, desc: string, unit: string, qty: number): Eq => ({ key, desc, unit, qty });

  // Rigging — single type
  const rigType = s.rigType || "counterweight";
  let rigItems: Eq[];
  if (rigType === "motorized") {
    const m = pick({ el: 2, lo: 2, hi: 2, vs: 0 }, { el: 3, lo: 3, hi: 3, vs: 1 }, { el: 4, lo: 4, hi: 2, vs: 2 });
    rigItems = [
      eq("rigging:electricHoist", "Electric hoist", "ea", m.el * Math.max(2, fl(D / 30))),
      eq("rigging:lowCapHoist", "Low-capacity hoist", "ea", m.lo * dBlk),
      eq("rigging:highCapHoist", "High-capacity hoist", "ea", m.hi * dBlk),
    ];
    if (m.vs) rigItems.push(eq("rigging:varSpeedHoist", "Variable-speed hoist", "ea", m.vs * dBlk));
  } else if (rigType === "deadhung") {
    const sets = pick(5, 6, 7) * dBlk;
    const points = sets * fl(W / 10);
    rigItems = [
      eq("rigging:riggingPoint", "Rigging point", "ea", points),
      eq("rigging:pipe", "Pipe", "ft", sets * pipeLenFt),
      eq("rigging:aircraftCable", "Aircraft cable", "ft", points * G),
      eq("rigging:chainWrap", "Chain wrap, 3 ft", "ea", points),
      eq("rigging:terminationKit", "Termination kit", "ea", points * 2),
    ];
  } else {
    // Counterweight — driven by the number of line sets.
    const sets = pick(5, 6, 7) * dBlk;
    const loftPerSet = Math.max(1, fl(W / 10)); // 1 loftblock per 10 ft of pro width, per set
    const loft = sets * loftPerSet;
    rigItems = [
      eq("rigging:headblock", "Headblock", "ea", sets),
      eq("rigging:footblock", "Footblock", "ea", sets),
      eq("rigging:arbor", "Arbor", "ea", sets),
      eq("rigging:tbarTrack", "T-bar track", "ea", sets),
      eq("rigging:lockRail", "Lock rail", "ea", sets),
      eq("rigging:handline", "Handline", "ft", sets * 2 * G),
      eq("rigging:pipe", "Pipe", "ft", sets * pipeLenFt),
      eq("rigging:loftblock", "Loftblock", "ea", loft),
      eq("rigging:aircraftCable", "Aircraft cable", "ft", loft * (2 * G + W)),
      eq("rigging:terminationKit", "Termination kit", "ea", loft * 2),
      eq("rigging:chainWrap", "Chain wrap, 3 ft", "ea", loft),
    ];
  }

  // Curtains — the four fabric drapes carry the goods.ts drape geometry
  // (finished width/height, fullness, panels) so equipment-pricing.ts costs
  // each one from the mapped fabric's area rate + making; qty per depth block.
  const drape = s.drape || {};
  const curtainItems: Eq[] = [];
  // `proscenium` gates the wing addition inside venueDimsFromEstimator (#66).
  const gdims = venueDimsFromEstimator({ ...s, proscenium: venueOf(s).kind === "proscenium" });
  const addDrape = (on: boolean | undefined, key: string, desc: string, count: number, fabricKey: string) => {
    if (!on || count <= 0) return;
    const type = CURTAIN_KEY_TO_TYPE[fabricKey];
    const rule = type ? drapeRule(type, gdims, "better") : null; // geometry is tier-independent
    if (!rule) return;
    curtainItems.push({ key, desc, unit: "ea", qty: count, drape: { w: rule.w, h: rule.h, fullness: rule.fullness, qty: rule.qty } });
  };
  addDrape(drape.draw, "curtains:draw", "Draw", dBlk * 1, "draw");
  addDrape(drape.legs, "curtains:legs", "Leg", dBlk * 2, "legs");
  addDrape(drape.border, "curtains:border", "Border", dBlk * 1, "border");
  addDrape(drape.fullstage, "curtains:fullstage", "Full stage", dBlk * 1, "fullstage");
  // Track hardware, not soft goods. Jeff 2026-07-27: it follows the pipe rule
  // (PRO width + 4 ft in a proscenium house, room width elsewhere). One run per
  // depth block, measured in FEET so a per-foot catalog track prices it.
  if (drape.scenerytrack && dBlk > 0) curtainItems.push(eq("curtains:scenerytrack", "Scenery track", "ft", dBlk * pipeLenFt));

  // Fixtures — multi. E = unified electric count; wUnit ≈ 1 per 8 ft of width.
  const fx = s.fixtures || {};
  const E = Math.max(1, electrics);
  const wUnit = Math.max(1, Math.round(W / 8));
  const lightItems: Eq[] = [];
  const addFix = (key: string, on: boolean | undefined, desc: string, qty: number) => {
    if (on && qty > 0) lightItems.push(eq(`lighting:${key}`, desc, "ea", qty));
  };
  addFix("par", fx.par, "Par", Math.round(E * wUnit * pick(0.7, 1, 1.2)));
  addFix("front", fx.front, "Front", Math.round(wUnit * pick(2, 2.5, 3)));
  addFix("cyc", fx.cyc, "Cyc", Math.round(wUnit * pick(1, 1.25, 1.5)));
  addFix("side", fx.side, "Side light", Math.round(E * wUnit * pick(0, 0.5, 0.75)));
  const automatedQty = Math.round(E * wUnit * pick(0, 0.5, 0.9));
  addFix("automated", fx.automated, "Automated", automatedQty);
  // dimmer racks derive from the real conventional-fixture total (movers are non-dim, DMX)
  const convFixTotal = lightItems.reduce((a, it) => a + it.qty, 0) - (fx.automated ? automatedQty : 0);
  dimmerRacks = s.sys.lighting ? Math.max(1, Math.ceil(convFixTotal / 48)) : 0;

  // Controls — multi (Console / Architectural / Data groups)
  const ctrl = s.ctrl || {};
  const ctrlItems: Eq[] = [];
  if (ctrl.console) {
    ctrlItems.push(eq("controls:console", "Console", "ea", 1));
    ctrlItems.push(eq("controls:consoleTouch", "Console touch screen", "ea", pick(1, 2, 2)));
    if (size === "large") ctrlItems.push(eq("controls:batteryBackup", "Battery backup", "ea", 1));
  }
  if (ctrl.architectural) {
    ctrlItems.push(eq("controls:processor", "Processor", "ea", 1));
    ctrlItems.push(eq("controls:button", "Button", "ea", pick(fl(W / 20), fl(W / 10), fl(W / 5))));
    if (size === "large") ctrlItems.push(eq("controls:archTouch", "Architectural touch screen", "ea", 1));
  }
  if (ctrl.data) {
    ctrlItems.push(eq("controls:inputStation", "Input station", "ea", pick(1, 2, 4)));
    ctrlItems.push(eq("controls:outputStation", "Output station", "ea", pick(2 * fl(D / 7), 2 * fl(D / 4), 2 * fl(D / 3))));
    ctrlItems.push(eq("controls:distro", "Distro system", "ea", 1));
  }

  // Acoustical shell — multi (size-independent)
  const shell = s.shell || {};
  const shellItems: Eq[] = [];
  if (shell.towers) shellItems.push(eq("acoustical:tower", "Tower", "ea", fl(W / 10) + 2 * fl(D / 10)));
  if (shell.ceiling) shellItems.push(eq("acoustical:ceiling", "Ceiling", "ea", fl(D / 10)));
  if (shell.transport) shellItems.push(eq("acoustical:transport", "Transport", "ea", fl(D / 10)));

  // Pit filler — single. Per-sqft over Pro Width × 10 ft.
  const pitType = s.pitType || "legged";
  const pitArea = W * 10;
  const pitItems: Eq[] =
    pitType === "clearspan"
      ? [eq("pit:clearspan", "Clear-span pit filler deck", "sqft", pitArea)]
      : [eq("pit:legged", "Legged pit filler deck", "sqft", pitArea)];

  const defs: Array<{ key: SysKey; name: string; on: boolean; m: number; dot: string; items: Eq[] }> = [
    { key: "rigging", name: "Rigging", on: s.sys.rigging, m: 0.3, dot: "#7b3f8a", items: rigItems },
    { key: "curtains", name: "Curtains", on: s.sys.curtains, m: 0.3, dot: "#b4543a", items: curtainItems },
    { key: "lighting", name: "Fixtures", on: s.sys.lighting, m: 0.3, dot: "#c98a2b", items: lightItems },
    { key: "controls", name: "Controls", on: s.sys.controls, m: 0.3, dot: "#1f7a52", items: ctrlItems },
    { key: "acoustical", name: "Acoustical Shell", on: s.sys.acoustical, m: 0.3, dot: "#6f6f78", items: shellItems },
    { key: "pit", name: "Pit Filler", on: s.sys.pit, m: 0.3, dot: "#9a4a6a", items: pitItems },
    {
      key: "audio", name: "Audio", on: s.sys.audio, m: 0.3, dot: "#3155a8",
      items: [
        eq("audio:lineArray", "Line-array loudspeaker", "ea", arrayBoxes),
        eq("audio:subwoofer", "Subwoofer", "ea", subs),
        eq("audio:mixerDsp", "Digital mixer, DSP & amplifiers", "lot", 1),
      ],
    },
    {
      key: "video", name: "Video", on: s.sys.video, m: 0.31, dot: "#2a7d8a",
      items: [
        eq("video:projector", "Laser projector, 4K", "ea", projectors),
        eq("video:screen", "Projection screen / LED wall", "lot", 1),
        eq("video:processor", "Video processor & switcher", "lot", 1),
      ],
    },
  ];
  const systems: SystemBlock[] = defs.map((d) => ({
    ...d,
    items: d.items.map((it): BomItem => ({ ...it, cost: 0, price: 0 })),
    rev: 0,
    cost: 0,
  }));
  return { lineSets, electrics, drapeArea, dimmerRacks, rigType, systems, rigSets: rigSetsFor(s) };
}

/* -------------------------- tier pipeline & totals -------------------------- */

export function tierTotals(
  systems: SystemBlock[],
  td: TierMeta,
  laborPct: number,
  freightPct: number,
  contPct: number
): TierTotals {
  let matRev = 0;
  let matCost = 0;
  systems.forEach((x) => {
    if (x.on) {
      const pm = x.tierFixed ? 1 : td.priceMul;
      const cm = x.tierFixed ? 1 : td.costMul;
      matRev += x.rev * pm;
      matCost += x.cost * cm;
    }
  });
  const install = Math.round(matRev * laborPct);
  const freight = Math.round(matRev * freightPct);
  const subtotal = matRev + install + freight;
  const contingency = Math.round(subtotal * (contPct || 0));
  return {
    matRev,
    matCost,
    install,
    freight,
    contingency,
    grand: subtotal + contingency,
    margin: matRev > 0 ? (matRev - matCost) / matRev : 0,
  };
}

/** scale the rigging system's quantities by the tier's chosen line-set count */
export function scaleSets(systems: SystemBlock[], C: ComputeResult, tierKey: TierKey, tierDefs: TierDefs): SystemBlock[] {
  const baseSets = C.rigSets || 1;
  const td = tierDefs[tierKey];
  const setsVal = td && td.sets != null ? td.sets : baseSets;
  if (setsVal === baseSets) return systems;
  const ratio = setsVal / baseSets;
  return systems.map((sys) => {
    if (sys.key !== "rigging") return sys;
    let rev = 0;
    let cost = 0;
    const items = sys.items.map((it) => {
      const q = Math.max(0, Math.round(it.qty * ratio));
      rev += q * it.price;
      cost += q * it.cost;
      return { ...it, qty: q };
    });
    return { ...sys, items, rev, cost };
  });
}

/** apply the tier's per-item manual quantity overrides */
export function applyOverrides(systems: SystemBlock[], s: AState, tierKey: TierKey): SystemBlock[] {
  const ov = (s.qtyOverrides && s.qtyOverrides[tierKey]) || {};
  return systems.map((sys) => {
    const so = ov[sys.key];
    if (!so) return sys;
    let rev = 0;
    let cost = 0;
    const items = sys.items.map((it) => {
      const q = so[it.desc] != null ? so[it.desc] : it.qty;
      rev += q * it.price;
      cost += q * it.cost;
      return { ...it, qty: q };
    });
    return { ...sys, items, rev, cost };
  });
}

/* --------------------------------- riser --------------------------------- */

export type RiserNode = {
  label: string;
  sub: string;
  tag: string;
  tone: string;
  tint: string;
  connector: boolean;
};

export type RiserData = { empty: boolean; has: boolean; estop: boolean; nodes: RiserNode[] };

export function buildRiser(s: AState, dimmerRacks: number, lineSets: number, accentInk: string, accentSoft: string): RiserData {
  const nodes: Array<Omit<RiserNode, "connector">> = [];
  const mk = (label: string, sub: string, tone: string, tint: string, tag: string) => ({ label, sub, tag, tone, tint });
  const ctrl = s.ctrl || {};
  const motorized = s.sys.rigging && (s.rigType || "counterweight") === "motorized";
  nodes.push(mk("480V / 3Ø Building Service", "Utility feed", "#5b616e", "#f3f4f6", "POWER"));
  nodes.push(mk("Main Disconnect + Line Filter", "Fused, surge-protected", "#5b616e", "#f3f4f6", "POWER"));
  if (s.sys.controls && ctrl.console) nodes.push(mk("Automation & Lighting Console", "ETC Foundation control", accentInk, accentSoft, "CTRL"));
  if (s.sys.controls && ctrl.architectural) nodes.push(mk("Architectural Control Processor", "Room combine, presets, stations", accentInk, accentSoft, "ARCH"));
  if (s.sys.controls && ctrl.data) nodes.push(mk("Show Network Switch", "Managed, redundant ring", accentInk, accentSoft, "NET"));
  if (motorized) nodes.push(mk("Rigging Drive Racks ×" + Math.max(1, Math.ceil(lineSets / 8)), "Motorized line-set automation", "#7b3f8a", "#f1ecf5", "RIG"));
  if (s.sys.lighting) nodes.push(mk("Dimmer / Relay Racks ×" + dimmerRacks, "96-circuit, networked", "#c98a2b", "#fbf3e2", "DIM"));
  if (s.sys.audio) nodes.push(mk("Amplifier / DSP Rack", "Networked audio (Dante)", "#3155a8", "#eaf0fb", "AUDIO"));
  if (s.sys.video) nodes.push(mk("Video Processing & Switch", "Scaler, matrix, distribution", "#2a7d8a", "#e6f2f4", "VIDEO"));
  const withConn: RiserNode[] = nodes.map((n, i) => ({ ...n, connector: i > 0 }));
  const ctrlActive = s.sys.controls && (ctrl.console || ctrl.architectural || ctrl.data);
  const has = !!(ctrlActive || motorized || s.sys.lighting || s.sys.audio || s.sys.video);
  return { empty: !has, has, estop: !!(s.sys.controls && ctrl.console), nodes: has ? withConn : [] };
}

/* ------------------------- default / hydrate state ------------------------- */

/** The prototype's constructor default for state.a (contingency comes from PricingRules). */
export function defaultAState(contingencyPct: number): AState {
  return {
    venue: "concenter",
    size: "large",
    width: 50,
    depth: 30,
    grid: 50,
    wing: 10,
    ph: 20,
    sys: { rigging: true, curtains: true, lighting: true, controls: true, audio: false, video: false, acoustical: true, pit: true },
    view: "estimate",
    tier: "better",
    contingency: contingencyPct,
    rigType: "motorized",
    drape: { draw: true, legs: true, border: true, scenerytrack: false, fullstage: true },
    fixtures: { par: true, front: true, cyc: true, side: true, automated: true },
    fixtureAssemblies: {},
    ctrl: { console: true, architectural: true, data: true },
    shell: { towers: true, ceiling: true, transport: true },
    pitType: "clearspan",
    qtyOverrides: {},
    mode: "auto",
    placements: [],
  };
}

export type DesignRecordLike = {
  name?: string | null;
  venue?: string | null;
  size?: string | null;
  tier?: string | null;
  width?: number | null;
  depth?: number | null;
  grid?: number | null;
  systems?: string[] | null;
  config?: Record<string, unknown> | null;
};

/** seed designs have no full config — rebuild a reasonable state from display fields */
export function reconstruct(d: DesignRecordLike, base: AState): AState {
  const out: AState = { ...base, sys: { ...base.sys } };
  const venue = VENUES.find((v) => v.label === d.venue);
  if (venue) out.venue = venue.key;
  if (d.size) out.size = d.size as SizeKey;
  if (d.tier) out.tier = d.tier as TierKey;
  if (d.width) out.width = d.width;
  if (d.depth) out.depth = d.depth;
  if (d.grid) out.grid = d.grid;
  const rev: Record<string, SysKey> = {};
  (Object.keys(SHORT) as SysKey[]).forEach((k) => {
    rev[SHORT[k]] = k;
  });
  const sys = { ...out.sys };
  (Object.keys(sys) as SysKey[]).forEach((k) => {
    sys[k] = false;
  });
  (d.systems || []).forEach((nm) => {
    const k = rev[nm];
    if (k) sys[k] = true;
  });
  out.sys = sys;
  return out;
}

/**
 * A saved "Scenery track" qty override (qtyOverrides[tier].curtains["Scenery
 * track"]) predates #GEM T5: it was a COUNT of track runs. The row now emits
 * FEET (depth blocks × pipe length — see compute()), so an old override's
 * number means something different than it did when it was saved. There is
 * no safe conversion (we don't know the pipe length it was saved against),
 * so hydrateAState drops the key rather than silently mis-applying it; the
 * calculated (correct) feet quantity is used until the designer re-edits it.
 */
function dropStaleSceneryTrackOverride(qtyOverrides: AState["qtyOverrides"]): AState["qtyOverrides"] {
  if (!qtyOverrides) return qtyOverrides;
  let changed = false;
  const next: AState["qtyOverrides"] = {};
  for (const [tier, bySys] of Object.entries(qtyOverrides) as Array<[TierKey, Record<string, Record<string, number>>]>) {
    if (bySys && bySys.curtains && Object.prototype.hasOwnProperty.call(bySys.curtains, "Scenery track")) {
      changed = true;
      const restCurtains = { ...bySys.curtains };
      delete restCurtains["Scenery track"];
      next[tier] = { ...bySys, curtains: restCurtains };
    } else {
      next[tier] = bySys;
    }
  }
  return changed ? next : qtyOverrides;
}

/** hydrate designer state from a saved record: full config when present, else reconstruct. */
export function hydrateAState(d: DesignRecordLike, contingencyPct: number): AState {
  const base = defaultAState(contingencyPct);
  if (d.config) {
    const cfg = d.config as Partial<AState>;
    const merged: AState = { ...base, ...cfg, sys: { ...base.sys, ...(cfg.sys || {}) } };
    // Only touch qtyOverrides when the saved config actually carries one —
    // a config that never set the key must fall through to base's default
    // ({}), exactly like every other omitted AState field here.
    if (cfg.qtyOverrides !== undefined) merged.qtyOverrides = dropStaleSceneryTrackOverride(cfg.qtyOverrides);
    return merged;
  }
  return reconstruct(d, base);
}

/** The auto-suffix of the design name: "{Tier} design (W'×D')". */
export function nameSuffix(s: AState): string {
  const td = TIERS.find((t) => t.key === (s.tier || "better")) || TIERS[1];
  return td.label + " design (" + s.width + "'×" + s.depth + "')";
}
