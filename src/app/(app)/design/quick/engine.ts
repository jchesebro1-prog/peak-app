/**
 * Quick Design estimating engine — exact port of the logic class embedded in
 * app/Quick Design.dc.html (the budgetary auto-estimate path). Every venue
 * preset, dimension schema, sizing equation, tier SKU table and roll-up
 * formula is carried over verbatim; this module is the single source shared
 * by the Quick Design screen and the Design dashboard's detail summary.
 *
 * Pure data + math — no React, no I/O. The manual-layout placement engine is
 * NOT ported (plan-drawing editor deferred with the spatial-estimating work).
 */

import { drapeRule } from "@/lib/design/goods";
import { curtainCost, SEED_FABRIC_RATES, makingRateFor } from "@/lib/design/curtain-pricing";
import { venueDimsFromEstimator, type VenueDims } from "@/lib/design/venue-dims";

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

export type BomItem = {
  desc: string;
  qty: number;
  unit: string;
  cost: number;
  price: number;
  area?: number;
  fabricKey?: string | null;
  sku?: boolean;
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

export type FabricOption = { sku: string; desc: string; costPerSqft: number | null };

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
};

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

/**
 * Per-tier equipment SKUs (drive price by gear choice, not just a multiplier).
 * Keyed tier → system → item desc → unit cost. 'better' equals the base
 * catalog cost. Lines with no SKU entry fall back to the global multiplier.
 */
export const TIER_SKUS: Record<TierKey, Partial<Record<SysKey, Record<string, number>>>> = {
  good: {
    lighting: { Par: 500, Front: 1600, Cyc: 1200, "Side light": 1250, Automated: 2100 },
    controls: { Console: 4800, "Console touch screen": 1400, "Battery backup": 20, Processor: 7000, Button: 180, "Architectural touch screen": 1400, "Input station": 70, "Output station": 90, "Distro system": 2100 },
    audio: { "Line-array loudspeaker": 1000, Subwoofer: 1300, "Digital mixer, DSP & amplifiers": 9900 },
    video: { "Laser projector, 4K": 13000, "Video processor & switcher": 6800 },
    acoustical: { Tower: 7000, Ceiling: 14000, Transport: 700 },
    pit: { "Legged pit filler deck": 100, "Clear-span pit filler deck": 120 },
  },
  better: {
    lighting: { Par: 750, Front: 2250, Cyc: 1750, "Side light": 1800, Automated: 3000 },
    controls: { Console: 7000, "Console touch screen": 2000, "Battery backup": 30, Processor: 10000, Button: 250, "Architectural touch screen": 2000, "Input station": 100, "Output station": 125, "Distro system": 3000 },
    audio: { "Line-array loudspeaker": 1450, Subwoofer: 1850, "Digital mixer, DSP & amplifiers": 14200 },
    video: { "Laser projector, 4K": 18500, "Video processor & switcher": 9800 },
    acoustical: { Tower: 10000, Ceiling: 20000, Transport: 1000 },
    pit: { "Legged pit filler deck": 125, "Clear-span pit filler deck": 150 },
  },
  best: {
    lighting: { Par: 1150, Front: 3400, Cyc: 2600, "Side light": 2700, Automated: 4600 },
    controls: { Console: 10500, "Console touch screen": 3000, "Battery backup": 45, Processor: 15000, Button: 380, "Architectural touch screen": 3000, "Input station": 150, "Output station": 190, "Distro system": 4500 },
    audio: { "Line-array loudspeaker": 2200, Subwoofer: 2800, "Digital mixer, DSP & amplifiers": 21500 },
    video: { "Laser projector, 4K": 28000, "Video processor & switcher": 14800 },
    acoustical: { Tower: 15000, Ceiling: 30000, Transport: 1500 },
    pit: { "Legged pit filler deck": 165, "Clear-span pit filler deck": 200 },
  },
};

/** Authored Good / Better / Best spec descriptions per system: [good, better, best]. */
const SPEC_DEFAULTS: Record<SysKey, [string, string, string]> = {
  rigging: ["Manual counterweight, basic line sets", "Counterweight / motor-assist, T-track guides", "Fully automated hoists, variable-speed control & monitoring"],
  curtains: ["16 oz Encore velour, fixed track", "21 oz Marvel velour, walkalong / draw track", "25 oz Memorable velour, motorized track & added fullness"],
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

/** Quick Design's curtain toggle keys (`drape.draw` etc.), mapped to the
 *  drape TYPE goods.ts's FABRIC_BY_TYPE_TIER / drapeRule key on. */
const CURTAIN_KEY_TO_TYPE: Record<string, string> = { draw: "Draw", legs: "Legs", border: "Border", fullstage: "Rear" };

/**
 * One curtain drape's two-term make cost + sewn area at a given tier, keyed
 * by Quick Design's fabricKey. Shared by compute() (at s.tier) and
 * applyFabrics (per tier column) so the budget and the tier grid price
 * curtains identically — the tier column is no longer allowed to fall back
 * to the old area × costPerSqft formula.
 */
export function curtainMakeCost(fabricKey: string, dims: VenueDims, tierKey: TierKey): { cost: number; area: number } | null {
  const type = CURTAIN_KEY_TO_TYPE[fabricKey];
  if (!type) return null;
  const rule = drapeRule(type, dims, tierKey);
  if (!rule) return null;
  const cc = curtainCost(
    { finishedWidthFt: rule.w, finishedHeightFt: rule.h, fullnessPct: rule.fullness, qty: rule.qty },
    { fabricRate: SEED_FABRIC_RATES[rule.fabricSku] ?? 0, makingRate: makingRateFor(rule.fullness) }
  );
  return { cost: Math.round(cc.costTotal), area: Math.round(cc.sewnAreaSqft) };
}

/* --------------------------------- compute --------------------------------- */

/** Pure function of the designer state — the refined BOM equations. */
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

  // ---- Refined BOM equations (feet; floor blocks; flat 30% margin) ----
  const fl = Math.floor;
  const W = s.width;
  const D = s.depth;
  const G = s.grid;
  const size = s.size || "medium";
  const pick = <T,>(sm: T, md: T, lg: T): T => (size === "small" ? sm : size === "large" ? lg : md);
  const dBlk = fl(D / 10); // 10-ft depth blocks

  // Rigging — single type
  const rigType = s.rigType || "counterweight";
  let rigItems: Array<{ desc: string; unit: string; qty: number; cost: number; area?: number; fabricKey?: string | null }>;
  if (rigType === "motorized") {
    const m = pick({ el: 2, lo: 2, hi: 2, vs: 0 }, { el: 3, lo: 3, hi: 3, vs: 1 }, { el: 4, lo: 4, hi: 2, vs: 2 });
    rigItems = [
      { desc: "Electric hoist", unit: "ea", qty: m.el * Math.max(2, fl(D / 30)), cost: 60000 },
      { desc: "Low-capacity hoist", unit: "ea", qty: m.lo * dBlk, cost: 15000 },
      { desc: "High-capacity hoist", unit: "ea", qty: m.hi * dBlk, cost: 40000 },
    ];
    if (m.vs) rigItems.push({ desc: "Variable-speed hoist", unit: "ea", qty: m.vs * dBlk, cost: 60000 });
  } else if (rigType === "deadhung") {
    const sets = pick(5, 6, 7) * dBlk;
    const points = sets * fl(W / 10);
    rigItems = [
      { desc: "Rigging point", unit: "ea", qty: points, cost: 20 },
      { desc: "Pipe", unit: "ft", qty: sets * W, cost: 8 },
      { desc: "Aircraft cable", unit: "ft", qty: points * G, cost: 0.02 },
      { desc: "Chain wrap, 3 ft", unit: "ea", qty: points, cost: 1 },
      { desc: "Termination kit", unit: "ea", qty: points * 2, cost: 1 },
    ];
  } else {
    // Counterweight — driven by the number of line sets.
    const sets = pick(5, 6, 7) * dBlk;
    const loftPerSet = Math.max(1, fl(W / 10)); // 1 loftblock per 10 ft of pro width, per set
    const loft = sets * loftPerSet;
    rigItems = [
      { desc: "Headblock", unit: "ea", qty: sets, cost: 550 },
      { desc: "Footblock", unit: "ea", qty: sets, cost: 350 },
      { desc: "Arbor", unit: "ea", qty: sets, cost: 700 },
      { desc: "T-bar track", unit: "ea", qty: sets, cost: 100 },
      { desc: "Lock rail", unit: "ea", qty: sets, cost: 30 },
      { desc: "Handline", unit: "ft", qty: sets * 2 * G, cost: 3 },
      { desc: "Pipe", unit: "ft", qty: sets * W, cost: 8 },
      { desc: "Loftblock", unit: "ea", qty: loft, cost: 250 },
      { desc: "Aircraft cable", unit: "ft", qty: loft * (2 * G + W), cost: 0.02 },
      { desc: "Termination kit", unit: "ea", qty: loft * 2, cost: 1 },
      { desc: "Chain wrap, 3 ft", unit: "ea", qty: loft, cost: 1 },
    ];
  }

  // Curtains — multi. The four fabric drapes (Draw/Legs/Border/Rear) price
  // through the shared two-term make-it model, from the same goods.ts drape
  // geometry the quote side and the lineset weights use; qty per 10-ft depth
  // block. Scenery track is hardware, not soft goods, and keeps its lump
  // per-ft price via addCurtain.
  const drape = s.drape || {};
  const curtainItems: Array<{ desc: string; unit: string; qty: number; cost: number; area?: number; fabricKey?: string | null }> = [];
  const addCurtain = (on: boolean | undefined, desc: string, count: number, area: number, rate: number, fabricKey: string | null) => {
    if (on && count > 0) curtainItems.push({ desc, unit: "ea", qty: count, cost: Math.round(area * rate), area, fabricKey });
  };
  const gdims = venueDimsFromEstimator(s);
  const priceDrape = (on: boolean | undefined, desc: string, count: number, fabricKey: string) => {
    if (!on || count <= 0) return;
    const r = curtainMakeCost(fabricKey, gdims, s.tier);
    if (!r) return;
    curtainItems.push({ desc, unit: "ea", qty: count, cost: r.cost, area: r.area, fabricKey });
  };
  priceDrape(drape.draw, "Draw", dBlk * 1, "draw");
  priceDrape(drape.legs, "Leg", dBlk * 2, "legs");
  priceDrape(drape.border, "Border", dBlk * 1, "border");
  priceDrape(drape.fullstage, "Full stage", dBlk * 1, "fullstage");
  addCurtain(drape.scenerytrack, "Scenery track", dBlk * 1, W * 1, 3, null); // track hardware, not soft goods — unchanged

  // Fixtures — multi. E = unified electric count; wUnit ≈ 1 per 8 ft of width.
  const fx = s.fixtures || {};
  const E = Math.max(1, electrics);
  const wUnit = Math.max(1, Math.round(W / 8));
  const lightItems: Array<{ desc: string; unit: string; qty: number; cost: number }> = [];
  const addFix = (on: boolean | undefined, desc: string, qty: number, cost: number) => {
    if (on && qty > 0) lightItems.push({ desc, unit: "ea", qty, cost });
  };
  addFix(fx.par, "Par", Math.round(E * wUnit * pick(0.7, 1, 1.2)), 750);
  addFix(fx.front, "Front", Math.round(wUnit * pick(2, 2.5, 3)), 2250);
  addFix(fx.cyc, "Cyc", Math.round(wUnit * pick(1, 1.25, 1.5)), 1750);
  addFix(fx.side, "Side light", Math.round(E * wUnit * pick(0, 0.5, 0.75)), 1800);
  addFix(fx.automated, "Automated", Math.round(E * wUnit * pick(0, 0.5, 0.9)), 3000);
  // dimmer racks derive from the real conventional-fixture total (movers are non-dim, DMX)
  const convFixTotal = lightItems.reduce((a, it) => a + (it.desc === "Automated" ? 0 : it.qty), 0);
  dimmerRacks = s.sys.lighting ? Math.max(1, Math.ceil(convFixTotal / 48)) : 0;

  // Controls — multi (Console / Architectural / Data groups)
  const ctrl = s.ctrl || {};
  const ctrlItems: Array<{ desc: string; unit: string; qty: number; cost: number }> = [];
  if (ctrl.console) {
    ctrlItems.push({ desc: "Console", unit: "ea", qty: 1, cost: 7000 });
    ctrlItems.push({ desc: "Console touch screen", unit: "ea", qty: pick(1, 2, 2), cost: 2000 });
    if (size === "large") ctrlItems.push({ desc: "Battery backup", unit: "ea", qty: 1, cost: 30 });
  }
  if (ctrl.architectural) {
    ctrlItems.push({ desc: "Processor", unit: "ea", qty: 1, cost: 10000 });
    ctrlItems.push({ desc: "Button", unit: "ea", qty: pick(fl(W / 20), fl(W / 10), fl(W / 5)), cost: 250 });
    if (size === "large") ctrlItems.push({ desc: "Architectural touch screen", unit: "ea", qty: 1, cost: 2000 });
  }
  if (ctrl.data) {
    ctrlItems.push({ desc: "Input station", unit: "ea", qty: pick(1, 2, 4), cost: 100 });
    ctrlItems.push({ desc: "Output station", unit: "ea", qty: pick(2 * fl(D / 7), 2 * fl(D / 4), 2 * fl(D / 3)), cost: 125 });
    ctrlItems.push({ desc: "Distro system", unit: "ea", qty: 1, cost: 3000 });
  }

  // Acoustical shell — multi (size-independent)
  const shell = s.shell || {};
  const shellItems: Array<{ desc: string; unit: string; qty: number; cost: number }> = [];
  if (shell.towers) shellItems.push({ desc: "Tower", unit: "ea", qty: fl(W / 10) + 2 * fl(D / 10), cost: 10000 });
  if (shell.ceiling) shellItems.push({ desc: "Ceiling", unit: "ea", qty: fl(D / 10), cost: 20000 });
  if (shell.transport) shellItems.push({ desc: "Transport", unit: "ea", qty: fl(D / 10), cost: 1000 });

  // Pit filler — single. Per-sqft over Pro Width × 10 ft.
  const pitType = s.pitType || "legged";
  const pitArea = W * 10;
  const pitItems =
    pitType === "clearspan"
      ? [{ desc: "Clear-span pit filler deck", unit: "sqft", qty: pitArea, cost: 150 }]
      : [{ desc: "Legged pit filler deck", unit: "sqft", qty: pitArea, cost: 125 }];

  const defs: Array<{
    key: SysKey;
    name: string;
    on: boolean;
    m: number;
    dot: string;
    items: Array<{ desc: string; unit: string; qty: number; cost: number; area?: number; fabricKey?: string | null }>;
  }> = [
    { key: "rigging", name: "Rigging", on: s.sys.rigging, m: 0.3, dot: "#7b3f8a", items: rigItems },
    { key: "curtains", name: "Curtains", on: s.sys.curtains, m: 0.3, dot: "#b4543a", items: curtainItems },
    { key: "lighting", name: "Fixtures", on: s.sys.lighting, m: 0.3, dot: "#c98a2b", items: lightItems },
    { key: "controls", name: "Controls", on: s.sys.controls, m: 0.3, dot: "#1f7a52", items: ctrlItems },
    { key: "acoustical", name: "Acoustical Shell", on: s.sys.acoustical, m: 0.3, dot: "#6f6f78", items: shellItems },
    { key: "pit", name: "Pit Filler", on: s.sys.pit, m: 0.3, dot: "#9a4a6a", items: pitItems },
    {
      key: "audio", name: "Audio", on: s.sys.audio, m: 0.3, dot: "#3155a8",
      items: [
        { desc: "Line-array loudspeaker", unit: "ea", qty: arrayBoxes, cost: 1450 },
        { desc: "Subwoofer", unit: "ea", qty: subs, cost: 1850 },
        { desc: "Digital mixer, DSP & amplifiers", unit: "lot", qty: 1, cost: 14200 },
      ],
    },
    {
      key: "video", name: "Video", on: s.sys.video, m: 0.31, dot: "#2a7d8a",
      items: [
        { desc: "Laser projector, 4K", unit: "ea", qty: projectors, cost: 18500 },
        { desc: "Projection screen / LED wall", unit: "lot", qty: 1, cost: Math.round(s.width * 260) },
        { desc: "Video processor & switcher", unit: "lot", qty: 1, cost: 9800 },
      ],
    },
  ];
  const systems: SystemBlock[] = defs.map((d) => {
    let rev = 0;
    let cost = 0;
    const items: BomItem[] = d.items.map((it) => {
      const price = it.cost / (1 - d.m);
      rev += it.qty * price;
      cost += it.qty * it.cost;
      return { desc: it.desc, qty: it.qty, unit: it.unit || "ea", cost: it.cost, price, area: it.area, fabricKey: it.fabricKey };
    });
    return { ...d, items, rev, cost };
  });
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

export function fabricRate(fabrics: FabricOption[], sku: string | undefined): number {
  const f = fabrics.find((p) => p.sku === sku);
  return f && f.costPerSqft != null ? f.costPerSqft : 3.0;
}

/**
 * Recompute the curtains system's fabric items for the active tier.
 *
 * Curtains price through the SAME two-term make-it model compute() uses,
 * keyed by FABRIC_BY_TYPE_TIER[type][tierKey] (goods.ts) via curtainMakeCost
 * — NOT tierDefs[tierKey].fabrics + area × costPerSqft. That old path is what
 * the Quick Design SCREEN rendered through tierSystems/tierSystemsBase even
 * after compute() moved to the shared model (task 6 integration defect): the
 * budget priced curtains one way and the rendered tier grid another. tierDefs
 * and fabrics are kept as parameters (other systems / callers still pass
 * them) but are no longer consulted for curtains.
 */
export function applyFabrics(systems: SystemBlock[], tierKey: TierKey, tierDefs: TierDefs, fabrics: FabricOption[], s: AState): SystemBlock[] {
  const margin = 0.3;
  const dims = venueDimsFromEstimator(s);
  return systems.map((sys) => {
    if (sys.key !== "curtains") return sys;
    let rev = 0;
    let cost = 0;
    const items = sys.items.map((it) => {
      if (!it.fabricKey || it.area == null) {
        rev += it.qty * it.price;
        cost += it.qty * it.cost;
        return it;
      }
      const r = curtainMakeCost(it.fabricKey, dims, tierKey);
      const c = r ? r.cost : it.cost;
      const area = r ? r.area : it.area;
      const price = c / (1 - margin);
      rev += it.qty * price;
      cost += it.qty * c;
      return { ...it, cost: c, price, area };
    });
    return { ...sys, items, rev, cost, tierFixed: true };
  });
}

/**
 * recompute the OTHER systems from the tier's per-item SKU costs — each priced
 * line becomes gear-driven, and the system is marked tierFixed so tierTotals
 * doesn't re-apply the global multiplier. Lines with no SKU keep the multiplier.
 */
export function applySkus(systems: SystemBlock[], tierKey: TierKey): SystemBlock[] {
  const table = TIER_SKUS[tierKey] || {};
  const tierMul = TIERS.find((t) => t.key === tierKey) || TIERS[1];
  return systems.map((sys) => {
    const skus = table[sys.key];
    if (!skus) return sys;
    const margin = typeof sys.m === "number" ? sys.m : 0.3;
    let rev = 0;
    let cost = 0;
    const items = sys.items.map((it) => {
      const skuCost = skus[it.desc];
      if (skuCost == null) {
        // no SKU for this line — keep multiplier behavior
        const c = Math.round(it.cost * tierMul.costMul);
        const p = it.price * tierMul.priceMul;
        rev += it.qty * p;
        cost += it.qty * c;
        return { ...it, cost: c, price: p };
      }
      const c = Math.round(skuCost);
      const p = c / (1 - margin);
      rev += it.qty * p;
      cost += it.qty * c;
      return { ...it, cost: c, price: p, sku: true };
    });
    return { ...sys, items, rev, cost, tierFixed: true };
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

/** the full per-tier pipeline: scaleSets → applyFabrics → applySkus → applyOverrides */
export function tierSystems(
  C: ComputeResult,
  s: AState,
  tierKey: TierKey,
  tierDefs: TierDefs,
  fabrics: FabricOption[]
): SystemBlock[] {
  return applyOverrides(applySkus(applyFabrics(scaleSets(C.systems, C, tierKey, tierDefs), tierKey, tierDefs, fabrics, s), tierKey), s, tierKey);
}

/** same pipeline without overrides (the BOM's base rows). */
export function tierSystemsBase(
  C: ComputeResult,
  s: AState,
  tierKey: TierKey,
  tierDefs: TierDefs,
  fabrics: FabricOption[]
): SystemBlock[] {
  return applySkus(applyFabrics(scaleSets(C.systems, C, tierKey, tierDefs), tierKey, tierDefs, fabrics, s), tierKey);
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

/** hydrate designer state from a saved record: full config when present, else reconstruct. */
export function hydrateAState(d: DesignRecordLike, contingencyPct: number): AState {
  const base = defaultAState(contingencyPct);
  if (d.config) return { ...base, ...(d.config as Partial<AState>), sys: { ...base.sys, ...((d.config as Partial<AState>).sys || {}) } };
  return reconstruct(d, base);
}

/** The auto-suffix of the design name: "{Tier} design (W'×D')". */
export function nameSuffix(s: AState): string {
  const td = TIERS.find((t) => t.key === (s.tier || "better")) || TIERS[1];
  return td.label + " design (" + s.width + "'×" + s.depth + "')";
}
