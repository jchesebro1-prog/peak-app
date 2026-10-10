/**
 * The Grid — conduit riser document (#321, spec 2026-10-09 §Data).
 *
 * Bray-format device-level riser. Devices and wires stay DERIVED from the
 * plan (the D112 rule); this document holds only what the plan cannot know,
 * per design option: details, pinned tag positions, stubs, accepted conduit
 * runs, dismissed suggestions, level-line positions, power types, notes and
 * the two pricing defaults.
 *
 * Positions are sheet inches at full size (x right, y down). Pure and
 * dependency-free (the grid-bom rule): the store, the riser page, the
 * drawing set and the harness all import it.
 */

export type Pt = { x: number; y: number };

export type RunEnd = { kind: "placement"; placementId: string } | { kind: "stub"; stubId: string };
export type RunStyle = "conduit" | "cableMgmt";

export type ConduitRun = {
  id: string; // 'cr-' + hex
  /** `a` is the source side as accepted (the first wire's `from`); the view
   *  re-orients each run toward its detail's head end at draw time. */
  a: RunEnd;
  b: RunEnd;
  /** Plan GridRoute ids inside this conduit. */
  routeIds: string[];
  /** Typed-length RiserLink ids inside this conduit. */
  linkIds: string[];
  /** '3/4"' — the design default when the run was created. */
  size: string;
  style: RunStyle;
  /** undefined = the design default. */
  priceWire?: boolean;
  priceConduit?: boolean;
  /** Typed length in feet; overrides the measured member length. */
  lengthFt?: number;
  /** Dragged vertical lane, sheet inches (the spec's "bend" — a run is
   *  orthogonal, so its only free coordinate is the lane's x). */
  laneX?: number;
  /** Wire-type ids — display-only signals for a run with no member wires
   *  (a stub run such as "FA — wire pull by others"). */
  signals?: string[];
};

export type RiserDetail = {
  id: string; // 'dt-'
  /** Detail number as printed: "1", "1.1", "2". */
  n: string;
  name: string;
  /** true = every space (the default detail). Otherwise only `spaceIds` —
   *  an emptied list covers nothing rather than silently becoming "all". */
  allSpaces: boolean;
  spaceIds: string[];
};

export type TagPos = { x: number; y: number; detailId: string };
export type RiserStub = { id: string; label: string; detailId: string; x?: number; y?: number };
export type Dismissal = { key: string; ids: string[] };
export type PowerType = { letter: string; type: string; config: string; input: string };
export type RiserNote = { id: string; n: number; text: string };
export type ConduitRiserDefaults = { size: string; priceWire: boolean; priceConduit: boolean };
export type ConduitRiserSystem = "lighting";

export type ConduitRiserDoc = {
  system: ConduitRiserSystem;
  details: RiserDetail[];
  /** Pinned tag positions, keyed by placement id. Absent = auto-layout. */
  tags: Record<string, TagPos>;
  stubs: RiserStub[];
  runs: ConduitRun[];
  dismissed: Dismissal[];
  /** Dragged level-line y, per detail id, per level id. */
  levelY: Record<string, Record<string, number>>;
  /** Device-type keys that get a tag even with no run. */
  alwaysShow: string[];
  powerTypes: PowerType[];
  notes: RiserNote[];
  defaults: ConduitRiserDefaults;
};

export const CR_CAPS = {
  details: 20,
  tags: 2000,
  stubs: 200,
  runs: 1000,
  dismissed: 2000,
  members: 200,
  signals: 10,
  powerTypes: 20,
  notes: 100,
  alwaysShow: 30,
  /** Dragged level lines kept per detail. */
  levelsPerDetail: 50,
} as const;

const LIMIT = { id: 100, n: 8, name: 60, label: 60, size: 12, note: 500, letter: 2, ptType: 40, ptText: 60 } as const;
/** Furthest a stored position may sit from the origin, in inches. */
const MAX_IN = 500;
/** Longest typed run length, feet (the RiserLink cap, MAX_LINK_FT). */
export const MAX_RUN_FT = 5000;

export const DEFAULT_CONDUIT_SIZE = '3/4"';
export const LIGHTING_ALWAYS_SHOW: readonly string[] = ["control-networking", "dimming-power", "racks-cases"];
export const DEFAULT_DETAIL_NAME = "Lighting control";

/** TL1.5's power-types table — the "Start from Bray's A–E" rows. */
export const BRAY_POWER_TYPES: readonly PowerType[] = [
  { letter: "A", type: "Normal", config: "3Ø, 4 wire+GND", input: "120V / 200A / 60Hz" },
  { letter: "B", type: "EM", config: "3Ø, 4 wire+GND", input: "277V / 100A / 60Hz" },
  { letter: "C", type: "Normal", config: "1Ø, 2 wire+GND", input: "120V / 20A / 60Hz" },
  { letter: "D", type: "EM", config: "1Ø, 2 wire+GND", input: "120V / 20A / 60Hz" },
  { letter: "E", type: "4-wire 20A max", config: "Sense feed to engineer-specified normal power source", input: "" },
];

const r4 = (v: number) => Math.round(v * 10000) / 10000;
const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
/** Trimmed, control characters removed, capped. */
export function crText(v: unknown, max: number): string {
  return typeof v === "string" ? v.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max) : "";
}
/** Keys that are properties of every object — never usable as a map key. */
const RESERVED = new Set(["__proto__", "constructor", "prototype", "toString", "valueOf", "hasOwnProperty"]);
const idOf = (v: unknown) => {
  const s = crText(v, LIMIT.id);
  return RESERVED.has(s) ? "" : s;
};
const own = (o: object, k: string) => Object.prototype.hasOwnProperty.call(o, k);
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const inches = (v: unknown): number | null => {
  const n = num(v);
  return n === null ? null : r4(clamp(n, -MAX_IN, MAX_IN));
};

/** Sorted pair key of two placement ids — "gp-a|gp-b". */
export function pairKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

/** The pair key of a placement-to-placement run, else null (a stub run). */
export function runPairKey(run: Pick<ConduitRun, "a" | "b">): string | null {
  return run.a.kind === "placement" && run.b.kind === "placement" ? pairKey(run.a.placementId, run.b.placementId) : null;
}

export function sameEnd(x: RunEnd, y: RunEnd): boolean {
  return x.kind === "placement" ? y.kind === "placement" && y.placementId === x.placementId : y.kind === "stub" && y.stubId === x.stubId;
}

export function emptyConduitRiserDoc(): ConduitRiserDoc {
  return {
    system: "lighting",
    details: [{ id: "dt-main", n: "1", name: DEFAULT_DETAIL_NAME, allSpaces: true, spaceIds: [] }],
    tags: {},
    stubs: [],
    runs: [],
    dismissed: [],
    levelY: {},
    alwaysShow: [...LIGHTING_ALWAYS_SHOW],
    powerTypes: [],
    notes: [],
    defaults: { size: DEFAULT_CONDUIT_SIZE, priceWire: false, priceConduit: false },
  };
}

function cleanEnd(v: unknown): RunEnd | null {
  if (!isObj(v)) return null;
  if (v.kind === "placement") {
    const placementId = idOf(v.placementId);
    return placementId ? { kind: "placement", placementId } : null;
  }
  if (v.kind === "stub") {
    const stubId = idOf(v.stubId);
    return stubId ? { kind: "stub", stubId } : null;
  }
  return null;
}

function cleanIds(v: unknown, max: number): string[] {
  const out: string[] = [];
  for (const x of arr(v)) {
    const id = idOf(x);
    if (id && !out.includes(id)) out.push(id);
    if (out.length >= max) break;
  }
  return out;
}

const boolOrUndef = (v: unknown): boolean | undefined => (typeof v === "boolean" ? v : undefined);

export function cleanSize(v: unknown): string {
  return crText(v, LIMIT.size) || DEFAULT_CONDUIT_SIZE;
}

function cleanRun(v: unknown): ConduitRun | null {
  if (!isObj(v)) return null;
  const id = idOf(v.id);
  const a = cleanEnd(v.a);
  const b = cleanEnd(v.b);
  if (!id || !a || !b || sameEnd(a, b)) return null;
  const run: ConduitRun = {
    id,
    a,
    b,
    routeIds: cleanIds(v.routeIds, CR_CAPS.members),
    linkIds: cleanIds(v.linkIds, CR_CAPS.members),
    size: cleanSize(v.size),
    style: v.style === "cableMgmt" ? "cableMgmt" : "conduit",
  };
  const pw = boolOrUndef(v.priceWire);
  const pc = boolOrUndef(v.priceConduit);
  if (pw !== undefined) run.priceWire = pw;
  if (pc !== undefined) run.priceConduit = pc;
  const ft = num(v.lengthFt);
  if (ft !== null && ft > 0) run.lengthFt = Math.round(Math.min(ft, MAX_RUN_FT) * 10) / 10;
  const lane = inches(v.laneX);
  if (lane !== null) run.laneX = lane;
  const signals = cleanIds(v.signals, CR_CAPS.signals);
  if (signals.length) run.signals = signals;
  return run;
}

function cleanDetail(v: unknown): RiserDetail | null {
  if (!isObj(v)) return null;
  const id = idOf(v.id);
  const name = crText(v.name, LIMIT.name);
  if (!id || !name) return null;
  const spaceIds = cleanIds(v.spaceIds, 500);
  // Older/hand-shaped detail without the flag: an empty list meant "all".
  const allSpaces = typeof v.allSpaces === "boolean" ? v.allSpaces : spaceIds.length === 0;
  return { id, n: crText(v.n, LIMIT.n) || "1", name, allSpaces, spaceIds: allSpaces ? [] : spaceIds };
}

function cleanStub(v: unknown): RiserStub | null {
  if (!isObj(v)) return null;
  const id = idOf(v.id);
  const label = crText(v.label, LIMIT.label);
  const detailId = idOf(v.detailId);
  if (!id || !label || !detailId) return null;
  const stub: RiserStub = { id, label, detailId };
  const x = inches(v.x);
  const y = inches(v.y);
  if (x !== null && y !== null) {
    stub.x = x;
    stub.y = y;
  }
  return stub;
}

export function cleanPowerType(v: unknown): PowerType | null {
  if (!isObj(v)) return null;
  const letter = crText(v.letter, LIMIT.letter).toUpperCase();
  if (!letter) return null;
  return { letter, type: crText(v.type, LIMIT.ptType), config: crText(v.config, LIMIT.ptText), input: crText(v.input, LIMIT.ptText) };
}

/** Compare detail numbers the way they print: "1" < "1.1" < "1.2" < "2" < "10". */
export function compareDetailN(a: string, b: string): number {
  const pa = a.split(".").map((s) => parseInt(s, 10));
  const pb = b.split(".").map((s) => parseInt(s, 10));
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = Number.isFinite(pa[i]) ? pa[i] : -1;
    const y = Number.isFinite(pb[i]) ? pb[i] : -1;
    if (x !== y) return x - y;
  }
  return a.localeCompare(b);
}

/**
 * Canonical form of a stored (or client-shaped) document: every field
 * rebuilt, junk dropped, caps enforced. Never throws; `null`/junk → the
 * empty document. A document always keeps at least one detail.
 */
export function normalizeConduitRiserDoc(raw: unknown): ConduitRiserDoc {
  const base = emptyConduitRiserDoc();
  if (!isObj(raw)) return base;
  const details: RiserDetail[] = [];
  for (const d of arr(raw.details).map(cleanDetail)) {
    if (d && !details.some((x) => x.id === d.id)) details.push(d);
    if (details.length >= CR_CAPS.details) break;
  }
  if (!details.length) details.push(base.details[0]);
  const detailIds = new Set(details.map((d) => d.id));

  const tags: Record<string, TagPos> = {};
  if (isObj(raw.tags)) {
    for (const [k, v] of Object.entries(raw.tags)) {
      if (Object.keys(tags).length >= CR_CAPS.tags) break;
      const id = idOf(k);
      if (!id || !isObj(v)) continue;
      const x = inches(v.x);
      const y = inches(v.y);
      const detailId = idOf(v.detailId);
      if (x === null || y === null || !detailIds.has(detailId)) continue;
      tags[id] = { x, y, detailId };
    }
  }

  const stubs: RiserStub[] = [];
  for (const s of arr(raw.stubs).map(cleanStub)) {
    if (s && detailIds.has(s.detailId) && !stubs.some((x) => x.id === s.id)) stubs.push(s);
    if (stubs.length >= CR_CAPS.stubs) break;
  }
  const stubIds = new Set(stubs.map((s) => s.id));

  const runs: ConduitRun[] = [];
  const claimed = new Set<string>();
  for (const r of arr(raw.runs).map(cleanRun)) {
    if (!r || runs.some((x) => x.id === r.id)) continue;
    if ((r.a.kind === "stub" && !stubIds.has(r.a.stubId)) || (r.b.kind === "stub" && !stubIds.has(r.b.stubId))) continue;
    // A wire sits in at most one conduit — the first run listing it keeps it.
    r.routeIds = r.routeIds.filter((id) => !claimed.has(`r:${id}`));
    r.linkIds = r.linkIds.filter((id) => !claimed.has(`l:${id}`));
    r.routeIds.forEach((id) => claimed.add(`r:${id}`));
    r.linkIds.forEach((id) => claimed.add(`l:${id}`));
    runs.push(r);
    if (runs.length >= CR_CAPS.runs) break;
  }

  const dismissed: Dismissal[] = [];
  for (const v of arr(raw.dismissed)) {
    if (!isObj(v)) continue;
    const key = crText(v.key, LIMIT.id * 2 + 1);
    if (!key.includes("|") || dismissed.some((d) => d.key === key)) continue;
    dismissed.push({ key, ids: cleanIds(v.ids, CR_CAPS.members) });
    if (dismissed.length >= CR_CAPS.dismissed) break;
  }

  const levelY: Record<string, Record<string, number>> = {};
  if (isObj(raw.levelY)) {
    for (const [dk, row] of Object.entries(raw.levelY)) {
      if (!detailIds.has(dk) || !isObj(row)) continue;
      const out: Record<string, number> = {};
      for (const [lk, y] of Object.entries(row)) {
        if (Object.keys(out).length >= CR_CAPS.levelsPerDetail) break;
        const id = idOf(lk);
        const v = inches(y);
        if (id && v !== null) out[id] = v;
      }
      if (Object.keys(out).length) levelY[dk] = out;
    }
  }

  const alwaysShow = Array.isArray(raw.alwaysShow) ? cleanIds(raw.alwaysShow, CR_CAPS.alwaysShow) : base.alwaysShow;

  const powerTypes: PowerType[] = [];
  for (const p of arr(raw.powerTypes).map(cleanPowerType)) {
    if (p && !powerTypes.some((x) => x.letter === p.letter)) powerTypes.push(p);
    if (powerTypes.length >= CR_CAPS.powerTypes) break;
  }

  const notes: RiserNote[] = [];
  for (const v of arr(raw.notes)) {
    if (!isObj(v)) continue;
    const id = idOf(v.id);
    const text = crText(v.text, LIMIT.note);
    if (!id || !text || notes.some((x) => x.id === id)) continue;
    notes.push({ id, n: notes.length + 1, text });
    if (notes.length >= CR_CAPS.notes) break;
  }

  const d = isObj(raw.defaults) ? raw.defaults : {};
  return {
    system: "lighting",
    details,
    tags,
    stubs,
    runs,
    dismissed,
    levelY,
    alwaysShow,
    powerTypes,
    notes,
    defaults: { size: cleanSize(d.size), priceWire: d.priceWire === true, priceConduit: d.priceConduit === true },
  };
}

/** What still exists in the plan — the input to pruning. */
export type LiveIds = {
  placementIds: ReadonlySet<string>;
  routeIds: ReadonlySet<string>;
  linkIds: ReadonlySet<string>;
  spaceIds: ReadonlySet<string>;
  /** Project levels — dragged positions of deleted levels are dropped. */
  levelIds?: ReadonlySet<string>;
  /** Each live wire's device pair ("route:wr-1" → pairKey, null when an end
   *  is free). A member wire re-snapped to other devices leaves its run. */
  wireEnds?: ReadonlyMap<string, string | null>;
};

/**
 * Drop everything that points at something the plan no longer has: runs
 * ending on a deleted device, member wires that were deleted (the run stays —
 * an empty conduit is real), pinned tags of deleted devices, deleted spaces
 * in details and dismissals naming a deleted device. Returns the same
 * object when nothing changed.
 */
export function pruneConduitRiser(doc: ConduitRiserDoc, live: LiveIds): ConduitRiserDoc {
  let changed = false;
  const endLive = (e: RunEnd) => e.kind === "stub" || live.placementIds.has(e.placementId);
  const runs: ConduitRun[] = [];
  for (const r of doc.runs) {
    if (!endLive(r.a) || !endLive(r.b)) {
      changed = true;
      continue;
    }
    const pair = runPairKey(r);
    const matches = (key: string) => !live.wireEnds || !pair || live.wireEnds.get(key) === pair;
    const routeIds = r.routeIds.filter((id) => live.routeIds.has(id) && matches(`route:${id}`));
    const linkIds = r.linkIds.filter((id) => live.linkIds.has(id) && matches(`link:${id}`));
    if (routeIds.length !== r.routeIds.length || linkIds.length !== r.linkIds.length) {
      changed = true;
      runs.push({ ...r, routeIds, linkIds });
    } else runs.push(r);
  }
  const tags: Record<string, TagPos> = {};
  for (const [id, pos] of Object.entries(doc.tags)) {
    if (live.placementIds.has(id)) tags[id] = pos;
    else changed = true;
  }
  const details = doc.details.map((d) => {
    const spaceIds = d.spaceIds.filter((id) => live.spaceIds.has(id));
    if (spaceIds.length === d.spaceIds.length) return d;
    changed = true;
    return { ...d, spaceIds };
  });
  const dismissed = doc.dismissed.filter((x) => {
    const keep = x.key.split("|").every((id) => live.placementIds.has(id));
    if (!keep) changed = true;
    return keep;
  });
  let levelY = doc.levelY;
  if (live.levelIds) {
    const next: Record<string, Record<string, number>> = {};
    for (const [dk, row] of Object.entries(doc.levelY)) {
      const kept = Object.fromEntries(Object.entries(row).filter(([lk]) => live.levelIds!.has(lk)));
      if (Object.keys(kept).length !== Object.keys(row).length) changed = true;
      if (Object.keys(kept).length) next[dk] = kept;
    }
    levelY = next;
  }
  return changed ? { ...doc, runs, tags, details, dismissed, levelY } : doc;
}

export type CROp =
  | { op: "moveTag"; placementId: string; x: number; y: number; detailId: string }
  | { op: "unpinTag"; placementId: string }
  /** `runIds` = the runs the derived view draws in this detail (their lanes reset too). */
  | { op: "resetLayout"; detailId: string; runIds?: string[] }
  | { op: "addDetail"; name: string; allSpaces: boolean; spaceIds: string[] }
  | { op: "updateDetail"; id: string; name?: string; n?: string; allSpaces?: boolean; spaceIds?: string[] }
  | { op: "removeDetail"; id: string }
  | { op: "addStub"; label: string; detailId: string }
  | { op: "updateStub"; id: string; label?: string; x?: number; y?: number }
  | { op: "removeStub"; id: string }
  | { op: "addConduitRun"; a: RunEnd; b: RunEnd }
  | {
      op: "updateRun";
      id: string;
      size?: string;
      style?: RunStyle;
      /** null = back to the design default. */
      priceWire?: boolean | null;
      priceConduit?: boolean | null;
      lengthFt?: number | null;
      laneX?: number | null;
      signals?: string[];
    }
  | { op: "removeRun"; id: string }
  | { op: "moveLevel"; detailId: string; levelId: string; y: number | null }
  | { op: "setAlwaysShow"; typeKeys: string[] }
  | { op: "setPowerTypes"; rows: PowerType[] }
  | { op: "addNote"; text: string }
  | { op: "updateNote"; id: string; text: string }
  | { op: "removeNote"; id: string }
  | { op: "setDefaults"; size?: string; priceWire?: boolean; priceConduit?: boolean };

export const CR_OP_NAMES = [
  "moveTag", "unpinTag", "resetLayout", "addDetail", "updateDetail", "removeDetail", "addStub", "updateStub",
  "removeStub", "addConduitRun", "updateRun", "removeRun", "moveLevel", "setAlwaysShow", "setPowerTypes",
  "addNote", "updateNote", "removeNote", "setDefaults",
] as const;

/**
 * An estimate-owned option (#314) never prices wire or conduit on the riser —
 * the estimate does. The op with `priceWire` / `priceConduit` taken out of
 * `updateRun` and `setDefaults`; null when nothing is left for it to do (the
 * action answers ok with no write). Every other op passes through untouched.
 */
export function estimateOwnedOp(op: CROp, estimateOwned: boolean): CROp | null {
  if (!estimateOwned || (op.op !== "updateRun" && op.op !== "setDefaults")) return op;
  const rest: Record<string, unknown> = { ...op };
  delete rest.priceWire;
  delete rest.priceConduit;
  const left = Object.keys(rest).filter((k) => k !== "op" && k !== "id" && rest[k] !== undefined);
  return left.length ? (rest as CROp) : null;
}

export type MakeId = (prefix: "cr-" | "dt-" | "st-" | "nt-") => string;

/** The store's id minter: prefix + 12 hex characters from crypto.randomUUID(). */
export const crMakeId: MakeId = (prefix) => prefix + crypto.randomUUID().replace(/-/g, "").slice(0, 12);

/** Next detail number: one more than the highest whole number in use. */
function nextDetailN(details: readonly RiserDetail[]): string {
  const top = details.reduce((m, d) => Math.max(m, parseInt(d.n, 10) || 0), 0);
  return String(top + 1);
}

/**
 * Apply one op, pure. Refuses (changed: false, same doc) anything invalid —
 * an unknown id, a blank label, a self-loop, an end that names a device not
 * in `placementIds`, a cap crossed. The store re-normalizes after.
 */
export function patchConduitRiser(
  doc: ConduitRiserDoc,
  op: CROp,
  makeId: MakeId,
  placementIds: ReadonlySet<string>
): { doc: ConduitRiserDoc; changed: boolean } {
  const same = { doc, changed: false };
  const ok = (next: ConduitRiserDoc) => ({ doc: next, changed: true });
  const hasDetail = (id: string) => doc.details.some((d) => d.id === id);
  const endOk = (e: RunEnd) => (e.kind === "placement" ? placementIds.has(e.placementId) : doc.stubs.some((s) => s.id === e.stubId));
  switch (op.op) {
    case "moveTag": {
      const x = inches(op.x);
      const y = inches(op.y);
      if (!placementIds.has(op.placementId) || x === null || y === null || !hasDetail(op.detailId)) return same;
      if (!own(doc.tags, op.placementId) && Object.keys(doc.tags).length >= CR_CAPS.tags) return same;
      return ok({ ...doc, tags: { ...doc.tags, [op.placementId]: { x, y, detailId: op.detailId } } });
    }
    case "unpinTag": {
      if (!own(doc.tags, op.placementId)) return same;
      const tags = { ...doc.tags };
      delete tags[op.placementId];
      return ok({ ...doc, tags });
    }
    case "resetLayout": {
      if (!hasDetail(op.detailId)) return same;
      const tags = Object.fromEntries(Object.entries(doc.tags).filter(([, p]) => p.detailId !== op.detailId));
      const stubs = doc.stubs.map((s) => (s.detailId === op.detailId ? { id: s.id, label: s.label, detailId: s.detailId } : s));
      const levelY = { ...doc.levelY };
      delete levelY[op.detailId];
      const inDetail = new Set(Object.keys(doc.tags).filter((k) => doc.tags[k].detailId === op.detailId));
      const listed = new Set(cleanIds(op.runIds, CR_CAPS.runs));
      const runs = doc.runs.map((r) => {
        if (r.laneX === undefined) return r;
        const touches =
          listed.has(r.id) ||
          [r.a, r.b].some((e) => (e.kind === "placement" ? inDetail.has(e.placementId) : stubs.some((s) => s.id === e.stubId && s.detailId === op.detailId)));
        if (!touches) return r;
        const { laneX: _drop, ...rest } = r;
        void _drop;
        return rest;
      });
      return ok({ ...doc, tags, stubs, levelY, runs });
    }
    case "addDetail": {
      const name = crText(op.name, LIMIT.name);
      if (!name || doc.details.length >= CR_CAPS.details) return same;
      const all = op.allSpaces === true;
      const detail: RiserDetail = { id: makeId("dt-"), n: nextDetailN(doc.details), name, allSpaces: all, spaceIds: all ? [] : cleanIds(op.spaceIds, 500) };
      return ok({ ...doc, details: [...doc.details, detail] });
    }
    case "updateDetail": {
      const cur = doc.details.find((d) => d.id === op.id);
      if (!cur) return same;
      const next: RiserDetail = { ...cur };
      if (op.name !== undefined) {
        const name = crText(op.name, LIMIT.name);
        if (!name) return same;
        next.name = name;
      }
      if (op.n !== undefined) {
        const n = crText(op.n, LIMIT.n);
        if (!n) return same;
        next.n = n;
      }
      if (op.allSpaces !== undefined) next.allSpaces = op.allSpaces === true;
      if (op.spaceIds !== undefined) next.spaceIds = cleanIds(op.spaceIds, 500);
      if (next.allSpaces) next.spaceIds = [];
      return ok({ ...doc, details: doc.details.map((d) => (d.id === op.id ? next : d)) });
    }
    case "removeDetail": {
      // The last detail can't go — a riser always has somewhere to draw.
      if (!hasDetail(op.id) || doc.details.length <= 1) return same;
      const stubIds = new Set(doc.stubs.filter((s) => s.detailId === op.id).map((s) => s.id));
      return ok({
        ...doc,
        details: doc.details.filter((d) => d.id !== op.id),
        tags: Object.fromEntries(Object.entries(doc.tags).filter(([, p]) => p.detailId !== op.id)),
        stubs: doc.stubs.filter((s) => !stubIds.has(s.id)),
        runs: doc.runs.filter((r) => !(r.a.kind === "stub" && stubIds.has(r.a.stubId)) && !(r.b.kind === "stub" && stubIds.has(r.b.stubId))),
        levelY: Object.fromEntries(Object.entries(doc.levelY).filter(([k]) => k !== op.id)),
      });
    }
    case "addStub": {
      const label = crText(op.label, LIMIT.label);
      if (!label || !hasDetail(op.detailId) || doc.stubs.length >= CR_CAPS.stubs) return same;
      return ok({ ...doc, stubs: [...doc.stubs, { id: makeId("st-"), label, detailId: op.detailId }] });
    }
    case "updateStub": {
      const cur = doc.stubs.find((s) => s.id === op.id);
      if (!cur) return same;
      const next: RiserStub = { ...cur };
      if (op.label !== undefined) {
        const label = crText(op.label, LIMIT.label);
        if (!label) return same;
        next.label = label;
      }
      if (op.x !== undefined || op.y !== undefined) {
        const x = inches(op.x);
        const y = inches(op.y);
        if (x === null || y === null) return same;
        next.x = x;
        next.y = y;
      }
      return ok({ ...doc, stubs: doc.stubs.map((s) => (s.id === op.id ? next : s)) });
    }
    case "removeStub": {
      if (!doc.stubs.some((s) => s.id === op.id)) return same;
      const dead = (e: RunEnd) => e.kind === "stub" && e.stubId === op.id;
      return ok({ ...doc, stubs: doc.stubs.filter((s) => s.id !== op.id), runs: doc.runs.filter((r) => !dead(r.a) && !dead(r.b)) });
    }
    case "addConduitRun": {
      const a = cleanEnd(op.a);
      const b = cleanEnd(op.b);
      if (!a || !b || sameEnd(a, b) || !endOk(a) || !endOk(b) || doc.runs.length >= CR_CAPS.runs) return same;
      const run: ConduitRun = { id: makeId("cr-"), a, b, routeIds: [], linkIds: [], size: doc.defaults.size, style: "conduit" };
      return ok({ ...doc, runs: [...doc.runs, run] });
    }
    case "updateRun": {
      const cur = doc.runs.find((r) => r.id === op.id);
      if (!cur) return same;
      const next: ConduitRun = { ...cur };
      if (op.size !== undefined) next.size = cleanSize(op.size);
      if (op.style !== undefined) next.style = op.style === "cableMgmt" ? "cableMgmt" : "conduit";
      if (op.priceWire !== undefined) {
        if (op.priceWire === null) delete next.priceWire;
        else next.priceWire = op.priceWire === true;
      }
      if (op.priceConduit !== undefined) {
        if (op.priceConduit === null) delete next.priceConduit;
        else next.priceConduit = op.priceConduit === true;
      }
      if (op.lengthFt !== undefined) {
        const ft = num(op.lengthFt);
        if (op.lengthFt === null || ft === null || ft <= 0) delete next.lengthFt;
        else next.lengthFt = Math.round(Math.min(ft, MAX_RUN_FT) * 10) / 10;
      }
      if (op.laneX !== undefined) {
        const lane = inches(op.laneX);
        if (lane === null) delete next.laneX;
        else next.laneX = lane;
      }
      if (op.signals !== undefined) {
        const signals = cleanIds(op.signals, CR_CAPS.signals);
        if (signals.length) next.signals = signals;
        else delete next.signals;
      }
      return ok({ ...doc, runs: doc.runs.map((r) => (r.id === op.id ? next : r)) });
    }
    case "removeRun": {
      if (!doc.runs.some((r) => r.id === op.id)) return same;
      return ok({ ...doc, runs: doc.runs.filter((r) => r.id !== op.id) });
    }
    case "moveLevel": {
      if (!hasDetail(op.detailId) || !idOf(op.levelId)) return same;
      const row = { ...(own(doc.levelY, op.detailId) ? doc.levelY[op.detailId] : {}) };
      if (op.y === null) {
        if (!own(row, op.levelId)) return same;
        delete row[op.levelId];
      } else {
        const y = inches(op.y);
        if (y === null) return same;
        if (!own(row, op.levelId) && Object.keys(row).length >= CR_CAPS.levelsPerDetail) return same;
        row[op.levelId] = y;
      }
      const levelY = { ...doc.levelY };
      if (Object.keys(row).length) levelY[op.detailId] = row;
      else delete levelY[op.detailId];
      return ok({ ...doc, levelY });
    }
    case "setAlwaysShow":
      return ok({ ...doc, alwaysShow: cleanIds(op.typeKeys, CR_CAPS.alwaysShow) });
    case "setPowerTypes": {
      const rows: PowerType[] = [];
      for (const p of arr(op.rows).map(cleanPowerType)) {
        if (p && !rows.some((x) => x.letter === p.letter)) rows.push(p);
        if (rows.length >= CR_CAPS.powerTypes) break;
      }
      return ok({ ...doc, powerTypes: rows });
    }
    case "addNote": {
      const text = crText(op.text, LIMIT.note);
      if (!text || doc.notes.length >= CR_CAPS.notes) return same;
      return ok({ ...doc, notes: [...doc.notes, { id: makeId("nt-"), n: doc.notes.length + 1, text }] });
    }
    case "updateNote": {
      const text = crText(op.text, LIMIT.note);
      if (!text || !doc.notes.some((x) => x.id === op.id)) return same;
      return ok({ ...doc, notes: doc.notes.map((x) => (x.id === op.id ? { ...x, text } : x)) });
    }
    case "removeNote": {
      if (!doc.notes.some((x) => x.id === op.id)) return same;
      return ok({ ...doc, notes: doc.notes.filter((x) => x.id !== op.id).map((x, i) => ({ ...x, n: i + 1 })) });
    }
    case "setDefaults": {
      const defaults = { ...doc.defaults };
      if (op.size !== undefined) defaults.size = cleanSize(op.size);
      if (op.priceWire !== undefined) defaults.priceWire = op.priceWire === true;
      if (op.priceConduit !== undefined) defaults.priceConduit = op.priceConduit === true;
      return ok({ ...doc, defaults });
    }
  }
}

/**
 * A copied design option's riser document (option copy, the copyRiserDoc
 * idiom). `idMap` maps the source option's placement, route and RiserLink
 * ids to the copy's; ends, member wires, pinned tags and dismissals are
 * re-pointed through it and anything unmapped is dropped. Details, stubs,
 * runs and notes get new ids (stub ends, tag and stub `detailId`s and
 * dragged level positions follow). Spaces and levels belong to the project,
 * not the option, so their ids are kept. Pure; never mutates `src`.
 */
export function copyConduitRiserDoc(src: unknown, idMap: ReadonlyMap<string, string>, makeId: MakeId): ConduitRiserDoc {
  const d = normalizeConduitRiserDoc(src);
  const detailMap = new Map(d.details.map((x) => [x.id, makeId("dt-")]));
  const stubMap = new Map(d.stubs.map((x) => [x.id, makeId("st-")]));
  const details = d.details.map((x) => ({ ...x, id: detailMap.get(x.id)!, spaceIds: [...x.spaceIds] }));
  const stubs = d.stubs.map((x) => ({ ...x, id: stubMap.get(x.id)!, detailId: detailMap.get(x.detailId)! }));
  const tags: Record<string, TagPos> = {};
  for (const [id, pos] of Object.entries(d.tags)) {
    const next = idMap.get(id);
    if (next) tags[next] = { ...pos, detailId: detailMap.get(pos.detailId)! };
  }
  const mapEnd = (e: RunEnd): RunEnd | null => {
    if (e.kind === "placement") {
      const next = idMap.get(e.placementId);
      return next ? { kind: "placement", placementId: next } : null;
    }
    const next = stubMap.get(e.stubId);
    return next ? { kind: "stub", stubId: next } : null;
  };
  const mapIds = (ids: readonly string[]) => ids.flatMap((id) => idMap.get(id) ?? []);
  const runs: ConduitRun[] = [];
  for (const r of d.runs) {
    const a = mapEnd(r.a);
    const b = mapEnd(r.b);
    if (!a || !b) continue;
    runs.push({ ...r, id: makeId("cr-"), a, b, routeIds: mapIds(r.routeIds), linkIds: mapIds(r.linkIds), ...(r.signals ? { signals: [...r.signals] } : {}) });
  }
  const dismissed: Dismissal[] = [];
  for (const x of d.dismissed) {
    const [p, q] = x.key.split("|");
    const np = idMap.get(p);
    const nq = idMap.get(q);
    if (np && nq) dismissed.push({ key: pairKey(np, nq), ids: mapIds(x.ids) });
  }
  const levelY: Record<string, Record<string, number>> = {};
  for (const [dk, row] of Object.entries(d.levelY)) {
    const next = detailMap.get(dk);
    if (next) levelY[next] = { ...row };
  }
  return normalizeConduitRiserDoc({
    ...d,
    details,
    tags,
    stubs,
    runs,
    dismissed,
    levelY,
    alwaysShow: [...d.alwaysShow],
    powerTypes: d.powerTypes.map((p) => ({ ...p })),
    notes: d.notes.map((n) => ({ ...n, id: makeId("nt-") })),
    defaults: { ...d.defaults },
  });
}
