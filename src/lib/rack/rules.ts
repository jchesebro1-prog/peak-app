/**
 * #296 — the rest of the pure rack engine: first fit, blank fill, validation
 * and totals. No React, no store/db imports — client components import it.
 * Geometry is never re-derived here: spans, lanes and the placement rules all
 * come from `layout.ts` (`occupiedSpan`, `laneSpan`, `canPlace`, `overlapSpan`).
 *
 * Absent = unknown, never zero (D576 aside: blank/vent/shelf watts read 0 W).
 */
import { canPlace, heightForPart, laneCountOf, lanesIntersect, laneSpan, occupiedSpan, overlapSpan, place, placementFacts, resize, ruRangeLabel, update } from "./layout";
import { rackFactsOf } from "./part-facts";
import {
  BTU_PER_WATT,
  CIRCUIT_VOLTS,
  HEAT_WATTS_PER_WINDOW,
  HEAT_WINDOW_RU,
  RACK_MAX_PLACEMENTS,
  type PlacementOverride,
  type RackConfig,
  type RackDataField,
  type RackEdit,
  type RackFace,
  type RackIssue,
  type RackLayout,
  type RackMissing,
  type RackPartLookup,
  type RackPlacement,
  type RackTotals,
  type RackWidthClass,
} from "./types";

export { ruRangeLabel };

type Span = { lo: number; hi: number };

const round1 = (n: number) => Math.round(n * 10) / 10;
const fmt = (n: number) => round1(n).toLocaleString("en-US", { maximumFractionDigits: 1 });
const lanesTouch = (a: RackPlacement, b: RackPlacement) => lanesIntersect(laneSpan(a), laneSpan(b));

/** Display number of a stored (bottom-up) RU. */
export function ruLabel(config: Pick<RackConfig, "ruCount" | "numbering">, ru: number): number {
  return config.numbering === "top-down" ? config.ruCount - ru + 1 : ru;
}

/** Lowest free ruStart for a part of this height on this face, then the lowest free lane. */
export function firstFit(
  layout: RackLayout,
  ruHeight: number,
  face: RackFace,
  width?: RackWidthClass
): { ruStart: number; lane: 0 | 1 | 2 } | null {
  const n = laneCountOf(width);
  for (let ruStart = 1; ruStart + ruHeight - 1 <= layout.config.ruCount; ruStart++) {
    for (let lane = 0; lane < n; lane++) {
      const probe: RackPlacement = {
        id: "\u0000first-fit",
        kind: "reserved",
        ruStart,
        ruHeight,
        face,
        ...(n > 1 ? { lane: lane as 0 | 1 | 2, laneCount: n } : {}),
      };
      if (canPlace(layout, probe).ok) return { ruStart, lane: lane as 0 | 1 | 2 };
    }
  }
  return null;
}

/** The width class a placement's lane count stands for (firstFit's `width`). */
const widthOfLanes = (n: RackPlacement["laneCount"]): RackWidthClass | undefined => (n === 2 ? "half" : n === 3 ? "third" : undefined);

/**
 * Up to `count` copies of a placement, each at `firstFit` for its height, face
 * and width — one edit, so one undo. Copies keep sku, label, optional and
 * overrides; a shelf's devices are not copied, and a device copied off a shelf
 * lands in the rack itself. `placed` says how many fit.
 */
export function duplicatePlacement(
  layout: RackLayout,
  id: string,
  count: number,
  newId: () => string
): ({ ok: true; layout: RackLayout } | { ok: false; reason: string }) & { placed: number } {
  const cur = layout.placements.find((q) => q.id === id);
  if (!cur) return { ok: false, reason: "That placement isn't in the rack.", placed: 0 };
  const want = Math.max(1, Math.min(RACK_MAX_PLACEMENTS, Math.floor(Number.isFinite(count) ? count : 1)));
  const width = widthOfLanes(cur.laneCount);
  let out = layout;
  let placed = 0;
  for (let i = 0; i < want && out.placements.length < RACK_MAX_PLACEMENTS; i++) {
    const fit = firstFit(out, cur.ruHeight, cur.face, width);
    if (!fit) break;
    const copy: RackPlacement = {
      id: newId(),
      kind: cur.kind,
      ruStart: fit.ruStart,
      ruHeight: cur.ruHeight,
      face: cur.face,
      ...(cur.sku !== undefined ? { sku: cur.sku } : {}),
      ...(cur.label ? { label: cur.label } : {}),
      ...(width ? { lane: fit.lane, laneCount: cur.laneCount } : {}),
      ...(cur.optional ? { optional: true } : {}),
      ...(cur.override ? { override: structuredClone(cur.override) } : {}),
    };
    const r = place(out, copy);
    if (!r.ok) break;
    out = r.layout;
    placed++;
  }
  if (placed === 0) {
    const reason = layout.placements.length >= RACK_MAX_PLACEMENTS ? `A rack can hold at most ${RACK_MAX_PLACEMENTS} placements.` : "No room for a copy — the rack is full.";
    return { ok: false, reason, placed };
  }
  return { ok: true, layout: out, placed };
}

export type OverrideNumberKey = "ruHeight" | "depthIn" | "weightLb" | "powerWatts";

/**
 * Set (a number) or clear (`undefined`) one numeric override. A height override
 * re-resolves the placement's RU height (override > catalog > 1) and is refused
 * if it no longer fits; clearing the last override drops the override object.
 * A slot without a part (reserved) has no catalog height: its height is set directly.
 */
export function setPlacementOverride(
  layout: RackLayout,
  id: string,
  key: OverrideNumberKey,
  value: number | undefined,
  lookup?: RackPartLookup
): RackEdit {
  const cur = layout.placements.find((q) => q.id === id);
  if (!cur) return { ok: false, reason: "That placement isn't in the rack." };
  if (value !== undefined) {
    if (!Number.isFinite(value) || value < 0) return { ok: false, reason: "Enter a number of 0 or more." };
    if (key === "ruHeight" && (!Number.isInteger(value) || value < 1)) return { ok: false, reason: "Height must be a whole number of RU." };
  }
  if (key === "ruHeight" && !cur.sku) return value === undefined ? { ok: true, layout } : resize(layout, id, value);
  const ov: PlacementOverride = { ...(cur.override ?? {}) };
  if (value === undefined) delete ov[key];
  else ov[key] = value;
  const patched = update(layout, id, { override: Object.keys(ov).length ? ov : undefined });
  if (!patched.ok || key !== "ruHeight") return patched;
  return resize(patched.layout, id, heightForPart(cur.sku ? lookup?.(cur.sku) : undefined, ov.ruHeight));
}

/** RU positions (1..ruCount) covered on one face by top-level placements passing `keep`. */
function coveredRus(layout: RackLayout, face: RackFace | "any", keep: (p: RackPlacement) => boolean): Set<number> {
  const out = new Set<number>();
  for (const p of layout.placements) {
    if (p.shelfId || (face !== "any" && p.face !== face) || !keep(p)) continue;
    const s = occupiedSpan(layout, p);
    if (!s) continue;
    for (let ru = Math.max(1, s.lo); ru <= Math.min(layout.config.ruCount, s.hi); ru++) out.add(ru);
  }
  return out;
}

/** One full-width 1U front blank in every RU nothing covers on the front (reserved counts as covered). */
export function autoFillBlanks(layout: RackLayout, blankSku: string, newId: (i: number) => string): RackLayout {
  const out = structuredClone(layout);
  const covered = coveredRus(layout, "front", () => true);
  let i = 0;
  for (let ru = 1; ru <= layout.config.ruCount; ru++) {
    if (covered.has(ru)) continue;
    out.placements.push({ id: newId(i++), kind: "blank", sku: blankSku, ruStart: ru, ruHeight: 1, face: "front" });
  }
  return out;
}

/* ---------- validate ---------- */

type Ordered = RackIssue & { ru: number };

function labeler(lookup?: RackPartLookup) {
  return (p: RackPlacement): string => {
    const desc = p.sku && lookup ? lookup(p.sku)?.desc : undefined;
    return p.label || desc || p.sku || "Reserved slot";
  };
}

/** Where a placement sits: its own span, or its shelf's for a child. */
function spanOf(layout: RackLayout, p: RackPlacement): Span {
  if (p.shelfId) {
    const shelf = layout.placements.find((q) => q.id === p.shelfId);
    const s = shelf ? occupiedSpan(layout, shelf) : null;
    return s ?? { lo: p.ruStart, hi: p.ruStart };
  }
  return occupiedSpan(layout, p) ?? { lo: p.ruStart, hi: p.ruStart };
}

/** Only a resolved `found: false` is "not in the catalog"; undefined means not loaded yet. */
const isUnknownSku = (sku: string, lookup: RackPartLookup) => lookup(sku)?.found === false;

export function validate(layout: RackLayout, lookup?: RackPartLookup): RackIssue[] {
  const { config, placements } = layout;
  const label = labeler(lookup);
  const issues: Ordered[] = [];
  const add = (level: RackIssue["level"], code: string, ps: readonly RackPlacement[], message: string, ru: number) =>
    issues.push({ level, code, placementIds: ps.map((p) => p.id), message, ru });
  const where = (p: RackPlacement) => {
    const s = spanOf(layout, p);
    return `${label(p)} (${ruRangeLabel(config, s.lo, s.hi)}, ${p.face})`;
  };

  // Geometry errors: canPlace against the rest, each physical problem once.
  // Overlaps and children sharing a shelf spot are reported per pair; a child
  // too tall for its shelf extends the shelf's span (D575), so its clearance or
  // bounds failure is reported on the shelf unless the shelf side stays silent.
  const byId = new Map(placements.map((p) => [p.id, p]));
  const shelfOverlaps = (shelf?: RackPlacement) => !!shelf && placements.some((q) => q !== shelf && overlapSpan(layout, shelf, q));
  const shelfOutOfBounds = (shelf?: RackPlacement) => {
    const r = shelf ? canPlace(layout, shelf) : { ok: true as const };
    return !r.ok && r.code === "bounds";
  };
  for (const p of placements) {
    const r = canPlace(layout, p);
    if (r.ok || r.code === "overlap" || r.code === "shelf-sibling") continue;
    const shelf = p.shelfId ? byId.get(p.shelfId) : undefined;
    if (r.code === "shelf-clearance" && shelfOverlaps(shelf)) continue;
    if (r.code === "shelf-bounds" && shelfOutOfBounds(shelf)) continue;
    const code = r.code === "shelf-bounds" ? "bounds" : r.code === "shelf-clearance" || r.code === "shelf-width" ? "shelf" : r.code;
    add("error", code, [p], `${where(p)}: ${r.reason}`, spanOf(layout, p).lo);
  }
  for (let i = 0; i < placements.length; i++)
    for (let j = i + 1; j < placements.length; j++) {
      const [a, b] = [placements[i], placements[j]];
      const o = overlapSpan(layout, a, b);
      if (o) add("error", "overlap", [a, b], `${where(a)}: Overlaps ${label(b)} at ${ruRangeLabel(config, o.lo, o.hi)}.`, o.lo);
      if (a.shelfId && a.shelfId === b.shelfId && lanesTouch(a, b))
        add("error", "shelf", [a, b], `${where(a)}: ${label(b)} already sits there on the shelf.`, spanOf(layout, a).lo);
    }

  // Catalog-driven warnings.
  if (lookup) {
    const seen = new Set<string>();
    for (const p of placements) {
      if (!p.sku || seen.has(p.sku) || !isUnknownSku(p.sku, lookup)) continue;
      seen.add(p.sku);
      const same = placements.filter((q) => q.sku === p.sku);
      add("warning", "unknown-sku", same, `${p.sku} isn't in the catalog — it prices at $0 unless overridden.`, Math.min(...same.map((q) => spanOf(layout, q).lo)));
    }
    for (const p of placements) {
      if (!p.sku) continue;
      const cat = placementFacts(p, lookup).catalogRuHeight;
      const ru = spanOf(layout, p).lo;
      if (cat === undefined) {
        if (p.shelfId && p.override?.ruHeight === undefined)
          add("warning", "shelf-unknown-height", [p], `${label(p)} has no RU height — the shelf's clearance assumes ${p.ruHeight} RU.`, ru);
        continue;
      }
      if (p.override?.ruHeight !== undefined) continue;
      const whole = Math.ceil(cat - 1e-9);
      if (whole !== p.ruHeight) add("warning", "height-mismatch", [p], `${label(p)}: the catalog says ${whole} RU.`, ru);
      if (!Number.isInteger(cat)) add("warning", "half-ru", [p], `${label(p)} is ${cat} RU — laid out as ${whole} RU.`, ru);
    }
  }

  // 19 in gear in a 23 in rack.
  if (config.widthIn === 23) {
    const gear = placements.filter((p) => p.kind === "device" && !p.shelfId && placementFacts(p, lookup).rackWidth !== "23in");
    if (gear.length) add("warning", "width-23", gear, "19 in gear in a 23 in rack needs adapters.", Math.min(...gear.map((p) => spanOf(layout, p).lo)));
  }

  // Depth: deeper than the rack; front + rear clash.
  const D = config.depthIn;
  if (D !== undefined) {
    for (const p of placements) {
      const d = p.sku ? placementFacts(p, lookup).depthIn : undefined;
      if (d !== undefined && d > D) add("warning", "depth", [p], `${label(p)} is deeper (${fmt(d)} in) than the rack (${fmt(D)} in).`, spanOf(layout, p).lo);
    }
    const top = placements.filter((p) => !p.shelfId && p.sku);
    for (const a of top.filter((p) => p.face === "front"))
      for (const b of top.filter((p) => p.face === "rear")) {
        const da = placementFacts(a, lookup).depthIn;
        const db = placementFacts(b, lookup).depthIn;
        if (da === undefined || db === undefined || da + db <= D) continue;
        const sa = occupiedSpan(layout, a)!;
        const sb = occupiedSpan(layout, b)!;
        if (sa.lo > sb.hi || sb.lo > sa.hi) continue;
        const lo = Math.max(sa.lo, sb.lo);
        add("warning", "depth", [a, b], `${label(a)} and ${label(b)} clash in depth at ${ruRangeLabel(config, lo, Math.min(sa.hi, sb.hi))} (${fmt(da + db)} in of ${fmt(D)} in).`, lo);
      }
  }

  // Airflow: touching front-face devices pushing air at each other.
  const fronts = placements.filter((p) => p.kind === "device" && !p.shelfId && p.face === "front");
  const opposed = (x?: string, y?: string) => x === "front-to-rear" && (y === "rear-to-front" || y === "side");
  for (const a of fronts)
    for (const b of fronts) {
      const sa = occupiedSpan(layout, a)!;
      const sb = occupiedSpan(layout, b)!;
      if (sa.hi + 1 !== sb.lo || !lanesTouch(a, b)) continue;
      const fa = placementFacts(a, lookup).airflow;
      const fb = placementFacts(b, lookup).airflow;
      if (!fa || !fb || !(opposed(fa, fb) || opposed(fb, fa))) continue;
      add("warning", "airflow", [a, b], `${label(a)} and ${label(b)} move air in opposite directions with nothing between them.`, sa.lo);
    }

  // Heat: > HEAT_WATTS_PER_WINDOW in any HEAT_WINDOW_RU window (both faces) with no vent in it.
  const heaters = placements
    .filter((p) => p.kind !== "reserved" && !p.optional && p.sku)
    .map((p) => ({ p, s: spanOf(layout, p), w: placementFacts(p, lookup).powerWatts ?? 0 }))
    .filter((h) => h.w > 0);
  const vents = placements.filter((p) => p.kind === "vent" && !p.shelfId).map((p) => occupiedSpan(layout, p)!);
  const win = Math.min(HEAT_WINDOW_RU, config.ruCount);
  const hits = (s: Span, lo: number, hi: number) => s.lo <= hi && lo <= s.hi;
  // Hot windows merge by RU range (overlapping ranges become one warning).
  const runs: { lo: number; hi: number; max: number }[] = [];
  for (let s = 1; s + win - 1 <= config.ruCount; s++) {
    const e = s + win - 1;
    const sum = heaters.reduce((t, h) => (hits(h.s, s, e) ? t + h.w : t), 0);
    if (sum <= HEAT_WATTS_PER_WINDOW || vents.some((v) => hits(v, s, e))) continue;
    const last = runs[runs.length - 1];
    if (last && s <= last.hi) {
      last.hi = Math.max(last.hi, e);
      last.max = Math.max(last.max, sum);
    } else runs.push({ lo: s, hi: e, max: sum });
  }
  for (const r of runs) {
    const hs = heaters.filter((h) => hits(h.s, r.lo, r.hi));
    // Print only the RU the contributing heaters actually occupy.
    const lo = Math.max(r.lo, Math.min(...hs.map((h) => h.s.lo)));
    const hi = Math.min(r.hi, Math.max(...hs.map((h) => h.s.hi)));
    add("warning", "heat", hs.map((h) => h.p), `${fmt(r.max)} W in ${ruRangeLabel(config, lo, hi)} with no vent panel.`, lo);
  }

  // D574: the Estimator offers optional per part, not per placement.
  const skus = [...new Set(placements.filter((p) => p.sku).map((p) => p.sku!))];
  for (const sku of skus) {
    const same = placements.filter((p) => p.sku === sku);
    const n = same.filter((p) => p.optional).length;
    if (n === 0 || n === same.length) continue;
    add("warning", "optional-mixed", same, `${sku}: the Estimator offers optional add-ons per part — ${n} optional of ${same.length} placed will not show as a separate add-on.`, Math.min(...same.map((p) => spanOf(layout, p).lo)));
  }

  const rank = (i: Ordered) => (i.level === "error" ? 0 : 1);
  return issues
    .map((i, k) => ({ i, k }))
    .sort((x, y) => rank(x.i) - rank(y.i) || x.i.ru - y.i.ru || x.k - y.k)
    .map(({ i }) => ({ level: i.level, code: i.code, placementIds: i.placementIds, message: i.message }));
}

/* ---------- totals ---------- */

const PASSIVE = new Set(["blank", "vent", "shelf"]);

export function totals(
  layout: RackLayout,
  lookup: RackPartLookup,
  rackParts?: ReadonlyArray<{ sku: string; qty: number }>
): RackTotals {
  const { config, placements } = layout;
  const label = labeler(lookup);

  const real = (p: RackPlacement) => p.kind !== "reserved";
  const used = coveredRus(layout, "any", real);
  const reserved = coveredRus(layout, "any", (p) => p.kind === "reserved");
  const ruReserved = [...reserved].filter((ru) => !used.has(ru)).length;
  const byFace = { front: coveredRus(layout, "front", real).size, rear: coveredRus(layout, "rear", real).size };

  const inc = { weightLb: 0, watts: 0, maxWatts: 0 };
  const all = { weightLb: 0, watts: 0, maxWatts: 0 };
  let capacity: number | null = null;
  const missing = new Map<string, { label: string; fields: Set<RackDataField> }>();
  const flag = (sku: string, lbl: string, f: RackDataField) => {
    const row = missing.get(sku) ?? { label: lbl, fields: new Set<RackDataField>() };
    row.fields.add(f);
    missing.set(sku, row);
  };
  const addUp = (optional: boolean, qty: number, weightLb = 0, watts = 0, maxWatts = 0) => {
    for (const t of optional ? [all] : [inc, all]) {
      t.weightLb += weightLb * qty;
      t.watts += watts * qty;
      t.maxWatts += maxWatts * qty;
    }
  };

  // Top → bottom so missingData lists parts in the order people read the rack.
  const order = placements
    .map((p, k) => ({ p, k, s: spanOf(layout, p) }))
    .sort((a, b) => b.s.hi - a.s.hi || (a.p.face === b.p.face ? 0 : a.p.face === "front" ? -1 : 1) || a.k - b.k);
  for (const { p } of order) {
    if (!p.sku || !real(p)) continue;
    const f = placementFacts(p, lookup);
    const passive = PASSIVE.has(p.kind);
    const panel = p.kind === "blank" || p.kind === "vent"; // a panel's height and depth don't matter
    const lbl = label(p);
    if (!panel && f.catalogRuHeight === undefined && p.override?.ruHeight === undefined) flag(p.sku, lbl, "ruHeight");
    if (!panel && f.depthIn === undefined) flag(p.sku, lbl, "depthIn");
    if (f.weightLb === undefined) flag(p.sku, lbl, "weightLb");
    if (f.powerWatts === undefined && !passive) flag(p.sku, lbl, "powerWatts");
    addUp(!!p.optional, 1, f.weightLb, f.powerWatts, f.maxPowerWatts);
    const cap = rackFactsOf(lookup(p.sku)).powerCapacityWatts;
    if (cap !== undefined && !p.optional) capacity = (capacity ?? 0) + cap;
  }
  for (const { sku, qty } of rackParts ?? []) {
    const info = lookup(sku);
    const f = rackFactsOf(info);
    const lbl = info?.desc || sku;
    if (f.weightLb === undefined) flag(sku, lbl, "weightLb");
    if (f.powerWatts === undefined) flag(sku, lbl, "powerWatts");
    const max = f.maxPowerWatts !== undefined && f.powerWatts !== undefined ? Math.max(f.maxPowerWatts, f.powerWatts) : (f.maxPowerWatts ?? f.powerWatts);
    addUp(false, qty, f.weightLb, f.powerWatts, max);
    if (f.powerCapacityWatts !== undefined) capacity = (capacity ?? 0) + f.powerCapacityWatts * qty;
  }

  const FIELD_ORDER: readonly RackDataField[] = ["ruHeight", "depthIn", "weightLb", "powerWatts"];
  const missingData: RackMissing[] = [...missing].map(([sku, r]) => ({ sku, label: r.label, fields: FIELD_ORDER.filter((f) => r.fields.has(f)) }));

  return {
    ruCount: config.ruCount,
    ruUsed: used.size,
    ruReserved,
    ruFree: config.ruCount - used.size - ruReserved,
    weightLb: round1(inc.weightLb),
    watts: round1(inc.watts),
    maxWatts: round1(inc.maxWatts),
    btuHr: Math.round(inc.watts * BTU_PER_WATT),
    amps: round1(inc.watts / CIRCUIT_VOLTS),
    withOptions: {
      weightLb: round1(all.weightLb),
      watts: round1(all.watts),
      maxWatts: round1(all.maxWatts),
      btuHr: Math.round(all.watts * BTU_PER_WATT),
    },
    capacityWatts: capacity === null ? null : round1(capacity),
    byFace,
    missingData,
    unknownWatts: missingData.filter((m) => m.fields.includes("powerWatts")).length,
    unknownWeight: missingData.filter((m) => m.fields.includes("weightLb")).length,
  };
}
