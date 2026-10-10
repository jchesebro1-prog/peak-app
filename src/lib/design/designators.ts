/* ------------------------------------------------------------------ *
 * The Grid — device designators (#320, spec 2026-10-09).
 *
 * A designator is a device's type code + number (`MIC-1`), numbered per
 * code within ONE design option. A lot marker of qty N holds N consecutive
 * numbers; only its FIRST is stored (`LX-1`) and the range is derived at
 * display time (`LX-1–24`). Anything that doesn't read `<code>-<number>` is
 * a custom designator: shown as typed, never renumbered, never counted for
 * next-free. Curtains never take one — they keep their names.
 *
 * Pure and client-safe (the grid-bom rule): no doc-store, no DB. The store
 * writers, the editor, the schedules, the drawing set and the harness all
 * read these rules. The server-side code resolver lives in
 * designators-server.ts.
 * ------------------------------------------------------------------ */
import { spaceOf, type SpaceLite } from "./grid-geometry";
import { placementQty } from "./grid-bom";
import { DRAWING_SYSTEMS, drawingSystemOf, scopeOfPart, type GridLayer } from "./grid-scopes";
import {
  ALLOWANCE_TYPE,
  ASSEMBLY_TYPE,
  UNMAPPED_TYPE,
  cleanTypeCode,
  effectiveTypeCode,
  typeKeyOfPart,
  typeOfCategory,
  type DeviceType,
  type TypeMap,
} from "./device-types";
import { assignTypeMarks } from "./drawing-labels";

export const DESIGNATOR_MAX = 24;
/** The amber a duplicate designator is drawn in (plan label, Property Editor, Devices tab). */
export const DESIGNATOR_DUPLICATE_COLOR = "#b7791f";
/** Devices whose normalized y differ by less than one band read as one row. */
export const READING_BAND = 0.02;

/** The placement slice these rules read — GridPlacement satisfies it. */
export type DesignatorPlacement = {
  id: string;
  sheetId: string;
  page: number;
  x: number;
  y: number;
  partId: string;
  designator?: string;
  qty?: number;
  curtain?: unknown;
  category?: string;
};
export type CodeOf<P = DesignatorPlacement> = (pl: P) => string;
/** `digits` (#321): how many digits an issued number is padded to — 2 reads
 *  `CRO-01`; absent = 1, so pure callers that don't pass it print `CRO-1`. */
export type ReadingCtx = { sheetIds: readonly string[]; spaces: ReadonlyArray<SpaceLite>; digits?: 1 | 2 };
/** Numbers `from`…`to` (inclusive) held under one code. */
export type Block = { from: number; to: number };
/** Which devices Renumber re-issues. `recode` ("Apply current type codes")
 *  re-issues them in each device's CURRENT type code instead of the code its
 *  designator was written in. */
export type RenumberTarget = ({ all: true } | { code: string } | { ids: readonly string[] }) & { recode?: boolean };

const DESIGNATOR_RE = /^(.+?)-(\d{1,6})$/;
const RANGE_RE = /^(.+?-\d{1,6})\s*–\s*\d{1,6}$/;
const byText = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });

/** Invisible characters a pasted designator can carry: the soft hyphen,
 *  zero-width spaces/joiners, LRM/RLM/ALM marks, the word joiner, the BOM,
 *  and bidi embeddings/overrides/isolates — removed. */
const INVISIBLE_RE = /[\u00ad\u061c\u200b-\u200f\u2060\ufeff\u202a-\u202e\u2066-\u2069]/g;
/** C0 and C1 control characters and DEL — read as a space. */
const CONTROL_RE = /[\u0000-\u001f\u007f-\u009f]/g;

/** Trim, strip control and invisible chars, collapse spaces (none around a
 *  "-": `MIC - 1` → `MIC-1`), a typed range → its first number, cap at 24;
 *  blank (or not text) → null. */
export function cleanDesignator(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  let s = raw.replace(INVISIBLE_RE, "").replace(CONTROL_RE, " ").replace(/\s+/g, " ").replace(/ ?- ?/g, "-").trim();
  const range = RANGE_RE.exec(s);
  if (range) s = range[1];
  s = s.slice(0, DESIGNATOR_MAX).trim();
  return s || null;
}

/** `<code>-<number>` (code kept as written, number ≥ 1); else null = custom. */
export function parseDesignator(s: string | null | undefined): { code: string; n: number } | null {
  const m = DESIGNATOR_RE.exec((s ?? "").trim());
  if (!m) return null;
  const n = Number(m[2]);
  return n >= 1 ? { code: m[1], n } : null;
}

/** A number as printed: `7` → `07` at two digits, `123` → `123`, `7` → `7` at one. */
export function formatDesignatorNumber(n: number, digits: 1 | 2 = 1): string {
  return digits === 2 && n < 10 ? `0${n}` : String(n);
}

/** What a label shows: a lot's range (`LX-1–24`, `LX-01–24` at two digits),
 *  else the stored text; "" when none. */
export function formatDesignator(stored: string | null | undefined, qty?: number | null, digits: 1 | 2 = 1): string {
  const text = cleanDesignator(stored);
  if (!text) return "";
  const q = placementQty({ qty });
  const d = q > 1 ? parseDesignator(text) : null;
  return d ? `${d.code}-${formatDesignatorNumber(d.n, digits)}–${formatDesignatorNumber(d.n + q - 1, digits)}` : text;
}

/** Per code (upper-cased key), the blocks held — a lot holds its whole block.
 *  Curtains and custom designators hold nothing. */
export function occupied(placements: readonly DesignatorPlacement[]): Map<string, Block[]> {
  const out = new Map<string, Block[]>();
  for (const pl of placements) {
    if (pl.curtain) continue;
    const d = parseDesignator(cleanDesignator(pl.designator));
    if (!d) continue;
    const key = d.code.toUpperCase();
    const list = out.get(key) ?? [];
    list.push({ from: d.n, to: d.n + placementQty(pl) - 1 });
    out.set(key, list);
  }
  return out;
}

/** The lowest n ≥ 1 such that n … n+qty−1 are all free. */
export function nextFree(blocks: readonly Block[], qty = 1): number {
  const need = Math.max(1, Math.floor(qty) || 1);
  let n = 1;
  for (const b of [...blocks].sort((a, c) => a.from - c.from)) {
    if (b.to < n) continue;
    if (n + need - 1 < b.from) return n;
    n = b.to + 1;
  }
  return n;
}

/** Sheet order, page, space (project order by the containing space —
 *  spaceOf, smallest wins — devices in no space last), rows of READING_BAND
 *  top to bottom, then left to right; id breaks ties. */
export function readingOrder<P extends DesignatorPlacement>(placements: readonly P[], ctx: ReadingCtx): P[] {
  const sheetIdx = new Map(ctx.sheetIds.map((id, i) => [id, i]));
  const spaces = [...ctx.spaces];
  const spaceIdx = new Map(spaces.map((s, i) => [s.id, i]));
  const LAST = Number.MAX_SAFE_INTEGER;
  const keyed = placements.map((pl) => {
    const home = spaceOf(pl, spaces);
    return { pl, k: [sheetIdx.get(pl.sheetId) ?? LAST, pl.page, home ? spaceIdx.get(home.id) ?? LAST : LAST, Math.floor(pl.y / READING_BAND), pl.x] };
  });
  keyed.sort((a, b) => {
    for (let i = 0; i < a.k.length; i++) if (a.k[i] !== b.k[i]) return a.k[i] - b.k[i];
    return a.pl.id < b.pl.id ? -1 : a.pl.id > b.pl.id ? 1 : 0;
  });
  return keyed.map((e) => e.pl);
}

/** Every non-curtain placement WITHOUT a designator (limited to `only` when
 *  given) gets the next free number for its code, in reading order. Never
 *  touches one that has a designator. Returns id → designator. */
export function assignMissing<P extends DesignatorPlacement>(
  placements: readonly P[],
  codeOf: CodeOf<P>,
  ctx: ReadingCtx,
  only?: ReadonlySet<string>
): Map<string, string> {
  const occ = occupied(placements);
  const out = new Map<string, string>();
  const need = placements.filter((pl) => !pl.curtain && !cleanDesignator(pl.designator) && (!only || only.has(pl.id)));
  for (const pl of readingOrder(need, ctx)) {
    const code = codeOf(pl);
    const key = code.toUpperCase();
    const qty = placementQty(pl);
    const blocks = occ.get(key) ?? [];
    const n = nextFree(blocks, qty);
    blocks.push({ from: n, to: n + qty - 1 });
    occ.set(key, blocks);
    out.set(pl.id, `${code}-${formatDesignatorNumber(n, ctx.digits)}`);
  }
  return out;
}

/** Re-issue the targeted placements' parseable designators, per code, from
 *  the lowest numbers not held by UNtargeted placements of that code (for
 *  `all` / `code` that is from 1), in reading order, each in its own code.
 *  Custom designators are left alone. Returns the changes only.
 *
 *  `recode` (with `codeOf`, the device's current type code): each targeted
 *  device is re-issued in `codeOf(pl)` instead of the code it was written in
 *  — numbered exactly as above, against the untargeted devices already
 *  holding numbers in that code — and a `code` target picks devices by their
 *  current code. Without `codeOf`, `recode` is ignored. */
export function renumber<P extends DesignatorPlacement>(
  placements: readonly P[],
  ctx: ReadingCtx,
  target: RenumberTarget,
  codeOf?: CodeOf<P>
): Map<string, string> {
  const recode = target.recode === true && !!codeOf;
  const ids = "ids" in target ? new Set(target.ids) : null;
  const want = "code" in target ? target.code.trim().toUpperCase() : null;
  const codeFor = new Map<string, string>();
  const groups = new Map<string, { hit: P[]; held: Block[] }>();
  for (const pl of placements) {
    if (pl.curtain) continue;
    const d = parseDesignator(cleanDesignator(pl.designator));
    if (!d) continue;
    const now = recode ? codeOf!(pl) : d.code;
    const targeted = ids ? ids.has(pl.id) : want !== null ? now.toUpperCase() === want : true;
    const code = targeted ? now : d.code;
    const key = code.toUpperCase();
    const g = groups.get(key) ?? { hit: [], held: [] };
    if (targeted) {
      g.hit.push(pl);
      codeFor.set(pl.id, code);
    } else g.held.push({ from: d.n, to: d.n + placementQty(pl) - 1 });
    groups.set(key, g);
  }
  const out = new Map<string, string>();
  for (const g of groups.values()) {
    const blocks = [...g.held];
    for (const pl of readingOrder(g.hit, ctx)) {
      const qty = placementQty(pl);
      const n = nextFree(blocks, qty);
      blocks.push({ from: n, to: n + qty - 1 });
      const next = `${codeFor.get(pl.id)!}-${formatDesignatorNumber(n, ctx.digits)}`;
      if (next !== pl.designator) out.set(pl.id, next);
    }
  }
  return out;
}

/** Ids whose number block overlaps another's in the same code, or whose
 *  custom text equals another's (case-insensitive). Curtains ignored. */
export function duplicates(placements: readonly DesignatorPlacement[]): Set<string> {
  const out = new Set<string>();
  const byCode = new Map<string, Array<{ id: string } & Block>>();
  const custom = new Map<string, string[]>();
  for (const pl of placements) {
    if (pl.curtain) continue;
    const text = cleanDesignator(pl.designator);
    if (!text) continue;
    const d = parseDesignator(text);
    if (d) {
      const key = d.code.toUpperCase();
      const list = byCode.get(key) ?? [];
      list.push({ id: pl.id, from: d.n, to: d.n + placementQty(pl) - 1 });
      byCode.set(key, list);
    } else {
      const key = text.toLowerCase();
      custom.set(key, [...(custom.get(key) ?? []), pl.id]);
    }
  }
  for (const list of byCode.values()) {
    list.sort((a, b) => a.from - b.from || a.to - b.to);
    let reach = -Infinity;
    let holder = "";
    for (const b of list) {
      if (b.from <= reach) {
        out.add(b.id);
        out.add(holder);
      }
      if (b.to > reach) {
        reach = b.to;
        holder = b.id;
      }
    }
  }
  for (const ids of custom.values()) if (ids.length > 1) for (const id of ids) out.add(id);
  return out;
}

/** A schedule cell: per code (sorted), consecutive numbers as ranges
 *  (`MIC-1–4, MIC-7`), then custom ones in text order. */
export function designatorList(items: ReadonlyArray<{ designator?: string | null; qty?: number | null }>, digits: 1 | 2 = 1): string {
  const codes = new Map<string, { code: string; blocks: Block[] }>();
  const custom = new Map<string, string>();
  for (const it of items) {
    const text = cleanDesignator(it.designator);
    if (!text) continue;
    const d = parseDesignator(text);
    if (!d) {
      const k = text.toLowerCase();
      if (!custom.has(k)) custom.set(k, text);
      continue;
    }
    const key = d.code.toUpperCase();
    const g = codes.get(key) ?? { code: d.code, blocks: [] };
    g.blocks.push({ from: d.n, to: d.n + placementQty(it) - 1 });
    codes.set(key, g);
  }
  const parts: string[] = [];
  for (const key of [...codes.keys()].sort(byText)) {
    const g = codes.get(key)!;
    const merged: Block[] = [];
    for (const b of [...g.blocks].sort((a, c) => a.from - c.from)) {
      const last = merged[merged.length - 1];
      if (last && b.from <= last.to + 1) last.to = Math.max(last.to, b.to);
      else merged.push({ ...b });
    }
    for (const b of merged) parts.push(b.from === b.to ? `${g.code}-${formatDesignatorNumber(b.from, digits)}` : `${g.code}-${formatDesignatorNumber(b.from, digits)}–${formatDesignatorNumber(b.to, digits)}`);
  }
  parts.push(...[...custom.values()].sort(byText));
  return parts.join(", ");
}

/* ------------------------------ codes ------------------------------ */

/** The part slice the code resolver reads — PartLite satisfies it. */
export type CodePart = {
  id?: string;
  category?: string;
  deviceType?: string | null;
  kind?: string;
  allowance?: boolean;
  gridScope?: string | null;
  group?: string | null;
  trade?: string | null;
  /** #321: a per-part code (Bray's CRO for a relay output) — wins over the device type's. */
  designatorCode?: string | null;
};
export type TypeCodeCtx = { types: readonly DeviceType[]; map: TypeMap };

/** The drawing set's system letter for a scope: L / A / V / R / G. */
export function systemLetterOf(scope: GridLayer): string {
  const key = drawingSystemOf(scope);
  return DRAWING_SYSTEMS.find((s) => s.key === key)?.prefix ?? "G";
}

/** part → its device type's code; an unmapped part → the placement's, then
 *  the part's, raw category through the type map; else the system letter
 *  (assemblies, allowances, archived types, unknown parts). */
export function codeOfPlacement(pl: { category?: string }, part: CodePart | null | undefined, ctx: TypeCodeCtx): string {
  const own = cleanTypeCode(part?.designatorCode);
  if (own) return own;
  const codeOfType = (key: string | null) => {
    const t = key ? ctx.types.find((x) => x.key === key && !x.archived) : undefined;
    return t ? effectiveTypeCode(t) : null;
  };
  const key = typeKeyOfPart(part);
  if (key === UNMAPPED_TYPE) {
    for (const cat of [pl.category, part?.category]) {
      const c = cat ? codeOfType(typeOfCategory(cat, ctx.map, ctx.types)) : null;
      if (c) return c;
    }
  } else if (key !== ASSEMBLY_TYPE && key !== ALLOWANCE_TYPE) {
    const c = codeOfType(key);
    if (c) return c;
  }
  return systemLetterOf(scopeOfPart(part));
}

/** codeOfPlacement over a part-by-id map. */
export function designatorCodeOf(partById: ReadonlyMap<string, CodePart>, ctx: TypeCodeCtx): CodeOf<{ partId: string; category?: string }> {
  return (pl) => codeOfPlacement(pl, partById.get(pl.partId), ctx);
}

/** Replace part: whether a device keeps its designator when its part
 *  changes. A number issued in the OLD type's code is re-issued in the new
 *  one when the code changes; a custom or hand-renamed designator is kept. */
export function keepsDesignatorOnSwap(designator: string | null | undefined, oldCode: string, newCode: string): boolean {
  const text = cleanDesignator(designator);
  if (!text) return false;
  const d = parseDesignator(text);
  if (!d) return true;
  return d.code.toUpperCase() !== oldCode.toUpperCase() || newCode.toUpperCase() === oldCode.toUpperCase();
}

/* ------------------------------ docs ------------------------------ */

export type DesignatorDoc<P> = { placements?: P[]; sheetIds?: readonly string[]; spaces?: ReadonlyArray<SpaceLite> };

export function readingCtxOf(doc: { sheetIds?: readonly string[]; spaces?: ReadonlyArray<SpaceLite> }, digits?: 1 | 2): ReadingCtx {
  return { sheetIds: doc.sheetIds || [], spaces: doc.spaces || [], ...(digits ? { digits } : {}) };
}

/** Number `optionId`'s missing designators (only `only`, when given) IN
 *  PLACE on a doc a patch is holding. Returns how many it set. */
export function stampDesignators<P extends DesignatorPlacement & { optionId?: string }>(
  doc: DesignatorDoc<P>,
  optionId: string | undefined,
  codeOf: CodeOf<P>,
  only?: ReadonlySet<string>,
  digits?: 1 | 2
): number {
  const own = (doc.placements || []).filter((pl) => pl.optionId === optionId);
  const got = assignMissing(own, codeOf, readingCtxOf(doc, digits), only);
  if (!got.size) return 0;
  doc.placements = (doc.placements || []).map((pl) => {
    const d = got.get(pl.id);
    return d ? { ...pl, designator: d } : pl;
  });
  return got.size;
}

/** stampDesignators for just-written ids, each option numbered on its own. */
export function stampNewDesignators<P extends DesignatorPlacement & { optionId?: string }>(
  doc: DesignatorDoc<P>,
  ids: ReadonlySet<string>,
  codeOf: CodeOf<P>,
  digits?: 1 | 2
): number {
  if (!ids.size) return 0;
  const options = new Set((doc.placements || []).filter((pl) => ids.has(pl.id)).map((pl) => pl.optionId));
  let n = 0;
  for (const o of options) n += stampDesignators(doc, o, codeOf, ids, digits);
  return n;
}

/** A device without a designator, or a curtain carrying one. */
export function needsDesignators(placements: readonly DesignatorPlacement[]): boolean {
  return placements.some((pl) => (pl.curtain ? pl.designator !== undefined : !cleanDesignator(pl.designator)));
}

/** A copy with every missing designator filled (assignMissing's numbers) —
 *  for read-only paths (schedule, drawing set) that must never write. */
export function fillDesignators<P extends DesignatorPlacement>(placements: readonly P[], codeOf: CodeOf<P>, ctx: ReadingCtx): P[] {
  const got = assignMissing(placements, codeOf, ctx);
  return placements.map((pl) => {
    const d = got.get(pl.id);
    return d ? { ...pl, designator: d } : pl;
  });
}

/* ------------------------------ drawing set ------------------------------ */

export type PlanMarkItem = { id: string; key: string; desc: string; qty: number; designator?: string; curtain: boolean };

/**
 * A plan sheet's marks (#320): each device prints its designator (a lot by
 * its range) where the type mark sat; a curtain keeps its per-sheet type
 * mark (assignTypeMarks, the system-letter prefix). The device key is one
 * row per part (per named curtain), first-seen order: designators
 * (designatorList) · units · description. Tags are keyed by placement id.
 */
export function planDesignatorMarks(items: ReadonlyArray<PlanMarkItem>, prefix: string, digits: 1 | 2 = 1): { tags: Map<string, string>; rows: Array<{ tag: string; qty: number; desc: string }> } {
  const curtainMarks = assignTypeMarks(items.filter((it) => it.curtain).map((it) => ({ key: it.key, desc: it.desc, qty: it.qty })), prefix);
  const tags = new Map<string, string>();
  const order: string[] = [];
  const groups = new Map<string, { curtain: boolean; desc: string; qty: number; list: Array<{ designator?: string; qty: number }> }>();
  for (const it of items) {
    tags.set(it.id, it.curtain ? curtainMarks.tags.get(it.key) || "" : formatDesignator(it.designator, it.qty, digits));
    let g = groups.get(it.key);
    if (!g) {
      g = { curtain: it.curtain, desc: it.desc, qty: 0, list: [] };
      groups.set(it.key, g);
      order.push(it.key);
    }
    g.qty += it.qty;
    g.list.push({ designator: it.designator, qty: it.qty });
  }
  const rows = order.map((key) => {
    const g = groups.get(key)!;
    return { tag: g.curtain ? curtainMarks.tags.get(key) || "" : designatorList(g.list, digits), qty: g.qty, desc: g.desc };
  });
  return { tags, rows };
}
