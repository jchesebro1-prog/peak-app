/**
 * #296 — the pure rack layout engine core: placement rules, immutable edits
 * and sanitize. No React, no store/db imports — client components import it.
 *
 * Storage is always bottom-up (RU 1 = bottom); `numbering` only changes the
 * labels people read. Shelves (D575): a shelf occupies its own RU; devices on
 * it (`shelfId`) take no RU of their own; a child taller than the shelf extends
 * the shelf's occupied span upward by the difference, which must be free.
 */
import { rackFactsOf } from "./part-facts";
import {
  RACK_MAX_PLACEMENTS,
  RACK_RU_DEFAULT,
  RACK_RU_MAX,
  RACK_RU_MIN,
  RACK_WIDTHS,
  type Airflow,
  type PlacementKind,
  type PlacementOverride,
  type RackConfig,
  type RackEdit,
  type RackFace,
  type RackLayout,
  type RackPartInfo,
  type RackPartLookup,
  type RackPlacement,
  type RackWidthClass,
} from "./types";

const EPS = 1e-9;
const KINDS: readonly PlacementKind[] = ["device", "shelf", "blank", "vent", "reserved"];
const ID_RE = /^RP-[A-Z0-9-]{1,40}$/;
const LABEL_MAX = 160;
const NOTES_MAX = 200;
const SKU_MAX = 80;

/** Which rule a placement broke — validate() reports it as the issue code. */
export type PlaceFailCode = "height" | "bounds" | "sku" | "lane" | "shelf" | "overlap";
type Check = { ok: true } | { ok: false; reason: string; code: PlaceFailCode };
type Span = { lo: number; hi: number };

/* ---------- small helpers ---------- */

export function laneCountOf(width: RackWidthClass | undefined): 1 | 2 | 3 {
  return width === "half" ? 2 : width === "third" ? 3 : 1;
}

export function laneSpan(p: Pick<RackPlacement, "lane" | "laneCount">): [number, number] {
  const n = p.laneCount ?? 1;
  const l = p.lane ?? 0;
  return [l / n, (l + 1) / n];
}

export const lanesIntersect = (a: [number, number], b: [number, number]) => a[0] < b[1] - EPS && b[0] < a[1] - EPS;
const spansIntersect = (a: Span, b: Span) => a.lo <= b.hi && b.lo <= a.hi;

/** Display RU range: "RU 12" / "RU 12–13", honouring the rack's numbering (printed low→high). */
export function ruRangeLabel(config: Pick<RackConfig, "ruCount" | "numbering">, lo: number, hi: number): string {
  let a = Math.min(lo, hi);
  let b = Math.max(lo, hi);
  if (config.numbering === "top-down") [a, b] = [config.ruCount - b + 1, config.ruCount - a + 1];
  return a === b ? `RU ${a}` : `RU ${a}–${b}`;
}

const labelOf = (p: RackPlacement) => p.label || p.sku || "a reserved slot";

/** Resolved rack facts for a placement: override > catalog > unknown. */
export function placementFacts(
  p: RackPlacement,
  lookup?: RackPartLookup
): {
  depthIn?: number;
  weightLb?: number;
  powerWatts?: number;
  maxPowerWatts?: number;
  airflow?: Airflow;
  rackWidth: RackWidthClass;
  catalogRuHeight?: number;
} {
  const info = p.sku && lookup ? lookup(p.sku) : undefined;
  const cat = rackFactsOf(info);
  const o = p.override ?? {};
  const powerWatts = o.powerWatts ?? cat.powerWatts;
  return {
    depthIn: o.depthIn ?? cat.depthIn,
    weightLb: o.weightLb ?? cat.weightLb,
    powerWatts,
    maxPowerWatts:
      cat.maxPowerWatts !== undefined && powerWatts !== undefined
        ? Math.max(cat.maxPowerWatts, powerWatts)
        : (cat.maxPowerWatts ?? powerWatts),
    airflow: cat.airflow,
    rackWidth: o.rackWidth ?? cat.rackWidth ?? "full",
    catalogRuHeight: cat.ruHeight,
  };
}

/** Whole-RU height for a part: override ?? ceil(catalog ruHeight) ?? 1, min 1. */
export function heightForPart(info: RackPartInfo | undefined, override?: number): number {
  const raw =
    typeof override === "number" && Number.isFinite(override)
      ? override
      : info && typeof info.ruHeight === "number" && Number.isFinite(info.ruHeight)
        ? info.ruHeight
        : 1;
  return Math.max(1, Math.ceil(raw - EPS));
}

export function childrenOf(layout: RackLayout, shelfId: string): RackPlacement[] {
  return layout.placements.filter((p) => p.shelfId === shelfId);
}

function shelfSpan(shelf: RackPlacement, children: readonly RackPlacement[]): Span {
  const tallest = children.reduce((m, c) => Math.max(m, c.ruHeight), 0);
  return { lo: shelf.ruStart, hi: shelf.ruStart + shelf.ruHeight - 1 + Math.max(0, tallest - shelf.ruHeight) };
}

/** RU positions a placement occupies; null for shelf children; shelves extended by clearance (D575). */
export function occupiedSpan(layout: RackLayout, p: RackPlacement): Span | null {
  if (p.shelfId) return null;
  if (p.kind === "shelf") return shelfSpan(p, childrenOf(layout, p.id));
  return { lo: p.ruStart, hi: p.ruStart + p.ruHeight - 1 };
}

/* ---------- rules ---------- */

/** The RU range where two top-level placements collide (same face, spans and lanes intersect); null if they don't. */
export function overlapSpan(layout: RackLayout, a: RackPlacement, b: RackPlacement): Span | null {
  if (a.shelfId || b.shelfId || a.face !== b.face) return null;
  const as = occupiedSpan(layout, a);
  const bs = occupiedSpan(layout, b);
  if (!as || !bs || !spansIntersect(as, bs) || !lanesIntersect(laneSpan(a), laneSpan(b))) return null;
  return { lo: Math.max(as.lo, bs.lo), hi: Math.min(as.hi, bs.hi) };
}

export function canPlace(layout: RackLayout, p: RackPlacement, opts?: { ignoreId?: string }): Check {
  const { ruCount } = layout.config;
  const others = layout.placements.filter((q) => q.id !== p.id && q.id !== opts?.ignoreId);

  // 1. whole RU height
  if (!Number.isInteger(p.ruHeight) || p.ruHeight < 1) return { ok: false, reason: "Height must be a whole number of RU.", code: "height" };

  // 2. in bounds (top-level only; a shelf counts its clearance)
  if (!p.shelfId) {
    const span = occupiedSpan(layout, p)!;
    if (!Number.isInteger(p.ruStart) || span.lo < 1 || span.hi > ruCount)
      return { ok: false, reason: `Doesn't fit — the rack has ${ruCount} RU.`, code: "bounds" };
  }

  // 3. a part for every slot but reserved
  const hasSku = typeof p.sku === "string" && p.sku.trim() !== "";
  if (p.kind !== "reserved" && !hasSku) return { ok: false, reason: "Pick a part for this slot.", code: "sku" };
  if (p.kind === "reserved" && p.sku !== undefined) return { ok: false, reason: "A reserved slot has no part.", code: "sku" };

  // 6. the lane exists for this width (checked before any lane comparison)
  const n = p.laneCount ?? 1;
  const lane = p.lane ?? 0;
  if (![1, 2, 3].includes(n) || !Number.isInteger(lane) || lane < 0 || lane >= n)
    return { ok: false, reason: "That lane doesn't exist for this width.", code: "lane" };
  const myLanes = laneSpan(p);

  // 4. shelf children
  if (p.shelfId) {
    const shelf = others.find((q) => q.id === p.shelfId);
    if (!shelf || shelf.kind !== "shelf" || shelf.shelfId) return { ok: false, reason: "That shelf isn't in the rack.", code: "shelf" };
    if (p.kind === "shelf") return { ok: false, reason: "A shelf can't sit on another shelf.", code: "shelf" };
    if (layout.placements.some((q) => q.shelfId === p.id)) return { ok: false, reason: "A device on a shelf can't hold other devices.", code: "shelf" };
    const siblings = others.filter((q) => q.shelfId === shelf.id);
    if (siblings.some((s) => lanesIntersect(laneSpan(s), myLanes)))
      return { ok: false, reason: "Another device already sits there on the shelf.", code: "shelf" };
    const ext = shelfSpan(shelf, [...siblings, p]);
    if (ext.hi > ruCount) return { ok: false, reason: `Doesn't fit — the rack has ${ruCount} RU.`, code: "bounds" };
    const above = shelf.ruStart + shelf.ruHeight;
    if (ext.hi >= above) {
      const shelfLanes = laneSpan(shelf);
      const taken = new Set<number>();
      for (const q of others) {
        if (q.shelfId || q.id === shelf.id || q.face !== shelf.face || !lanesIntersect(laneSpan(q), shelfLanes)) continue;
        const qs = occupiedSpan(layout, q);
        if (!qs) continue;
        for (let ru = Math.max(qs.lo, above); ru <= Math.min(qs.hi, ext.hi); ru++) taken.add(ru);
      }
      if (taken.size) return { ok: false, reason: `Too tall for the shelf — ${taken.size} RU above it are taken.`, code: "shelf" };
    }
    return { ok: true };
  }

  // 5. overlap with other top-level placements on the same face
  for (const q of others) {
    const o = overlapSpan(layout, p, q);
    if (!o) continue;
    return { ok: false, reason: `Overlaps ${labelOf(q)} at ${ruRangeLabel(layout.config, o.lo, o.hi)}.`, code: "overlap" };
  }
  return { ok: true };
}

/* ---------- immutable edits ---------- */

const NOT_FOUND: RackEdit = { ok: false, reason: "That placement isn't in the rack." };

/** A child sits at its shelf's RU and on its shelf's face. */
function normalized(layout: RackLayout, p: RackPlacement): RackPlacement {
  const out = structuredClone(p);
  if (out.shelfId) {
    const shelf = layout.placements.find((q) => q.id === out.shelfId);
    if (shelf) {
      out.ruStart = shelf.ruStart;
      out.face = shelf.face;
    }
  }
  return out;
}

/** Replace placement `next.id` (and re-seat a shelf's children) in a fresh copy of the layout. */
function replaced(layout: RackLayout, next: RackPlacement): RackLayout {
  const out = structuredClone(layout);
  out.placements = out.placements.map((q) => {
    if (q.id === next.id) return structuredClone(next);
    if (next.kind === "shelf" && q.shelfId === next.id) return { ...q, ruStart: next.ruStart, face: next.face };
    return q;
  });
  return out;
}

function commit(layout: RackLayout, next: RackPlacement): RackEdit {
  const check = canPlace(layout, next);
  return check.ok ? { ok: true, layout: replaced(layout, next) } : check;
}

export function place(layout: RackLayout, p: RackPlacement): RackEdit {
  if (layout.placements.some((q) => q.id === p.id)) return { ok: false, reason: `Two placements share the id ${p.id}.` };
  const next = normalized(layout, p);
  const check = canPlace(layout, next);
  if (!check.ok) return check;
  const out = structuredClone(layout);
  out.placements.push(next);
  return { ok: true, layout: out };
}

export function move(layout: RackLayout, id: string, to: { ruStart?: number; face?: RackFace; lane?: 0 | 1 | 2 }): RackEdit {
  const cur = layout.placements.find((q) => q.id === id);
  if (!cur) return NOT_FOUND;
  const next = structuredClone(cur);
  if (to.lane !== undefined) next.lane = to.lane;
  if (!cur.shelfId) {
    if (to.ruStart !== undefined) next.ruStart = to.ruStart;
    if (to.face !== undefined) next.face = to.face;
  }
  return commit(layout, next);
}

export function remove(layout: RackLayout, id: string): RackEdit {
  const cur = layout.placements.find((q) => q.id === id);
  if (!cur) return NOT_FOUND;
  const kids = childrenOf(layout, id).length;
  if (kids > 0) return { ok: false, reason: `Remove the ${kids} device${kids === 1 ? "" : "s"} on this shelf first.` };
  const out = structuredClone(layout);
  out.placements = out.placements.filter((q) => q.id !== id);
  return { ok: true, layout: out };
}

export function resize(layout: RackLayout, id: string, ruHeight: number): RackEdit {
  const cur = layout.placements.find((q) => q.id === id);
  if (!cur) return NOT_FOUND;
  return commit(layout, { ...structuredClone(cur), ruHeight });
}

type Patchable = "optional" | "override" | "costOverride" | "notes" | "label" | "lane" | "laneCount" | "face" | "sku";
const PATCHABLE: ReadonlySet<string> = new Set<Patchable>(["optional", "override", "costOverride", "notes", "label", "lane", "laneCount", "face", "sku"]);

/** Patch fields; a key present with `undefined` clears it. A child's face stays its shelf's. */
export function update(layout: RackLayout, id: string, patch: Partial<Pick<RackPlacement, Patchable>>): RackEdit {
  const cur = layout.placements.find((q) => q.id === id);
  if (!cur) return NOT_FOUND;
  const next = structuredClone(cur) as Record<string, unknown>;
  for (const [k, v] of Object.entries(structuredClone(patch))) {
    if (!PATCHABLE.has(k)) continue; // id, kind, shelfId, ruStart, ruHeight never change here
    if (v === undefined) delete next[k];
    else next[k] = v;
  }
  return commit(layout, normalized(layout, next as RackPlacement));
}

export function newPlacementId(now: number, seq: number): string {
  return "RP-" + now.toString(36).toUpperCase() + seq.toString(36).toUpperCase();
}

export function emptyRackLayout(ruCount: number = RACK_RU_DEFAULT): RackLayout {
  return { config: { ruCount, widthIn: 19, numbering: "bottom-up" }, placements: [] };
}

/* ---------- sanitize ---------- */

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const cleanStr = (v: unknown, max: number): string | undefined => {
  if (typeof v !== "string") return undefined;
  const s = v.trim().slice(0, max);
  return s || undefined;
};

function cleanOverride(v: unknown): PlacementOverride | undefined {
  if (!isObj(v)) return undefined;
  const o: PlacementOverride = {};
  if (finite(v.ruHeight) && Number.isInteger(v.ruHeight) && v.ruHeight >= 1) o.ruHeight = v.ruHeight;
  if (finite(v.depthIn) && v.depthIn >= 0) o.depthIn = v.depthIn;
  if (finite(v.weightLb) && v.weightLb >= 0) o.weightLb = v.weightLb;
  if (finite(v.powerWatts) && v.powerWatts >= 0) o.powerWatts = v.powerWatts;
  if (typeof v.rackWidth === "string" && (RACK_WIDTHS as readonly string[]).includes(v.rackWidth)) o.rackWidth = v.rackWidth as RackWidthClass;
  return Object.keys(o).length ? o : undefined;
}

function cleanPlacement(v: unknown, i: number): { ok: true; value: RackPlacement } | { ok: false; error: string } {
  if (!isObj(v)) return { ok: false, error: `Placement ${i + 1} isn't a placement.` };
  const id = typeof v.id === "string" ? v.id.trim() : "";
  if (!ID_RE.test(id)) return { ok: false, error: `Placement ${i + 1} has an invalid id.` };
  const bad = (field: string) => ({ ok: false as const, error: `Placement ${id} has an invalid ${field}.` });
  if (typeof v.kind !== "string" || !KINDS.includes(v.kind as PlacementKind)) return bad("kind");
  if (!finite(v.ruStart)) return bad("RU start");
  if (!finite(v.ruHeight)) return bad("RU height");
  if (v.face !== "front" && v.face !== "rear") return bad("face");
  if (v.lane !== undefined && v.lane !== 0 && v.lane !== 1 && v.lane !== 2) return bad("lane");
  if (v.laneCount !== undefined && v.laneCount !== 1 && v.laneCount !== 2 && v.laneCount !== 3) return bad("lane count");
  let shelfId: string | undefined;
  if (v.shelfId !== undefined) {
    shelfId = typeof v.shelfId === "string" ? v.shelfId.trim() : "";
    if (!ID_RE.test(shelfId)) return bad("shelf");
  }
  // Fixed key order keeps a second pass byte-identical.
  const p: RackPlacement = { id, kind: v.kind as PlacementKind, ruStart: v.ruStart, ruHeight: v.ruHeight, face: v.face };
  const sku = cleanStr(v.sku, SKU_MAX);
  if (sku) p.sku = sku;
  const label = cleanStr(v.label, LABEL_MAX);
  if (label) p.label = label;
  if (v.lane !== undefined) p.lane = v.lane;
  if (v.laneCount !== undefined) p.laneCount = v.laneCount;
  if (shelfId) p.shelfId = shelfId;
  if (v.optional === true) p.optional = true;
  const override = cleanOverride(v.override);
  if (override) p.override = override;
  if (finite(v.costOverride) && v.costOverride >= 0) p.costOverride = v.costOverride;
  const notes = cleanStr(v.notes, NOTES_MAX);
  if (notes) p.notes = notes;
  return { ok: true, value: p };
}

export function sanitizeRackLayout(input: unknown): { ok: true; value: RackLayout } | { ok: false; error: string } {
  if (!isObj(input) || !isObj(input.config) || !Array.isArray(input.placements)) return { ok: false, error: "That isn't a rack layout." };
  const c = input.config;

  const placements: RackPlacement[] = [];
  for (let i = 0; i < input.placements.length; i++) {
    const r = cleanPlacement(input.placements[i], i);
    if (!r.ok) return r;
    placements.push(r.value);
  }
  const seen = new Set<string>();
  for (const p of placements) {
    if (seen.has(p.id)) return { ok: false, error: `Two placements share the id ${p.id}.` };
    seen.add(p.id);
  }
  if (!finite(c.ruCount) || !Number.isInteger(c.ruCount) || c.ruCount < RACK_RU_MIN || c.ruCount > RACK_RU_MAX)
    return { ok: false, error: `A rack has ${RACK_RU_MIN}–${RACK_RU_MAX} RU.` };
  if (placements.length > RACK_MAX_PLACEMENTS) return { ok: false, error: `A rack can hold at most ${RACK_MAX_PLACEMENTS} placements.` };

  const config: RackConfig = {
    ruCount: c.ruCount,
    widthIn: c.widthIn === 23 ? 23 : 19,
    ...(finite(c.depthIn) && c.depthIn > 0 ? { depthIn: c.depthIn } : {}),
    numbering: c.numbering === "top-down" ? "top-down" : "bottom-up",
  };

  // Children sit at their shelf's RU and face.
  const byId = new Map(placements.map((p) => [p.id, p]));
  for (const p of placements) {
    const shelf = p.shelfId ? byId.get(p.shelfId) : undefined;
    if (shelf && !shelf.shelfId) {
      p.ruStart = shelf.ruStart;
      p.face = shelf.face;
    }
  }
  const layout: RackLayout = { config, placements };

  // Top-level first, then children (each after its shelf).
  const order = [...placements.filter((p) => !p.shelfId), ...placements.filter((p) => p.shelfId)];
  for (const p of order) {
    const r = canPlace(layout, p);
    if (!r.ok) {
      const span = occupiedSpan(layout, p) ?? { lo: p.ruStart, hi: p.ruStart };
      const lead = p.label || p.sku || "A reserved slot";
      return { ok: false, error: `${lead} (${ruRangeLabel(config, span.lo, span.hi)}, ${p.face}): ${r.reason}` };
    }
  }
  return { ok: true, value: layout };
}
