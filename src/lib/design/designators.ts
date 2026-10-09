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
  effectiveTypeCode,
  typeKeyOfPart,
  typeOfCategory,
  type DeviceType,
  type TypeMap,
} from "./device-types";

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
export type ReadingCtx = { sheetIds: readonly string[]; spaces: ReadonlyArray<SpaceLite> };
/** Numbers `from`…`to` (inclusive) held under one code. */
export type Block = { from: number; to: number };
export type RenumberTarget = { all: true } | { code: string } | { ids: readonly string[] };

const DESIGNATOR_RE = /^(.+?)-(\d{1,6})$/;
const RANGE_RE = /^(.+?-\d{1,6})\s*–\s*\d{1,6}$/;
const byText = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });

/** Trim, strip control chars, collapse spaces, a typed range → its first
 *  number, cap at 24; blank (or not text) → null. */
export function cleanDesignator(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  let s = raw.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
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

/** What a label shows: a lot's range (`LX-1–24`), else the stored text; "" when none. */
export function formatDesignator(stored: string | null | undefined, qty?: number | null): string {
  const text = cleanDesignator(stored);
  if (!text) return "";
  const q = placementQty({ qty });
  const d = q > 1 ? parseDesignator(text) : null;
  return d ? `${d.code}-${d.n}–${d.n + q - 1}` : text;
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
    out.set(pl.id, `${code}-${n}`);
  }
  return out;
}

/** Re-issue the targeted placements' parseable designators, per code, from
 *  the lowest numbers not held by UNtargeted placements of that code (for
 *  `all` / `code` that is from 1), in reading order, each in its own code.
 *  Custom designators are left alone. Returns the changes only. */
export function renumber<P extends DesignatorPlacement>(placements: readonly P[], ctx: ReadingCtx, target: RenumberTarget): Map<string, string> {
  const parsed = new Map<string, { code: string; n: number }>();
  for (const pl of placements) {
    if (pl.curtain) continue;
    const d = parseDesignator(cleanDesignator(pl.designator));
    if (d) parsed.set(pl.id, d);
  }
  const ids = "ids" in target ? new Set(target.ids) : null;
  const want = "code" in target ? target.code.trim().toUpperCase() : null;
  const groups = new Map<string, { hit: P[]; held: Block[] }>();
  for (const pl of placements) {
    const d = parsed.get(pl.id);
    if (!d) continue;
    const key = d.code.toUpperCase();
    const g = groups.get(key) ?? { hit: [], held: [] };
    const targeted = ids ? ids.has(pl.id) : want !== null ? key === want : true;
    if (targeted) g.hit.push(pl);
    else g.held.push({ from: d.n, to: d.n + placementQty(pl) - 1 });
    groups.set(key, g);
  }
  const out = new Map<string, string>();
  for (const g of groups.values()) {
    const blocks = [...g.held];
    for (const pl of readingOrder(g.hit, ctx)) {
      const d = parsed.get(pl.id)!;
      const qty = placementQty(pl);
      const n = nextFree(blocks, qty);
      blocks.push({ from: n, to: n + qty - 1 });
      const next = `${d.code}-${n}`;
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
export function designatorList(items: ReadonlyArray<{ designator?: string | null; qty?: number | null }>): string {
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
    for (const b of merged) parts.push(b.from === b.to ? `${g.code}-${b.from}` : `${g.code}-${b.from}–${b.to}`);
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

export function readingCtxOf(doc: { sheetIds?: readonly string[]; spaces?: ReadonlyArray<SpaceLite> }): ReadingCtx {
  return { sheetIds: doc.sheetIds || [], spaces: doc.spaces || [] };
}

/** Number `optionId`'s missing designators (only `only`, when given) IN
 *  PLACE on a doc a patch is holding. Returns how many it set. */
export function stampDesignators<P extends DesignatorPlacement & { optionId?: string }>(
  doc: DesignatorDoc<P>,
  optionId: string | undefined,
  codeOf: CodeOf<P>,
  only?: ReadonlySet<string>
): number {
  const own = (doc.placements || []).filter((pl) => pl.optionId === optionId);
  const got = assignMissing(own, codeOf, readingCtxOf(doc), only);
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
  codeOf: CodeOf<P>
): number {
  if (!ids.size) return 0;
  const options = new Set((doc.placements || []).filter((pl) => ids.has(pl.id)).map((pl) => pl.optionId));
  let n = 0;
  for (const o of options) n += stampDesignators(doc, o, codeOf, ids);
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
