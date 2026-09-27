/**
 * Wire pull (#231) and system labor (#232) — pure and client-safe: this
 * module has type-only imports (a #231 harness guard checks it).
 *
 * Wire pull, per wire system:
 *   feet = ⌈(stage width + stage depth + house depth) × runs × tier ×⌉
 * A missing dimension counts 0 and the line carries a note saying so. runs 0
 * (the default) emits no line at all. Footage is a QUANTITY: each system's
 * Equipment-map "Wire pull" row prices it (D303/D304), like any equation item.
 *
 * Labor, per system:
 *   labor = that system's priced material × labor % × tier ×
 * No tier chosen (a hand-built Grid design) → ×1.0. These multipliers are
 * LIVE and scale footage / labor only; the reference price multipliers
 * (system.tier*Cost / *Price, D304) stay inert.
 *
 * The rules are Estimating Rules (pricing.ts groups "wire" and "labor", the
 * general store); loadWireLaborRules() reads them on the server and
 * wireLaborRulesFrom() here is the one sanitizer. An unset labor % takes the
 * stored flat install % (LEGACY_INSTALL_PCT_ID), else 18.
 */
import type { BomItem, SysKey, SystemBlock, TierKey } from "@/app/(app)/design/quick/engine";

/* -------------------------------- the rules -------------------------------- */

export const WIRE_SYSTEMS = ["rigging", "lighting", "controls", "audio", "video"] as const;
export type WireSystem = (typeof WIRE_SYSTEMS)[number];

/** Every Quick Design system, plus "general" — Grid lines that belong to no system. */
export const LABOR_SYSTEMS = ["rigging", "curtains", "lighting", "controls", "acoustical", "pit", "audio", "video", "general"] as const;
export type LaborSystem = (typeof LABOR_SYSTEMS)[number];

export const LABOR_SYSTEM_LABEL: Record<LaborSystem, string> = {
  rigging: "Rigging",
  curtains: "Curtains",
  lighting: "Lighting",
  controls: "Controls",
  acoustical: "Acoustical",
  pit: "Pit",
  audio: "Audio",
  video: "Video",
  general: "General",
};

export type TierMults = Record<TierKey, number>;
export type WireRule = { runs: number; mult: TierMults };
/** `pct` is the percent number (18 = 18 %). */
export type LaborRule = { pct: number; mult: TierMults };
export type WireLaborRules = { wire: Record<WireSystem, WireRule>; labor: Record<LaborSystem, LaborRule> };

export const DEFAULT_TIER_MULTS: Readonly<TierMults> = Object.freeze({ good: 1, better: 1.15, best: 1.3 });
export const DEFAULT_RUNS = 0;
export const DEFAULT_LABOR_PCT = 18;
export const RUNS_MAX = 20;
export const LABOR_PCT_MAX = 60;
export const MULT_MAX = 3;
/** Typo guard on one typed labor amount, not a policy. */
export const LABOR_OVERRIDE_MAX = 10_000_000;

const round2 = (n: number) => Math.round(n * 100) / 100;

export function isWireSystem(k: unknown): k is WireSystem {
  return typeof k === "string" && (WIRE_SYSTEMS as readonly string[]).includes(k);
}

export function isLaborSystem(k: unknown): k is LaborSystem {
  return typeof k === "string" && (LABOR_SYSTEMS as readonly string[]).includes(k);
}

/** Estimating Rules id of one wire-pull knob: wire.<system>.runs | .good | .better | .best */
export function wireRateId(sys: WireSystem, field: "runs" | TierKey): string {
  return `wire.${sys}.${field}`;
}

/** Estimating Rules id of one labor knob: labor.<system>.pct | .good | .better | .best */
export function laborRateId(sys: LaborSystem, field: "pct" | TierKey): string {
  return `labor.${sys}.${field}`;
}

/**
 * The retired flat install % (a percent number, 18 = 18 %). Its Estimating
 * Rules row goes away with #232, but the stored value stays in the general
 * blob and seeds every UNSET per-system labor %, so Good-tier Quick Design
 * totals never move on deploy, whatever the admin had set it to.
 */
export const LEGACY_INSTALL_PCT_ID = "system.installPct";

/**
 * One stored rate: missing (undefined/null), non-number, negative or
 * non-finite → `def`; above `max` → capped.
 */
function readRate(get: (id: string) => unknown, id: string, def: number, max: number): number {
  const raw = get(id);
  if (raw === null || raw === undefined) return def;
  const v = typeof raw === "number" ? raw : Number.NaN;
  return Number.isFinite(v) && v >= 0 ? Math.min(v, max) : def;
}

/** The default labor % of a system with no value of its own: the stored install %, else 18. */
export function laborPctDefault(get: (id: string) => unknown): number {
  return readRate(get, LEGACY_INSTALL_PCT_ID, DEFAULT_LABOR_PCT, LABOR_PCT_MAX);
}

/**
 * The rules from stored rate values (`get(id)` → the raw stored value, or
 * undefined/null when unset). A missing, non-number, negative or non-finite
 * value is the default; a value above the rule's maximum is capped. A labor
 * % default is laborPctDefault() — the stored install %, else 18.
 */
export function wireLaborRulesFrom(get: (id: string) => unknown): WireLaborRules {
  const read = (id: string, def: number, max: number): number => readRate(get, id, def, max);
  const mults = (idOf: (t: TierKey) => string): TierMults => ({
    good: read(idOf("good"), DEFAULT_TIER_MULTS.good, MULT_MAX),
    better: read(idOf("better"), DEFAULT_TIER_MULTS.better, MULT_MAX),
    best: read(idOf("best"), DEFAULT_TIER_MULTS.best, MULT_MAX),
  });
  const wire = {} as Record<WireSystem, WireRule>;
  for (const s of WIRE_SYSTEMS) {
    wire[s] = { runs: read(wireRateId(s, "runs"), DEFAULT_RUNS, RUNS_MAX), mult: mults((t) => wireRateId(s, t)) };
  }
  const pctDef = laborPctDefault(get);
  const labor = {} as Record<LaborSystem, LaborRule>;
  for (const s of LABOR_SYSTEMS) {
    labor[s] = { pct: read(laborRateId(s, "pct"), pctDef, LABOR_PCT_MAX), mult: mults((t) => laborRateId(s, t)) };
  }
  return { wire, labor };
}

export function defaultWireLaborRules(): WireLaborRules {
  return wireLaborRulesFrom(() => undefined);
}

/** The tier's multiplier; no tier (or a junk value) → 1. */
export function tierMult(m: TierMults | undefined, tier: TierKey | null | undefined): number {
  if (!m || !tier) return 1;
  const v = m[tier];
  return typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : 1;
}

/* -------------------------------- wire pull -------------------------------- */

export const WIRE_PULL_ITEM = "wirePull";
export const WIRE_PULL_LABEL = "Wire pull";

export function wirePullKey(sys: WireSystem): string {
  return `${sys}:${WIRE_PULL_ITEM}`;
}

export type WireDimKey = "stageWidth" | "stageDepth" | "houseDepth";
export type WireDims = Partial<Record<WireDimKey, number | null>>;

const DIM_ORDER: readonly WireDimKey[] = ["stageWidth", "stageDepth", "houseDepth"];
const DIM_LABEL: Record<WireDimKey, string> = { stageWidth: "Stage width", stageDepth: "Stage depth", houseDepth: "House depth" };

/** Quick Design and the Grid intake carry a stage width and depth; neither has a house depth (it counts 0). */
export function wireDimsOf(s: { width?: number | null; depth?: number | null }): WireDims {
  return { stageWidth: s.width ?? null, stageDepth: s.depth ?? null, houseDepth: null };
}

/** One system's footage, rounded up to a whole foot, and the dimensions that counted as 0. */
export function wirePullFeet(
  dims: WireDims,
  rule: WireRule | undefined,
  tier: TierKey | null | undefined
): { feet: number; missing: WireDimKey[] } {
  const missing: WireDimKey[] = [];
  let base = 0;
  for (const k of DIM_ORDER) {
    const v = dims[k];
    if (typeof v === "number" && Number.isFinite(v) && v > 0) base += v;
    else missing.push(k);
  }
  if (!rule || !Number.isFinite(rule.runs) || !(rule.runs > 0)) return { feet: 0, missing };
  // To the thousandth first, so float noise (161.00000000000003) never buys an extra foot.
  const raw = Math.round(base * rule.runs * tierMult(rule.mult, tier) * 1000) / 1000;
  return { feet: Math.ceil(raw), missing };
}

/** "House depth not entered — counted as 0 ft", or undefined when nothing is missing. */
export function wirePullNote(missing: readonly WireDimKey[]): string | undefined {
  if (!missing.length) return undefined;
  const names = missing.map((k) => DIM_LABEL[k]);
  const list = names.length === 1 ? names[0] : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
  return `${list} not entered — counted as 0 ft`;
}

/**
 * The wire-pull step (#231) — a QUANTITY step, like scaleSets. Each wire
 * system that is on gets one "Wire pull" item (feet, no dollars) when its
 * rule yields footage, replacing any it already had. Runs between line-set
 * scaling and map pricing. A system it doesn't touch comes back as the same
 * object.
 */
export function withWirePull(
  systems: SystemBlock[],
  dims: WireDims,
  tier: TierKey | null | undefined,
  rules: WireLaborRules
): SystemBlock[] {
  return systems.map((sys) => {
    if (!isWireSystem(sys.key)) return sys;
    const key = wirePullKey(sys.key);
    const kept = sys.items.filter((it) => it.key !== key);
    const { feet, missing } = sys.on ? wirePullFeet(dims, rules.wire[sys.key], tier) : { feet: 0, missing: [] as WireDimKey[] };
    if (!(feet > 0)) return kept.length === sys.items.length ? sys : { ...sys, items: kept };
    const note = wirePullNote(missing);
    const item: BomItem = { key, desc: WIRE_PULL_LABEL, unit: "ft", qty: feet, cost: 0, price: 0, ...(note ? { note } : {}) };
    return { ...sys, items: [...kept, item] };
  });
}

/* ---------------------------------- labor ---------------------------------- */

/** labor % × the tier's multiplier, as a fraction of material. */
export function laborFrac(rule: LaborRule | undefined, tier: TierKey | null | undefined): number {
  if (!rule || !(rule.pct > 0)) return 0;
  return (rule.pct / 100) * tierMult(rule.mult, tier);
}

/** material × labor % × tier ×, to the cent. */
export function laborAmount(material: number, rule: LaborRule | undefined, tier: TierKey | null | undefined): number {
  return material > 0 ? round2(material * laborFrac(rule, tier)) : 0;
}

/** Quick Design's per-system labor fractions at one tier (tierTotals' labor argument). */
export function laborFracsFor(rules: WireLaborRules, tier: TierKey | null | undefined): Record<SysKey, number> {
  const out = {} as Record<SysKey, number>;
  for (const s of LABOR_SYSTEMS) if (s !== "general") out[s] = laborFrac(rules.labor[s], tier);
  return out;
}

/* ------------------------------ Grid labor lines ------------------------------ */

export const LABOR_SKU_PREFIX = "labor:";

export function laborSku(sys: LaborSystem): string {
  return LABOR_SKU_PREFIX + sys;
}

export function isLaborSku(sku: unknown): boolean {
  return typeof sku === "string" && sku.startsWith(LABOR_SKU_PREFIX);
}

export function laborLineDesc(sys: LaborSystem): string {
  return `Labor — ${LABOR_SYSTEM_LABEL[sys]}`;
}

/** Typed labor $ per system on one Grid option ($0 = left off the quote). */
export type LaborOverrides = Partial<Record<LaborSystem, number>>;

export function sanitizeLaborOverrides(raw: unknown): LaborOverrides {
  const out: LaborOverrides = {};
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
  for (const s of LABOR_SYSTEMS) {
    const v = (raw as Record<string, unknown>)[s];
    if (typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= LABOR_OVERRIDE_MAX) out[s] = round2(v);
  }
  return out;
}

/** Set (a number) or clear (null) one system's override. */
export function applyLaborOverride(cur: unknown, sys: LaborSystem, amount: number | null): LaborOverrides {
  const next = sanitizeLaborOverrides(cur);
  if (amount === null) delete next[sys];
  else next[sys] = round2(amount);
  return next;
}

const LAYER_TO_LABOR: Readonly<Record<string, LaborSystem>> = {
  Lighting: "lighting",
  Rigging: "rigging",
  Curtains: "curtains",
  Audio: "audio",
  Video: "video",
};

/** A Grid line's labor system: an Auto tag's scope first, then the part's Grid layer, else General. */
export function laborSystemOf(scope: string | null | undefined, layer: string | null | undefined): LaborSystem {
  if (scope && scope !== "general" && isLaborSystem(scope)) return scope;
  if (layer && Object.prototype.hasOwnProperty.call(LAYER_TO_LABOR, layer)) return LAYER_TO_LABOR[layer];
  return "general";
}

export type GridLaborLine = {
  system: LaborSystem;
  sku: string;
  desc: string;
  /** The system's priced material on this quote (sell). */
  material: number;
  pct: number;
  /** The tier multiplier applied — 1 when no tier is chosen. */
  mult: number;
  tier: TierKey | null;
  /** material × pct × mult, to the cent. */
  computed: number;
  /** What the quote carries: the typed override, else `computed`. */
  amount: number;
  overridden: boolean;
};

/** One line per system with material (or a typed override), in LABOR_SYSTEMS order. Sell numbers only. */
export function gridLaborLines(
  material: Partial<Record<LaborSystem, number>>,
  tierOf: (sys: LaborSystem) => TierKey | null,
  rules: WireLaborRules,
  overrides: LaborOverrides
): GridLaborLine[] {
  const out: GridLaborLine[] = [];
  for (const sys of LABOR_SYSTEMS) {
    const mat = round2(Math.max(0, material[sys] ?? 0));
    const ov = overrides[sys];
    if (!(mat > 0) && ov === undefined) continue;
    const rule = rules.labor[sys];
    const tier = tierOf(sys);
    const computed = laborAmount(mat, rule, tier);
    out.push({
      system: sys,
      sku: laborSku(sys),
      desc: laborLineDesc(sys),
      material: mat,
      pct: rule.pct,
      mult: tierMult(rule.mult, tier),
      tier,
      computed,
      amount: ov ?? computed,
      overridden: ov !== undefined,
    });
  }
  return out;
}
