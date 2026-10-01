/**
 * Track series (#274 §1) — the parts map behind the track configurator. Pure,
 * client-safe: no DB, no server import. The store is
 * src/lib/stores/track-series.ts (settings blob `track_series`, one top-level
 * key per series id); the admin screen is Estimating Rules → Track series.
 *
 * A series names ONE catalog part per role. Nothing here carries a price and
 * nothing is seeded: the table starts empty and every part number is picked
 * by an admin from the live catalog (spec §1 — no invented part numbers).
 */

export type TrackRole =
  | "track" // straight stick, priced per stick
  | "curved" // curved section, per section (curved runs only)
  | "splice" // splice clamp, per joint
  | "carrier"
  | "masterCarrier"
  | "endStop"
  | "livePulley" // cord-operated only
  | "deadPulley" // cord-operated only
  | "floorBlock" // cord-operated only
  | "operatingLine" // per foot (catalog unit = ft)
  | "battenClamp" // batten mounting
  | "ceilingHanger" // ceiling / structure mounting
  | "ceilingSplice" // #291 optional: replaces `splice` on ceiling mounting
  | "pipeClamp" // #291 optional: one per batten hanging point, alongside battenClamp
  | "lapClamp" // #291 optional: 2 per bi-parting batten track (two lapped legs)
  | "deadPulleyOneWay"; // #291 optional: replaces `deadPulley` on one-way

/** #291 — one straight stick length the series is mapped for. */
export type TrackStick = { lengthFt: number; sku: string };

export type TrackOperation = "biparting" | "oneway" | "walkalong";
export type TrackMounting = "batten" | "ceiling";

export type TrackSeries = {
  /** Stable slug, server-allocated (never reused after a delete). */
  id: string;
  /** e.g. "ADC 280" */
  name: string;
  /** e.g. "ADC" */
  manufacturer: string;
  /** Straight stick length, ft. 0 = not entered yet (blocks Active). */
  stickLengthFt: number;
  /** Arc length of one curved section, ft; absent = the series has no curved track. */
  curvedSectionFt?: number;
  /** Smallest radius the series bends to, ft. */
  minRadiusFt?: number;
  /** Default carrier spacing, in. */
  carrierSpacingIn: number;
  /** Default batten-clamp / hanger spacing, ft. */
  hangerSpacingFt: number;
  /** Bi-parting center overlap added to the track length, ft (0 = none). */
  overlapFt: number;
  /** Catalog part per role. */
  parts: Partial<Record<TrackRole, { sku: string }>>;
  /**
   * #291 — every straight stick length mapped, ascending. When present it is
   * the source of truth: sanitize derives stickLengthFt (the longest) and
   * parts.track (its SKU). Absent = a #274 series (one stick: stickLengthFt + parts.track).
   */
  sticks?: TrackStick[];
  /** #291 — extra operating line per track for tie-off, ft (ADC: 10). Absent = 0. */
  lineAllowanceFt?: number;
  active: boolean;
  /** Who last saved it, and when (epoch ms) — display only. */
  updatedBy?: string;
  updatedAt?: number;
};

/** Every role, in the order the admin screen and the engine's rows list them. */
export const TRACK_ROLES: readonly TrackRole[] = [
  "track",
  "curved",
  "splice",
  "ceilingSplice",
  "carrier",
  "masterCarrier",
  "endStop",
  "lapClamp",
  "battenClamp",
  "pipeClamp",
  "ceilingHanger",
  "livePulley",
  "deadPulley",
  "deadPulleyOneWay",
  "floorBlock",
  "operatingLine",
];

export const TRACK_ROLE_LABELS: Record<TrackRole, string> = {
  track: "Track (straight stick)",
  curved: "Curved section",
  splice: "Splice clamp",
  carrier: "Carrier",
  masterCarrier: "Master carrier",
  endStop: "End stop",
  livePulley: "Live-end pulley",
  deadPulley: "Dead-end pulley",
  floorBlock: "Floor block",
  operatingLine: "Operating line (per ft)",
  battenClamp: "Batten clamp",
  ceilingHanger: "Ceiling / structure hanger",
  ceilingSplice: "Ceiling splice clamp",
  pipeClamp: "Pipe clamp (per batten point)",
  lapClamp: "Lap clamp (bi-parting center)",
  deadPulleyOneWay: "Dead-end pulley, one-way",
};

/** Short role names for messages ("… has no part for Floor block"). */
export const TRACK_ROLE_NAMES: Record<TrackRole, string> = {
  track: "Track",
  curved: "Curved section",
  splice: "Splice clamp",
  carrier: "Carrier",
  masterCarrier: "Master carrier",
  endStop: "End stop",
  livePulley: "Live-end pulley",
  deadPulley: "Dead-end pulley",
  floorBlock: "Floor block",
  operatingLine: "Operating line",
  battenClamp: "Batten clamp",
  ceilingHanger: "Ceiling hanger",
  ceilingSplice: "Ceiling splice clamp",
  pipeClamp: "Pipe clamp",
  lapClamp: "Lap clamp",
  deadPulleyOneWay: "One-way dead-end pulley",
};

export const TRACK_OPERATION_LABELS: Record<TrackOperation, string> = {
  biparting: "Bi-parting",
  oneway: "One-way",
  walkalong: "Walk-along",
};

/** Roles every active series must map (spec §1), plus one mounting role. */
export const ALWAYS_REQUIRED_ROLES: readonly TrackRole[] = ["track", "splice", "carrier", "masterCarrier", "endStop"];
export const MOUNTING_ROLES: readonly TrackRole[] = ["battenClamp", "ceilingHanger"];
export const CORD_ROLES: readonly TrackRole[] = ["livePulley", "deadPulley", "floorBlock", "operatingLine"];
/** #291 — roles priced only when mapped; never required for Active. */
export const OPTIONAL_ROLES: readonly TrackRole[] = ["ceilingSplice", "pipeClamp", "lapClamp", "deadPulleyOneWay"];

/** New-series pre-fills (spec §1). Stick length and the curved fields start blank. */
export const NEW_SERIES_DEFAULTS = { carrierSpacingIn: 12, hangerSpacingFt: 5, overlapFt: 0 } as const;

/** Sane maxima — sanitize clamps to these. */
export const TRACK_LIMITS = {
  stickLengthFt: 40,
  curvedSectionFt: 40,
  minRadiusFt: 200,
  carrierSpacingIn: 120,
  hangerSpacingFt: 40,
  overlapFt: 20,
  sticks: 12,
  lineAllowanceFt: 50,
  name: 80,
  manufacturer: 60,
  sku: 120,
} as const;

export const TRACK_SERIES_BLOB = "track_series";
export const TRACK_SERIES_ID_RE = /^[a-z0-9][a-z0-9-]{0,59}$/;

const ROLE_SET: ReadonlySet<string> = new Set(TRACK_ROLES);

export function isTrackRole(v: unknown): v is TrackRole {
  return typeof v === "string" && ROLE_SET.has(v);
}

export function isCordOperated(op: TrackOperation): boolean {
  return op === "biparting" || op === "oneway";
}

export function mountingRole(m: TrackMounting): TrackRole {
  return m === "ceiling" ? "ceilingHanger" : "battenClamp";
}

function cleanText(v: unknown, max: number): string {
  return typeof v === "string" ? v.trim().replace(/\s+/g, " ").slice(0, max) : "";
}

function num(v: unknown): number {
  if (typeof v === "number") return v;
  if (typeof v === "string" && v.trim() !== "") return Number(v);
  return NaN;
}

/** A positive number clamped to `max`; anything else (blank, ≤ 0, NaN) → `fallback`. */
function positive(v: unknown, max: number, fallback: number): number {
  const n = num(v);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(n, max);
}

/** An optional positive number clamped to `max`; anything else → undefined. */
function optionalPositive(v: unknown, max: number): number | undefined {
  const n = num(v);
  if (!Number.isFinite(n) || n <= 0) return undefined;
  return Math.min(n, max);
}

/** The series' mapped SKU for a role, or "" when unmapped. */
export function roleSku(series: Pick<TrackSeries, "parts">, role: TrackRole): string {
  return series.parts[role]?.sku ?? "";
}

/**
 * #291 — the series' straight sticks, ascending. A #274 series (no `sticks`)
 * reads as one stick: stickLengthFt + parts.track (its SKU may be "" when the
 * track role is unmapped — pricing then blocks by name).
 */
export function seriesSticks(series: Pick<TrackSeries, "sticks" | "stickLengthFt" | "parts">): TrackStick[] {
  if (series.sticks && series.sticks.length) return [...series.sticks].sort((a, b) => a.lengthFt - b.lengthFt);
  if (series.stickLengthFt > 0) return [{ lengthFt: series.stickLengthFt, sku: roleSku(series, "track") }];
  return [];
}

/** #291 — every SKU a series references (role parts + sticks), once each — what a page must read from the catalog. */
export function seriesSkus(series: Pick<TrackSeries, "sticks" | "parts">): string[] {
  const out = new Set<string>();
  for (const p of Object.values(series.parts)) if (p?.sku) out.add(p.sku);
  for (const s of series.sticks ?? []) if (s.sku) out.add(s.sku);
  return [...out];
}

function cleanSticks(v: unknown): TrackStick[] {
  if (!Array.isArray(v)) return [];
  const byLength = new Map<number, TrackStick>();
  for (const e of v) {
    if (!e || typeof e !== "object" || Array.isArray(e)) continue;
    const r = e as Record<string, unknown>;
    const lengthFt = positive(r.lengthFt, TRACK_LIMITS.stickLengthFt, 0);
    const sku = cleanText(r.sku, TRACK_LIMITS.sku);
    if (!(lengthFt > 0) || !sku || byLength.has(lengthFt)) continue;
    byLength.set(lengthFt, { lengthFt, sku });
  }
  return [...byLength.values()].sort((a, b) => a.lengthFt - b.lengthFt).slice(0, TRACK_LIMITS.sticks);
}

/**
 * Everything that stops a series from being Active (spec §1): a stick length,
 * and a part for track, splice, carrier, master carrier, end stop and at least
 * one mounting role. When `liveSkus` is given, a mapped SKU that isn't in it
 * (deleted from the catalog) counts as unmapped — and (#291) so does every
 * stick whose SKU isn't in it: one problem per dead stick, in length order.
 * Empty list = can be active.
 */
export function activationProblems(
  series: Pick<TrackSeries, "stickLengthFt" | "parts" | "sticks">,
  liveSkus?: ReadonlySet<string>
): string[] {
  const problems: string[] = [];
  if (!(series.stickLengthFt > 0)) problems.push("Add a stick length and map its part.");
  if (liveSkus)
    for (const st of [...(series.sticks ?? [])].sort((a, b) => a.lengthFt - b.lengthFt))
      if (!liveSkus.has(st.sku)) problems.push(`Stick ${st.lengthFt}' — ${st.sku} is no longer in the catalog.`);
  const mapped = (role: TrackRole) => {
    const sku = roleSku(series, role);
    return !!sku && (!liveSkus || liveSkus.has(sku));
  };
  const missing = ALWAYS_REQUIRED_ROLES.filter((r) => !mapped(r)).map((r) => TRACK_ROLE_NAMES[r]);
  if (!MOUNTING_ROLES.some(mapped)) missing.push("Batten clamp or Ceiling hanger");
  if (missing.length) problems.push(`Map a part for ${missing.join(", ")}.`);
  return problems;
}

export function canBeActive(series: Pick<TrackSeries, "stickLengthFt" | "parts" | "sticks">, liveSkus?: ReadonlySet<string>): boolean {
  return activationProblems(series, liveSkus).length === 0;
}

/**
 * The roles a track built this way needs a part for (used by pricing, Phase
 * B): the stick or curved section, splice, carrier, master carrier, end stop,
 * the chosen mounting role, and — cord-operated only — the pulleys, floor
 * block and operating line. Pricing checks only the roles the engine actually
 * emitted a quantity for; this is the full structural list.
 */
export function requiredRolesFor(config: { operation: TrackOperation; curved: boolean; mounting: TrackMounting }): TrackRole[] {
  const roles: TrackRole[] = [config.curved ? "curved" : "track", "splice", "carrier", "masterCarrier", "endStop", mountingRole(config.mounting)];
  if (isCordOperated(config.operation)) roles.push(...CORD_ROLES);
  return roles;
}

/**
 * Shape-clean one series (spec §1): trims strings, clamps numbers (> 0, sane
 * maxima — a bad required number falls back to blank/default, a bad optional
 * one is dropped), drops unknown roles and blank SKUs. `active` is kept only
 * when the structural activation check passes, so a hand-edited blob can
 * never yield an active, incomplete series. Returns null for a non-object.
 * The id is kept only when it is a valid slug ("" = let the store allocate).
 */
export function sanitizeTrackSeries(raw: unknown): TrackSeries | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  const id = typeof r.id === "string" && TRACK_SERIES_ID_RE.test(r.id) ? r.id : "";
  const partsRaw = r.parts && typeof r.parts === "object" && !Array.isArray(r.parts) ? (r.parts as Record<string, unknown>) : {};
  const parts: Partial<Record<TrackRole, { sku: string }>> = {};
  for (const role of TRACK_ROLES) {
    const v = partsRaw[role];
    const sku = cleanText(v && typeof v === "object" ? (v as Record<string, unknown>).sku : undefined, TRACK_LIMITS.sku);
    if (sku) parts[role] = { sku };
  }
  const curvedSectionFt = optionalPositive(r.curvedSectionFt, TRACK_LIMITS.curvedSectionFt);
  const minRadiusFt = optionalPositive(r.minRadiusFt, TRACK_LIMITS.minRadiusFt);
  const sticks = cleanSticks(r.sticks);
  const allowance = optionalPositive(r.lineAllowanceFt, TRACK_LIMITS.lineAllowanceFt);
  const overlap = num(r.overlapFt);
  const series: TrackSeries = {
    id,
    name: cleanText(r.name, TRACK_LIMITS.name),
    manufacturer: cleanText(r.manufacturer, TRACK_LIMITS.manufacturer),
    stickLengthFt: sticks.length ? sticks[sticks.length - 1].lengthFt : positive(r.stickLengthFt, TRACK_LIMITS.stickLengthFt, 0),
    ...(curvedSectionFt !== undefined ? { curvedSectionFt } : {}),
    ...(minRadiusFt !== undefined ? { minRadiusFt } : {}),
    carrierSpacingIn: positive(r.carrierSpacingIn, TRACK_LIMITS.carrierSpacingIn, NEW_SERIES_DEFAULTS.carrierSpacingIn),
    hangerSpacingFt: positive(r.hangerSpacingFt, TRACK_LIMITS.hangerSpacingFt, NEW_SERIES_DEFAULTS.hangerSpacingFt),
    overlapFt: Number.isFinite(overlap) && overlap > 0 ? Math.min(overlap, TRACK_LIMITS.overlapFt) : 0,
    parts,
    ...(sticks.length ? { sticks } : {}),
    ...(allowance !== undefined ? { lineAllowanceFt: allowance } : {}),
    active: false,
  };
  if (sticks.length) series.parts.track = { sku: sticks[sticks.length - 1].sku };
  series.active = r.active === true && canBeActive(series);
  const by = cleanText(r.updatedBy, 120);
  const at = num(r.updatedAt);
  if (by) series.updatedBy = by;
  if (Number.isFinite(at) && at > 0) series.updatedAt = at;
  return series;
}

/**
 * The stored blob → a list, sorted by name. The blob is `{ [id]: series |
 * null }` (null = deleted, key kept so the id is never reused); a key that
 * isn't a valid id, or a value that doesn't sanitize to a named series, is
 * skipped. The record's id always equals its key.
 */
export function sanitizeTrackSeriesBlob(raw: unknown): TrackSeries[] {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return [];
  const out: TrackSeries[] = [];
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!TRACK_SERIES_ID_RE.test(key) || value == null) continue;
    const s = sanitizeTrackSeries(value);
    if (!s || !s.name) continue;
    out.push({ ...s, id: key });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name, "en", { sensitivity: "base" }) || a.id.localeCompare(b.id));
}

/** A slug for a new series id, unique against every id already `taken` (incl. deleted ones). */
export function allocateTrackSeriesId(name: string, taken: ReadonlySet<string>): string {
  const base =
    name
      .toLowerCase()
      .replace(/&/g, " ")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 50) || "series";
  if (!taken.has(base)) return base;
  for (let n = 2; ; n++) {
    const id = `${base}-${n}`;
    if (!taken.has(id)) return id;
  }
}
