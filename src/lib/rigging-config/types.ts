/**
 * Pipe and lineset types (#373) — the parts maps behind the two configurators.
 * Pure, client-safe. The store is src/lib/stores/rigging-types.ts (one settings
 * blob each, one key per type id, a delete leaves a null so an id is never
 * reused); nothing is seeded and nothing here carries a price.
 */

export type PipeStick = { lengthFt: number; sku: string };

export type PipeType = {
  /** Stable slug, server-allocated. */
  id: string;
  name: string;
  manufacturer: string;
  /** Ascending. Source of truth for every length the type buys. */
  sticks: PipeStick[];
  /** Only required once a run needs a splice (pricing blocks by name). */
  spliceSku?: string;
  clampSku?: string;
  hangerSpacingFt: number;
  active: boolean;
  updatedBy?: string;
  updatedAt?: number;
};

export type LinesetRole = "cable" | "handLine" | "termination" | "chainWrap";
export type LinesetSource = { kind: "part"; sku: string } | { kind: "assembly"; id: string };

export type LinesetType = {
  id: string;
  name: string;
  manufacturer: string;
  parts: Partial<Record<LinesetRole, LinesetSource>>;
  /** Extra cable per lift line, ft. 0 is a real value. */
  allowanceFt: number;
  active: boolean;
  updatedBy?: string;
  updatedAt?: number;
};

/** The inputs a pipe line stores. Blank spacing = the type's. */
export type PipeConfig = { typeId: string; runFt: number; qty: number; hangerSpacingFt?: number; label?: string };
/** The inputs a lineset line stores. Blank lines / allowance = the defaults. */
export type LinesetConfig = { typeId: string; sets: number; widthFt: number; gridHeightFt: number; linesPerSet?: number; allowanceFt?: number; label?: string };
/** `SpecItem.rigging`: which configurator reopens the line, and its inputs. */
export type RiggingConfig = ({ kind: "pipe" } & PipeConfig) | ({ kind: "lineset" } & LinesetConfig);

export const PIPE_TYPES_BLOB = "pipe_types";
export const LINESET_TYPES_BLOB = "lineset_types";
export const RIGGING_TYPE_ID_RE = /^[a-z0-9][a-z0-9-]{0,59}$/;
export const DEFAULT_PIPE_SPACING_FT = 10;
export const DEFAULT_CABLE_ALLOWANCE_FT = 10;
export const PIPE_TYPES_HREF = "/estimating-rules/pipe-types";
export const LINESET_TYPES_HREF = "/estimating-rules/lineset-types";
export const PIPE_TYPES_HOME = "Estimating Rules → Pipe types";
export const LINESET_TYPES_HOME = "Estimating Rules → Lineset types";

export const RIGGING_LIMITS = {
  stickLengthFt: 60,
  sticks: 12,
  hangerSpacingFt: 40,
  minHangerSpacingFt: 1,
  allowanceFt: 200,
  name: 80,
  manufacturer: 60,
  sku: 120,
  assemblyId: 120,
} as const;

export const LINESET_ROLES: readonly LinesetRole[] = ["cable", "handLine", "termination", "chainWrap"];
export const LINESET_ROLE_NAMES: Record<LinesetRole, string> = {
  cable: "Aircraft cable",
  handLine: "Hand line",
  termination: "Terminations",
  chainWrap: "Chain wraps",
};
/** The Rules screen's role note: how the configurator counts each. */
export const LINESET_ROLE_NOTES: Record<LinesetRole, string> = {
  cable: "Priced per foot",
  handLine: "Priced per foot",
  termination: "2 per lift line",
  chainWrap: "1 per lift line",
};

/** A catalog unit that sells by the foot. Unit text varies, so callers warn and never block. */
export function isFootUnit(unit: unknown): boolean {
  return typeof unit === "string" && ["ft", "foot", "feet", "lf"].includes(unit.trim().toLowerCase());
}

function cleanText(v: unknown, max: number): string {
  return typeof v === "string" ? v.trim().replace(/\s+/g, " ").slice(0, max) : "";
}

function num(v: unknown): number {
  if (typeof v === "number") return v;
  if (typeof v === "string" && v.trim() !== "") return Number(v);
  return NaN;
}

function cleanSticks(v: unknown): PipeStick[] {
  if (!Array.isArray(v)) return [];
  const byLength = new Map<number, PipeStick>();
  for (const e of v) {
    if (!e || typeof e !== "object" || Array.isArray(e)) continue;
    const r = e as Record<string, unknown>;
    const n = num(r.lengthFt);
    const lengthFt = Number.isFinite(n) && n > 0 ? Math.min(n, RIGGING_LIMITS.stickLengthFt) : 0;
    const sku = cleanText(r.sku, RIGGING_LIMITS.sku);
    if (!(lengthFt > 0) || !sku || byLength.has(lengthFt)) continue;
    byLength.set(lengthFt, { lengthFt, sku });
  }
  return [...byLength.values()].sort((a, b) => a.lengthFt - b.lengthFt).slice(0, RIGGING_LIMITS.sticks);
}

function cleanSource(v: unknown): LinesetSource | null {
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  const r = v as Record<string, unknown>;
  if (r.kind === "part") {
    const sku = cleanText(r.sku, RIGGING_LIMITS.sku);
    return sku ? { kind: "part", sku } : null;
  }
  if (r.kind === "assembly") {
    const id = cleanText(r.id, RIGGING_LIMITS.assemblyId);
    return id ? { kind: "assembly", id } : null;
  }
  return null;
}

/** Everything that stops a pipe type being Active; `liveSkus` = the SKUs still in the catalog. Empty = can be active. */
export function pipeTypeProblems(t: Pick<PipeType, "sticks" | "spliceSku" | "clampSku" | "hangerSpacingFt">, liveSkus?: ReadonlySet<string>): string[] {
  const problems: string[] = [];
  const live = (sku: string | undefined) => !!sku && (!liveSkus || liveSkus.has(sku));
  if (!t.sticks.length) problems.push("Add a stick length and map its part.");
  for (const s of t.sticks) if (!live(s.sku)) problems.push(`Stick ${s.lengthFt}' — ${s.sku} is no longer in the catalog.`);
  if (!live(t.clampSku)) problems.push("Map a part for Hanging clamps.");
  if (!(t.hangerSpacingFt > 0)) problems.push("Enter a hanger spacing.");
  return problems;
}

/** Everything that stops a lineset type being Active. `live`: the SKUs in the catalog and the live Hardware assembly ids. */
export function linesetTypeProblems(t: Pick<LinesetType, "parts">, live?: { skus: ReadonlySet<string>; assemblyIds: ReadonlySet<string> }): string[] {
  const usable = (s: LinesetSource | undefined) => !!s && (!live || (s.kind === "part" ? live.skus.has(s.sku) : live.assemblyIds.has(s.id)));
  const missing = LINESET_ROLES.filter((r) => !usable(t.parts[r])).map((r) => LINESET_ROLE_NAMES[r]);
  return missing.length ? [`Map ${missing.join(", ")}.`] : [];
}

/**
 * The Rules screens' SAVE check on the raw input. The sanitizers below stay
 * tolerant for reading stored blobs; a save must not silently repair what the
 * user typed. Null = fine.
 */
export function pipeTypeInputError(raw: unknown): string | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  const spacing = num(r.hangerSpacingFt);
  if (!(Number.isFinite(spacing) && spacing > 0)) return "Enter a hanger spacing.";
  if (spacing < RIGGING_LIMITS.minHangerSpacingFt) return `Hanger spacing is at least ${RIGGING_LIMITS.minHangerSpacingFt}'.`;
  if (Array.isArray(r.sticks)) {
    const seen = new Set<number>();
    for (const e of r.sticks) {
      if (!e || typeof e !== "object" || Array.isArray(e)) continue;
      const n = num((e as Record<string, unknown>).lengthFt);
      if (!(Number.isFinite(n) && n > 0)) continue;
      if (n > RIGGING_LIMITS.stickLengthFt) return `A stick is at most ${RIGGING_LIMITS.stickLengthFt}'.`;
      if (seen.has(n)) return "Each stick length can only appear once.";
      seen.add(n);
    }
  }
  return null;
}

export function linesetTypeInputError(raw: unknown): string | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const allowance = num((raw as Record<string, unknown>).allowanceFt);
  if (!(Number.isFinite(allowance) && allowance >= 0)) return "Enter a cable allowance of 0 or more.";
  return null;
}

/** Shape-clean one pipe type. `active` survives only when the structural check passes. Null for a non-object. */
export function sanitizePipeType(raw: unknown): PipeType | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  const spacing = num(r.hangerSpacingFt);
  const spliceSku = cleanText(r.spliceSku, RIGGING_LIMITS.sku);
  const clampSku = cleanText(r.clampSku, RIGGING_LIMITS.sku);
  const t: PipeType = {
    id: typeof r.id === "string" && RIGGING_TYPE_ID_RE.test(r.id) ? r.id : "",
    name: cleanText(r.name, RIGGING_LIMITS.name),
    manufacturer: cleanText(r.manufacturer, RIGGING_LIMITS.manufacturer),
    sticks: cleanSticks(r.sticks),
    ...(spliceSku ? { spliceSku } : {}),
    ...(clampSku ? { clampSku } : {}),
    hangerSpacingFt: Number.isFinite(spacing) && spacing > 0 ? Math.min(spacing, RIGGING_LIMITS.hangerSpacingFt) : DEFAULT_PIPE_SPACING_FT,
    active: false,
  };
  t.active = r.active === true && pipeTypeProblems(t).length === 0;
  const by = cleanText(r.updatedBy, 120);
  const at = num(r.updatedAt);
  if (by) t.updatedBy = by;
  if (Number.isFinite(at) && at > 0) t.updatedAt = at;
  return t;
}

/** Shape-clean one lineset type. Null for a non-object. */
export function sanitizeLinesetType(raw: unknown): LinesetType | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  const partsRaw = r.parts && typeof r.parts === "object" && !Array.isArray(r.parts) ? (r.parts as Record<string, unknown>) : {};
  const parts: LinesetType["parts"] = {};
  for (const role of LINESET_ROLES) {
    const s = cleanSource(partsRaw[role]);
    if (s) parts[role] = s;
  }
  const allowance = num(r.allowanceFt);
  const t: LinesetType = {
    id: typeof r.id === "string" && RIGGING_TYPE_ID_RE.test(r.id) ? r.id : "",
    name: cleanText(r.name, RIGGING_LIMITS.name),
    manufacturer: cleanText(r.manufacturer, RIGGING_LIMITS.manufacturer),
    parts,
    allowanceFt: Number.isFinite(allowance) && allowance >= 0 ? Math.min(allowance, RIGGING_LIMITS.allowanceFt) : DEFAULT_CABLE_ALLOWANCE_FT,
    active: false,
  };
  t.active = r.active === true && linesetTypeProblems(t).length === 0;
  const by = cleanText(r.updatedBy, 120);
  const at = num(r.updatedAt);
  if (by) t.updatedBy = by;
  if (Number.isFinite(at) && at > 0) t.updatedAt = at;
  return t;
}

function fromBlob<T extends { id: string; name: string }>(raw: unknown, clean: (v: unknown) => T | null): T[] {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return [];
  const out: T[] = [];
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!RIGGING_TYPE_ID_RE.test(key) || value == null) continue;
    const t = clean(value);
    if (!t || !t.name) continue;
    out.push({ ...t, id: key });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name, "en", { sensitivity: "base" }) || a.id.localeCompare(b.id));
}

export const sanitizePipeTypeBlob = (raw: unknown): PipeType[] => fromBlob(raw, sanitizePipeType);
export const sanitizeLinesetTypeBlob = (raw: unknown): LinesetType[] => fromBlob(raw, sanitizeLinesetType);

/** Every catalog SKU a pipe type names — what a page must read from the catalog. */
export function pipeTypeSkus(t: Pick<PipeType, "sticks" | "spliceSku" | "clampSku">): string[] {
  return [...new Set([...t.sticks.map((s) => s.sku), t.spliceSku, t.clampSku].filter((s): s is string => !!s))];
}

/** Every catalog SKU a lineset type names directly (assembly members come with the assembly). */
export function linesetTypeSkus(t: Pick<LinesetType, "parts">): string[] {
  return [...new Set(Object.values(t.parts).flatMap((s) => (s?.kind === "part" ? [s.sku] : [])))];
}
