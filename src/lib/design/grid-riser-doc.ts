/**
 * The Grid — editable riser document (drawing set spec 2026-09-25 §4, #GDS).
 *
 * Devices, spaces and wire runs stay DERIVED from the plan (riserGraph,
 * D112) — the riser can never drift from the layout. This document holds
 * only what the plan cannot know, per option: where each node sits, level
 * lines, conduit annotations (never priced), riser notes, and RiserLinks —
 * typed-length cable runs between things that are not on one calibrated
 * page, priced through routeLines exactly like a wire route.
 *
 * Coordinates are normalized 0..1 against a RISER_W × RISER_H canvas (y may
 * run past 1 when the riser grows downward). Pure and dependency-free (the
 * grid-bom rule): the store, the riser page, the client riser editor and the
 * harness all import it.
 */

import type { Point } from "@/lib/annotations";
import { pointInPolygon, polygonCentroid, spaceOf, type SpaceLite } from "./grid-geometry";
import type { RiserGraph, RiserGroup } from "./grid-riser";

export const RISER_W = 1000;
export const RISER_H = 620;
/** Node header and device-row heights, in canvas units. */
export const NODE_HEAD = 24;
export const NODE_ROW = 16;
/** The node key for devices and ends that sit in no space. */
export const UNASSIGNED_KEY = "unassigned";

export type EndRef = { kind: "space"; spaceId: string | null } | { kind: "placement"; placementId: string };
export type RiserNodeBox = { x: number; y: number; w: number; h: number };
export type RiserLevel = { id: string; label: string; elevation?: string; y: number };
export type RiserConduit = { id: string; from: EndRef; to: EndRef; label: string; points?: Point[] };
export type RiserNote = { id: string; n: number; text: string };
export type RiserLink = { id: string; from: EndRef; to: EndRef; partId: string; lengthFt: number; by: string; at: number };
export type RiserDoc = {
  /** Keyed by space id, or UNASSIGNED_KEY. */
  nodes: Record<string, RiserNodeBox>;
  levels: RiserLevel[];
  conduits: RiserConduit[];
  notes: RiserNote[];
  links: RiserLink[];
};

export type RiserIdPrefix = "lv-" | "cd-" | "nt-" | "lk-";

export const RISER_OP_NAMES = [
  "moveNode", "addLevel", "updateLevel", "removeLevel", "addConduit", "updateConduit", "removeConduit",
  "addNote", "updateNote", "removeNote", "removeLink",
] as const;

export type RiserOp =
  | { op: "moveNode"; key: string; box: RiserNodeBox }
  | { op: "addLevel"; label: string; elevation?: string; y: number }
  | { op: "updateLevel"; id: string; label?: string; elevation?: string; y?: number }
  | { op: "removeLevel"; id: string }
  | { op: "addConduit"; from: EndRef; to: EndRef; label: string }
  | { op: "updateConduit"; id: string; label: string }
  | { op: "removeConduit"; id: string }
  | { op: "addNote"; text: string }
  | { op: "updateNote"; id: string; text: string }
  | { op: "removeNote"; id: string }
  | { op: "removeLink"; id: string };

const LABEL_MAX = 60;
const ELEVATION_MAX = 30;
const NOTE_MAX = 500;
const MIN_W = 0.1;
const MIN_H = 0.06;
/** How far down a riser may grow, in canvas heights. */
const MAX_Y = 3;
/** Longest an id may be once canonicalized (review I1) — generous for any
 *  real `gp-`/`sp-`/`lk-`… id, small enough to cap a forged one. */
const ID_MAX = 100;
/** Per-option document caps (review M3) — generous for any real design,
 *  bounded so a corrupt or hostile document can't grow without limit.
 *  normalizeRiserDoc enforces these on every read; patchRiser/addRiserLink
 *  refuse an op that would cross one on write. */
export const MAX_LEVELS = 50;
export const MAX_CONDUITS = 500;
export const MAX_NOTES = 100;
export const MAX_LINKS = 1000;

const r3 = (v: number) => Math.round(v * 1000) / 1000;
const r4 = (v: number) => Math.round(v * 10000) / 10000;
const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);
const text = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const capId = (v: string) => v.slice(0, ID_MAX);

export function emptyRiserDoc(): RiserDoc {
  return { nodes: {}, levels: [], conduits: [], notes: [], links: [] };
}

export function isEndRef(v: unknown): v is EndRef {
  if (!v || typeof v !== "object") return false;
  const e = v as { kind?: unknown; spaceId?: unknown; placementId?: unknown };
  if (e.kind === "space") return e.spaceId === null || (typeof e.spaceId === "string" && e.spaceId.length > 0);
  if (e.kind === "placement") return typeof e.placementId === "string" && e.placementId.length > 0;
  return false;
}

export function sameEnd(a: EndRef, b: EndRef): boolean {
  if (a.kind === "space" && b.kind === "space") return a.spaceId === b.spaceId;
  if (a.kind === "placement" && b.kind === "placement") return a.placementId === b.placementId;
  return false;
}

/**
 * Canonicalize a client- or storage-supplied end reference into a FRESH
 * object holding only the valid shape's own fields, ids length-capped
 * (review I1). Never the raw value — which may carry extra properties, or a
 * `__proto__`/`constructor` key — and never trusted against the project
 * until the caller checks it actually lives there (see grid-riser.ts's
 * `liveEnd`, shared by `addRiserLink` and `patchRiser`'s `addConduit`).
 */
export function toEndRef(v: unknown): EndRef | null {
  if (!isEndRef(v)) return null;
  const e = v as { kind: "space" | "placement"; spaceId?: string | null; placementId?: string };
  return e.kind === "space"
    ? { kind: "space", spaceId: e.spaceId === null ? null : capId(e.spaceId as string) }
    : { kind: "placement", placementId: capId(e.placementId as string) };
}

function isBox(v: unknown): v is RiserNodeBox {
  if (!v || typeof v !== "object") return false;
  const b = v as Record<string, unknown>;
  return [b.x, b.y, b.w, b.h].every((n) => typeof n === "number" && Number.isFinite(n));
}

const isStr = (v: unknown): v is string => typeof v === "string";
const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/** Rebuild a stored level as a fresh object of only its own fields — never
 *  a blind cast of whatever the raw record happened to carry. */
function cleanLevel(raw: Record<string, unknown>): RiserLevel | null {
  if (!isStr(raw.id) || !isStr(raw.label) || !isNum(raw.y)) return null;
  const level: RiserLevel = { id: capId(raw.id), label: text(raw.label, LABEL_MAX), y: raw.y };
  if (isStr(raw.elevation) && raw.elevation.trim()) level.elevation = text(raw.elevation, ELEVATION_MAX);
  return level;
}

/** Same rebuild for a conduit — its ends go through `toEndRef` so a forged
 *  or extra-property end never survives a read (review I1). */
function cleanConduit(raw: Record<string, unknown>): RiserConduit | null {
  const from = toEndRef(raw.from);
  const to = toEndRef(raw.to);
  if (!isStr(raw.id) || !isStr(raw.label) || !from || !to) return null;
  return { id: capId(raw.id), from, to, label: text(raw.label, LABEL_MAX) };
}

function cleanNote(raw: Record<string, unknown>): RiserNote | null {
  if (!isStr(raw.id) || !isStr(raw.text) || !isNum(raw.n)) return null;
  return { id: capId(raw.id), n: raw.n, text: text(raw.text, NOTE_MAX) };
}

function cleanLink(raw: Record<string, unknown>): RiserLink | null {
  const from = toEndRef(raw.from);
  const to = toEndRef(raw.to);
  if (!isStr(raw.id) || !isStr(raw.partId) || !isNum(raw.lengthFt) || !from || !to) return null;
  return {
    id: capId(raw.id),
    from,
    to,
    partId: capId(raw.partId),
    lengthFt: raw.lengthFt,
    by: isStr(raw.by) ? text(raw.by, LABEL_MAX) : "",
    at: isNum(raw.at) ? raw.at : 0,
  };
}

/** Defensive read of a stored (or absent) document — never throws. Every
 *  item is rebuilt fresh (never a blind cast), ends are canonicalized
 *  through `toEndRef`, and each array is capped (review I1, M3). */
export function normalizeRiserDoc(raw: unknown): RiserDoc {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const arr = (v: unknown): Array<Record<string, unknown>> =>
    Array.isArray(v) ? v.filter((x): x is Record<string, unknown> => !!x && typeof x === "object") : [];
  const nodes: Record<string, RiserNodeBox> = {};
  if (r.nodes && typeof r.nodes === "object" && !Array.isArray(r.nodes)) {
    for (const [k, b] of Object.entries(r.nodes as Record<string, unknown>)) {
      // A key of "__proto__" written via `nodes[k] = …` sets the object's
      // OWN prototype, not merely an entry — skip it and its siblings
      // rather than build `nodes` on a null-prototype object (review M1).
      if (k === "__proto__" || k === "constructor" || k === "prototype") continue;
      if (isBox(b)) nodes[k] = { x: b.x, y: b.y, w: b.w, h: b.h };
    }
  }
  return {
    nodes,
    levels: arr(r.levels).map(cleanLevel).filter((l): l is RiserLevel => l !== null).slice(0, MAX_LEVELS),
    conduits: arr(r.conduits).map(cleanConduit).filter((c): c is RiserConduit => c !== null).slice(0, MAX_CONDUITS),
    notes: arr(r.notes).map(cleanNote).filter((n): n is RiserNote => n !== null).slice(0, MAX_NOTES),
    links: arr(r.links).map(cleanLink).filter((l): l is RiserLink => l !== null).slice(0, MAX_LINKS),
  };
}

/** One option's RiserLinks — what routeLines prices beside the routes. */
export function riserLinksOf(riser: Record<string, unknown> | null | undefined, optionId: string): RiserLink[] {
  return normalizeRiserDoc(riser?.[optionId]).links;
}

export function nodeKeyOf(spaceId: string | null): string {
  return spaceId ?? UNASSIGNED_KEY;
}

/** Normalized height a node needs for its header + rows. */
export function nodeMinH(groupCount: number): number {
  return (NODE_HEAD + 6 + Math.max(1, groupCount) * NODE_ROW + 8) / RISER_H;
}

/* -------------------------------- layout -------------------------------- */

/** Three wide columns (#GDS final review I2): room between nodes for the
 *  edge chips, and device rows long enough to read. */
const COLS = 3;
const BOX_W = 0.22;
const GAP_X = (1 - COLS * BOX_W) / (COLS + 1);
const BOX_H = 0.24;
const ROW_STEP = 0.34;
const TOP = 0.08;

/** The auto layout's n-th slot: three columns, rows downward. */
export function autoBox(slot: number): RiserNodeBox {
  const c = slot % COLS;
  const row = Math.floor(slot / COLS);
  return { x: r3(GAP_X + c * (BOX_W + GAP_X)), y: r3(TOP + row * ROW_STEP), w: BOX_W, h: BOX_H };
}

function overlaps(a: RiserNodeBox, b: RiserNodeBox): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

/**
 * Saved positions win; every node without one takes the next auto slot that
 * no placed box overlaps. Saved boxes for nodes that no longer exist are
 * ignored (a deleted space leaves nothing behind on the canvas).
 */
export function mergeLayout(keys: string[], saved: Record<string, RiserNodeBox> | undefined): Record<string, RiserNodeBox> {
  const out: Record<string, RiserNodeBox> = {};
  const placed: RiserNodeBox[] = [];
  for (const k of keys) {
    const s = saved?.[k];
    if (s) {
      out[k] = s;
      placed.push(s);
    }
  }
  let slot = 0;
  keys.forEach((k, i) => {
    if (out[k]) return;
    let box: RiserNodeBox | null = null;
    for (let tries = 0; tries < 64; tries++) {
      const cand = autoBox(slot++);
      if (!placed.some((p) => overlaps(p, cand))) {
        box = cand;
        break;
      }
    }
    const b = box || autoBox(i);
    out[k] = b;
    placed.push(b);
  });
  return out;
}

/* ------------------------------- reducer ------------------------------- */

function renumber(notes: RiserNote[]): RiserNote[] {
  return notes.map((n, i) => ({ ...n, n: i + 1 }));
}

/**
 * Apply one edit. Returns `changed: false` (and the document untouched) for
 * anything invalid — a blank label, an unknown id, a self-loop conduit — so
 * the action can refuse it instead of writing a no-op.
 */
export function applyRiserOp(
  input: RiserDoc,
  op: RiserOp,
  makeId: (prefix: RiserIdPrefix) => string
): { doc: RiserDoc; changed: boolean } {
  const doc = normalizeRiserDoc(input);
  const same = { doc, changed: false };
  switch (op.op) {
    case "moveNode": {
      const b = op.box;
      if (!op.key || !isBox(b)) return same;
      const w = clamp(b.w, MIN_W, 1);
      const h = clamp(b.h, MIN_H, MAX_Y);
      const box = { x: r3(clamp(b.x, 0, 1 - w)), y: r3(clamp(b.y, 0, MAX_Y)), w: r3(w), h: r3(h) };
      return { doc: { ...doc, nodes: { ...doc.nodes, [op.key]: box } }, changed: true };
    }
    case "addLevel": {
      const label = text(op.label, LABEL_MAX);
      if (!label || !isNum(op.y)) return same;
      if (doc.levels.length >= MAX_LEVELS) return same;
      const elevation = text(op.elevation, ELEVATION_MAX);
      const level: RiserLevel = { id: makeId("lv-"), label, ...(elevation ? { elevation } : {}), y: r3(clamp(op.y, 0, MAX_Y)) };
      return { doc: { ...doc, levels: [...doc.levels, level] }, changed: true };
    }
    case "updateLevel": {
      const i = doc.levels.findIndex((l) => l.id === op.id);
      if (i < 0) return same;
      const next: RiserLevel = { ...doc.levels[i] };
      if (op.label !== undefined) {
        const l = text(op.label, LABEL_MAX);
        if (!l) return same;
        next.label = l;
      }
      if (op.elevation !== undefined) {
        const e = text(op.elevation, ELEVATION_MAX);
        if (e) next.elevation = e;
        else delete next.elevation;
      }
      if (op.y !== undefined) {
        if (!isNum(op.y)) return same;
        next.y = r3(clamp(op.y, 0, MAX_Y));
      }
      const levels = [...doc.levels];
      levels[i] = next;
      return { doc: { ...doc, levels }, changed: true };
    }
    case "removeLevel": {
      if (!doc.levels.some((l) => l.id === op.id)) return same;
      return { doc: { ...doc, levels: doc.levels.filter((l) => l.id !== op.id) }, changed: true };
    }
    case "addConduit": {
      // Canonicalize both ends (review I1) — a raw client value may carry
      // extra properties, or reference something that isn't actually in
      // this project; the latter is checked by the caller (patchRiser),
      // which has the project to check it against.
      const from = toEndRef(op.from);
      const to = toEndRef(op.to);
      if (!from || !to || sameEnd(from, to)) return same;
      const label = text(op.label, LABEL_MAX);
      if (!label) return same;
      if (doc.conduits.length >= MAX_CONDUITS) return same;
      return { doc: { ...doc, conduits: [...doc.conduits, { id: makeId("cd-"), from, to, label }] }, changed: true };
    }
    case "updateConduit": {
      const label = text(op.label, LABEL_MAX);
      if (!label || !doc.conduits.some((c) => c.id === op.id)) return same;
      return { doc: { ...doc, conduits: doc.conduits.map((c) => (c.id === op.id ? { ...c, label } : c)) }, changed: true };
    }
    case "removeConduit": {
      if (!doc.conduits.some((c) => c.id === op.id)) return same;
      return { doc: { ...doc, conduits: doc.conduits.filter((c) => c.id !== op.id) }, changed: true };
    }
    case "addNote": {
      const t = text(op.text, NOTE_MAX);
      if (!t) return same;
      if (doc.notes.length >= MAX_NOTES) return same;
      return { doc: { ...doc, notes: renumber([...doc.notes, { id: makeId("nt-"), n: 0, text: t }]) }, changed: true };
    }
    case "updateNote": {
      const t = text(op.text, NOTE_MAX);
      if (!t || !doc.notes.some((n) => n.id === op.id)) return same;
      return { doc: { ...doc, notes: doc.notes.map((n) => (n.id === op.id ? { ...n, text: t } : n)) }, changed: true };
    }
    case "removeNote": {
      if (!doc.notes.some((n) => n.id === op.id)) return same;
      return { doc: { ...doc, notes: renumber(doc.notes.filter((n) => n.id !== op.id)) }, changed: true };
    }
    case "removeLink": {
      if (!doc.links.some((l) => l.id === op.id)) return same;
      return { doc: { ...doc, links: doc.links.filter((l) => l.id !== op.id) }, changed: true };
    }
  }
  return same;
}

/* ---------------------------- device drops ---------------------------- */

/** Device-drop spacing, normalized to the page width: a plan symbol is
 *  ~44 px on the editor's 900 px page (≈ 0.05), so drops a little further
 *  apart than that never stack (#GDS final review I4). */
export const DROP_STEP = 0.06;

/**
 * `n` points inside a space polygon for "+ Device": a square spiral out from
 * the centroid on a `step` grid, skipping points outside the polygon or too
 * close to anything already there, so multiples never stack. A polygon too
 * small for them all at `step` tries again at half, then a quarter, the
 * spacing; only then does the rest fall back to the centroid.
 */
export function spreadInSpace(poly: Point[], n: number, taken: Point[] = [], step = DROP_STEP): Point[] {
  const c = polygonCentroid(poly);
  const out: Point[] = [];
  for (const s of [step, step / 2, step / 4]) {
    const free = (p: Point) => [...taken, ...out].every((q) => Math.hypot(q.x - p.x, q.y - p.y) >= s * 0.75);
    const rings = Math.ceil(1 / s);
    for (let ring = 0; ring <= rings && out.length < n; ring++) {
      for (let dy = -ring; dy <= ring && out.length < n; dy++) {
        for (let dx = -ring; dx <= ring && out.length < n; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== ring) continue;
          const p = { x: r4(c.x + dx * s), y: r4(c.y + dy * s) };
          if (p.x < 0 || p.x > 1 || p.y < 0 || p.y > 1) continue;
          if (pointInPolygon(p, poly) && free(p)) out.push(p);
        }
      }
    }
    if (out.length >= n) break;
  }
  while (out.length < n) out.push({ x: r4(c.x), y: r4(c.y) });
  return out;
}

/** `n` points along the plan's lower margin, outside every space on that
 *  page — where "+ Device" on the Unassigned node lands. Rows and columns
 *  are a symbol apart (DROP_STEP across, 0.05 down). */
export function marginPoints(n: number, blockers: Point[][], taken: Point[] = []): Point[] {
  const out: Point[] = [];
  const clear = (p: Point) =>
    !blockers.some((poly) => pointInPolygon(p, poly)) &&
    [...taken, ...out].every((q) => Math.hypot(q.x - p.x, q.y - p.y) >= DROP_STEP * 0.75);
  const cols = Math.floor(0.92 / DROP_STEP);
  for (const y of [0.965, 0.915, 0.865]) {
    for (let i = 0; i <= cols && out.length < n; i++) {
      const p = { x: r4(0.04 + i * DROP_STEP), y };
      if (clear(p)) out.push(p);
    }
    if (out.length >= n) break;
  }
  while (out.length < n) out.push({ x: 0.04, y: 0.965 });
  return out;
}

/** The "Space" tool's rectangle: small, on the plan's lower margin,
 *  staggered by how many spaces the page already has. */
export function marginSpaceRect(index: number): Point[] {
  const i = Math.max(0, Math.floor(index)) % 8;
  const x0 = r3(0.04 + i * 0.115);
  const y0 = 0.86;
  const w = 0.1;
  const h = 0.07;
  return [
    { x: x0, y: y0 },
    { x: r3(x0 + w), y: y0 },
    { x: r3(x0 + w), y: r3(y0 + h) },
    { x: x0, y: r3(y0 + h) },
  ];
}

/**
 * Connect's rule: two DIFFERENT placements on the same sheet + page, and that
 * page is calibrated → a real GridRoute, priced by its measured length.
 * Anything else (cross-sheet, a space end, an uncalibrated page) → a
 * RiserLink with a typed length.
 */
export function connectKind(
  from: EndRef,
  to: EndRef,
  placements: ReadonlyArray<{ id: string; sheetId: string; page: number }>,
  cals: ReadonlyArray<{ docId: string; page: number }>
): "route" | "link" {
  if (from.kind !== "placement" || to.kind !== "placement" || from.placementId === to.placementId) return "link";
  const a = placements.find((p) => p.id === from.placementId);
  const b = placements.find((p) => p.id === to.placementId);
  if (!a || !b || a.sheetId !== b.sheetId || a.page !== b.page) return "link";
  return cals.some((c) => c.docId === a.sheetId && c.page === a.page) ? "route" : "link";
}

/* ---------------------------- prune + copy ---------------------------- */

export type GoneRefs = { placementIds?: ReadonlySet<string>; spaceIds?: ReadonlySet<string> };

/** Drop links and conduits with an end on a removed device/space, and the
 *  saved boxes of removed spaces. */
export function pruneRiserEnds(doc: RiserDoc, gone: GoneRefs): RiserDoc {
  const dead = (e: EndRef) =>
    e.kind === "placement" ? Boolean(gone.placementIds?.has(e.placementId)) : Boolean(e.spaceId && gone.spaceIds?.has(e.spaceId));
  const nodes = { ...doc.nodes };
  for (const id of gone.spaceIds || []) delete nodes[id];
  return {
    ...doc,
    nodes,
    links: doc.links.filter((l) => !dead(l.from) && !dead(l.to)),
    conduits: doc.conduits.filter((c) => !dead(c.from) && !dead(c.to)),
  };
}

/** pruneRiserEnds over every option's document. */
export function pruneRisers(riser: Record<string, RiserDoc> | undefined, gone: GoneRefs): Record<string, RiserDoc> | undefined {
  if (!riser) return riser;
  const out: Record<string, RiserDoc> = {};
  for (const [k, d] of Object.entries(riser)) out[k] = pruneRiserEnds(normalizeRiserDoc(d), gone);
  return out;
}

/** An option copy's riser: same layout, new ids, device ends re-pointed at
 *  the copied placements (an end whose device wasn't copied drops out). */
export function copyRiserDoc(
  src: RiserDoc | undefined,
  idMap: ReadonlyMap<string, string>,
  makeId: (prefix: RiserIdPrefix) => string,
  by: string,
  at: number
): RiserDoc {
  const d = normalizeRiserDoc(src);
  const map = (e: EndRef): EndRef | null => {
    if (e.kind === "space") return { kind: "space", spaceId: e.spaceId };
    const next = idMap.get(e.placementId);
    return next ? { kind: "placement", placementId: next } : null;
  };
  const links: RiserLink[] = [];
  for (const l of d.links) {
    const from = map(l.from);
    const to = map(l.to);
    if (from && to) links.push({ ...l, id: makeId("lk-"), from, to, by, at });
  }
  const conduits: RiserConduit[] = [];
  for (const c of d.conduits) {
    const from = map(c.from);
    const to = map(c.to);
    if (from && to) conduits.push({ ...c, id: makeId("cd-"), from, to });
  }
  return {
    nodes: { ...d.nodes },
    levels: d.levels.map((l) => ({ ...l, id: makeId("lv-") })),
    conduits,
    notes: d.notes.map((n) => ({ ...n, id: makeId("nt-") })),
    links,
  };
}

/* --------------------------------- view --------------------------------- */

export type RiserViewGroup = RiserGroup & { ids: string[]; iconId: string; color: string };
export type RiserViewNode = {
  key: string;
  spaceId: string | null;
  name: string;
  color: string;
  groups: RiserViewGroup[];
  box: RiserNodeBox;
};
export type EndAnchor = { key: string; partId: string | null };
export type RiserViewEdge = {
  id: string;
  kind: "route" | "link";
  partId: string;
  desc: string;
  /** Short code for the riser chip — the part's SKU, else its id. */
  code: string;
  from: EndAnchor;
  to: EndAnchor;
  lengthFt: number | null;
  unit: string;
};
export type RiserViewConduit = { id: string; from: EndAnchor; to: EndAnchor; label: string };
export type RiserView = {
  nodes: RiserViewNode[];
  edges: RiserViewEdge[];
  conduits: RiserViewConduit[];
  levels: RiserLevel[];
  notes: RiserNote[];
  /** Canvas height in units (≥ RISER_H). */
  height: number;
};

/**
 * Everything the riser draws: EVERY space as a node (an empty room is still a
 * place to add devices), Unassigned when it holds devices or any end, the
 * derived device rows (with their placement ids, oldest first, for edit and
 * delete), route edges from the graph, RiserLink edges, conduits, levels and
 * notes. Ends that no longer resolve are simply not drawn.
 */
export function buildRiserView(input: {
  graph: RiserGraph;
  spaces: Array<SpaceLite & { name: string; color?: string }>;
  placements: Array<{ id: string; sheetId: string; page: number; x: number; y: number; partId: string; at: number; curtain?: unknown }>;
  routes: Array<{ id: string; fromPlacementId?: string; toPlacementId?: string }>;
  doc: RiserDoc | null | undefined;
  look?: (g: RiserGroup) => { iconId: string; color: string };
  partDesc?: (partId: string) => string;
  partCode?: (partId: string) => string;
}): RiserView {
  const doc = normalizeRiserDoc(input.doc);
  const look = input.look || (() => ({ iconId: "device", color: "#8c919c" }));
  const desc = input.partDesc || ((id: string) => id);
  const code = input.partCode || ((id: string) => id);
  const byId = new Map(input.placements.map((p) => [p.id, p]));
  const homeKey = (pl: { sheetId: string; page: number; x: number; y: number }) => nodeKeyOf(spaceOf(pl, input.spaces)?.id ?? null);

  const ids = new Map<string, string[]>();
  for (const pl of [...input.placements].sort((a, b) => a.at - b.at || a.id.localeCompare(b.id))) {
    if (pl.curtain) continue; // riserGraph leaves curtains off the one-line
    const k = `${homeKey(pl)}|${pl.partId}`;
    ids.set(k, [...(ids.get(k) || []), pl.id]);
  }

  const spaceIds = new Set(input.spaces.map((s) => s.id));
  const anchor = (e: EndRef): EndAnchor | null => {
    if (e.kind === "space") {
      if (e.spaceId && !spaceIds.has(e.spaceId)) return null;
      return { key: nodeKeyOf(e.spaceId), partId: null };
    }
    const pl = byId.get(e.placementId);
    return pl && !pl.curtain ? { key: homeKey(pl), partId: pl.partId } : null;
  };

  const routeById = new Map(input.routes.map((r) => [r.id, r]));
  const edges: RiserViewEdge[] = [];
  for (const e of input.graph.edges) {
    const r = routeById.get(e.routeId);
    const from = (r?.fromPlacementId ? anchor({ kind: "placement", placementId: r.fromPlacementId }) : null) || { key: nodeKeyOf(e.fromSpaceId), partId: null };
    const to = (r?.toPlacementId ? anchor({ kind: "placement", placementId: r.toPlacementId }) : null) || { key: nodeKeyOf(e.toSpaceId), partId: null };
    edges.push({ id: e.routeId, kind: "route", partId: e.partId, desc: desc(e.partId), code: code(e.partId), from, to, lengthFt: e.lengthFt, unit: e.unit });
  }
  for (const l of doc.links) {
    const from = anchor(l.from);
    const to = anchor(l.to);
    if (from && to) edges.push({ id: l.id, kind: "link", partId: l.partId, desc: desc(l.partId), code: code(l.partId), from, to, lengthFt: l.lengthFt, unit: "ft" });
  }
  const conduits: RiserViewConduit[] = [];
  for (const c of doc.conduits) {
    const from = anchor(c.from);
    const to = anchor(c.to);
    if (from && to) conduits.push({ id: c.id, from, to, label: c.label });
  }

  const graphNode = new Map(input.graph.nodes.map((n) => [nodeKeyOf(n.spaceId), n]));
  const used = new Set<string>([...edges, ...conduits].flatMap((x) => [x.from.key, x.to.key]));
  const keys = input.spaces.map((s) => s.id);
  const un = graphNode.get(UNASSIGNED_KEY);
  if ((un && un.groups.length > 0) || used.has(UNASSIGNED_KEY)) keys.push(UNASSIGNED_KEY);
  const boxes = mergeLayout(keys, doc.nodes);

  const nodes: RiserViewNode[] = keys.map((key) => {
    const space = input.spaces.find((s) => s.id === key);
    const g = graphNode.get(key);
    const groups: RiserViewGroup[] = (g?.groups || []).map((grp) => ({ ...grp, ids: ids.get(`${key}|${grp.partId}`) || [], ...look(grp) }));
    const b = boxes[key];
    return {
      key,
      spaceId: space ? space.id : null,
      name: space ? space.name : "Unassigned",
      color: space?.color || g?.color || "#9aa0ab",
      groups,
      box: { ...b, h: Math.max(b.h, r3(nodeMinH(groups.length))) },
    };
  });

  const bottom = Math.max(1, ...nodes.map((n) => n.box.y + n.box.h), ...doc.levels.map((l) => l.y));
  return { nodes, edges, conduits, levels: doc.levels, notes: doc.notes, height: Math.ceil(bottom * RISER_H + 24) };
}
