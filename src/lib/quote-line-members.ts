/**
 * #332 — an assembly line's members, for every datasheet / photo / BOM read
 * that keys off a line's SKU. Pure and client-safe (no store, no db).
 *
 * An Estimator "+ Add assembly" line is ONE line whose `sku` is the assembly
 * id ("SA-…" / "fa-…"), with the chosen parts in `components`; a portal
 * fixture line names its light engine and carries the same `components`; a
 * rack line (`rackId`, D578) and a Grid `asm:<id>` virtual part resolve live.
 * A track line's priced parts ride in `components` too (real catalog parts),
 * so it expands the same way.
 *
 * The rule, in order:
 *  1. a rack line whose rack still resolves (through `fixtureOf`) → the rack's
 *     LIVE members (gridSpecBomRows — the #296 quote BOM rule, unchanged);
 *  2. `components` with a SKU and qty > 0 → those members × the line qty
 *     (an optional add-on left at 0 is not on the line);
 *  3. an `asm:` sku, a `fixtureId`, or a `fixture: true` line naming an
 *     assembly id → that assembly's live included members (gridSpecBomRows);
 *  4. otherwise the line is not an assembly (`expandLine` → null) and stands
 *     for itself.
 * Labor members (a Grid labor id, or a SKU `isInternal` flags) are left out,
 * as gridSpecBomRows leaves them out of a rack.
 *
 * The PRIMARY member is what the assembly's photo / key-product datasheet
 * borrows (Jeff, #332): the light engine (role "fixture" / the record's
 * `lightEngineSku`), else the first included member.
 */
import { gridSpecBomRows, parseVirtualPartId } from "@/lib/design/grid-virtual-parts";
import { isLaborSku } from "@/lib/design/wire-labor";
import type { FixtureResolvable } from "@/lib/fixture-assemblies";

/** The fields a member read looks at — any saved line shape (estimator item, Grid line, raw JSON). */
export type MemberLine = {
  sku?: unknown;
  desc?: unknown;
  qty?: unknown;
  fixture?: unknown;
  components?: unknown;
  rackId?: unknown;
  fixtureId?: unknown;
};
export type MemberRow = { sku: string; desc: string; qty: number; primary?: true };
export type FixtureLookup = (id: string) => FixtureResolvable | null | undefined;

type Comp = { sku: string; label: string; role: string; qty: number };

const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "");
const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

/** The line's components that are on it: a SKU and qty > 0. */
function onComponents(item: MemberLine): Comp[] {
  if (!Array.isArray(item.components)) return [];
  const out: Comp[] = [];
  for (const raw of item.components) {
    if (!raw || typeof raw !== "object") continue;
    const c = raw as Record<string, unknown>;
    const sku = str(c.sku);
    const qty = num(c.qty);
    if (!sku || !(qty > 0)) continue;
    out.push({ sku, label: str(c.label), role: str(c.role), qty });
  }
  return out;
}

/** The assembly id a line resolves live through, else null. */
function liveAssemblyId(item: MemberLine): string | null {
  const sku = str(item.sku);
  const ref = sku ? parseVirtualPartId(sku) : null;
  if (ref?.kind === "assembly") return ref.id;
  const fid = str(item.fixtureId);
  if (fid) return fid;
  if (item.fixture === true && sku) return sku;
  return null;
}

function markPrimary(rows: Array<{ sku: string; desc: string; qty: number }>, primarySku: string | null): MemberRow[] {
  const at = primarySku ? rows.findIndex((r) => r.sku === primarySku) : -1;
  const pick = at >= 0 ? at : 0;
  return rows.map((r, i) => (i === pick ? { sku: r.sku, desc: r.desc, qty: r.qty, primary: true as const } : { sku: r.sku, desc: r.desc, qty: r.qty }));
}

/** Live members through gridSpecBomRows, or null when the assembly doesn't resolve / has no member. */
function liveMembers(id: string, item: MemberLine, qty: number, fixtureOf: FixtureLookup, isInternal?: (sku: string) => boolean): MemberRow[] | null {
  const f = fixtureOf(id);
  if (!f) return null;
  const rows = gridSpecBomRows([{ sku: `asm:${id}`, desc: str(item.desc), qty }], fixtureOf, isInternal);
  // A member-less assembly comes back as one SKU-less row; [] = every member was labor (nothing to list).
  if (!rows.every((r) => r.sku)) return null;
  return markPrimary(rows, f.kind === "fixture" ? f.lightEngineSku || null : null);
}

/**
 * The members an assembly line stands for, or null when the line is not an
 * assembly (or nothing behind it resolves) — the caller then treats the line
 * as itself. [] = an assembly whose every member is labor.
 */
export function expandLine(item: MemberLine | null | undefined, fixtureOf?: FixtureLookup, isInternal?: (sku: string) => boolean): MemberRow[] | null {
  if (!item || typeof item !== "object") return null;
  const qty = num(item.qty);
  const rackId = str(item.rackId);
  if (rackId && fixtureOf && fixtureOf(rackId)?.kind === "rack") {
    const live = liveMembers(rackId, item, qty, fixtureOf, isInternal);
    if (live) return live;
  }
  const comps = onComponents(item);
  if (comps.length) {
    const kept = comps.filter((c) => !isLaborSku(c.sku) && !isInternal?.(c.sku));
    const engine = kept.find((c) => c.role === "fixture");
    return markPrimary(
      kept.map((c) => ({ sku: c.sku, desc: c.label || c.sku, qty: qty * c.qty })),
      engine ? engine.sku : null,
    );
  }
  const id = liveAssemblyId(item);
  if (id && fixtureOf) return liveMembers(id, item, qty, fixtureOf, isInternal);
  return null;
}

/** Every row a line stands for: its members, else itself (one primary row). Optional members are never listed. */
export function lineMemberRows(item: MemberLine, fixtureOf?: FixtureLookup, isInternal?: (sku: string) => boolean): MemberRow[] {
  const members = expandLine(item, fixtureOf, isInternal);
  if (members) return members;
  return [{ sku: str(item?.sku), desc: str(item?.desc), qty: num(item?.qty), primary: true }];
}

/** The member an assembly line's photo / key-product datasheet borrows, or
 *  null when the line is not an assembly (or has no member). */
export function primaryMemberSku(item: MemberLine, fixtureOf?: FixtureLookup): string | null {
  return expandLine(item, fixtureOf)?.find((r) => r.primary)?.sku ?? null;
}

/** True when a line can only expand through a live fixture read (racks are
 *  always read live, D578): a caller loads the fixtures only when some line
 *  says yes. */
export function needsFixtureLookup(item: MemberLine | null | undefined): boolean {
  if (!item || typeof item !== "object") return false;
  if (str(item.rackId)) return true;
  if (onComponents(item).length) return false;
  return liveAssemblyId(item) !== null;
}

/**
 * Assembly line SKU → its primary member's SKU, over every line given
 * (first line wins for a SKU; a line whose primary is itself is skipped).
 * What the key-product photo / datasheet / library reads alias through.
 */
export function memberAliases(items: Iterable<MemberLine | null | undefined>, fixtureOf?: FixtureLookup): Map<string, string> {
  const out = new Map<string, string>();
  for (const it of items) {
    if (!it || typeof it !== "object") continue;
    const sku = str(it.sku);
    if (!sku || out.has(sku)) continue;
    const p = primaryMemberSku(it, fixtureOf);
    if (p && p !== sku) out.set(sku, p);
  }
  return out;
}

/** Every item of an estimator spec's sections (raw JSON-safe). */
export function specItems(spec: unknown): MemberLine[] {
  const s = spec as { sections?: unknown } | null | undefined;
  if (!s || !Array.isArray(s.sections)) return [];
  const out: MemberLine[] = [];
  for (const sec of s.sections) {
    const items = sec && typeof sec === "object" ? (sec as { items?: unknown }).items : null;
    if (Array.isArray(items)) for (const it of items) if (it && typeof it === "object") out.push(it as MemberLine);
  }
  return out;
}
