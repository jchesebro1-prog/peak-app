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
 * `expandLine` — the DATASHEET / BOM rule, in order:
 *  1. a rack line (`rackId`) → the rack's LIVE members (gridSpecBomRows — the
 *     #296 quote BOM rule, unchanged), or null when the rack no longer
 *     resolves, isn't a rack, or has no member: the line keeps its one quoted
 *     row. A rack line NEVER falls back to its `components` — for a rack that
 *     snapshot holds only the rack-level parts, not the placed gear;
 *  2. `components` with a SKU and qty > 0 → those members × the line qty
 *     (an optional add-on left at 0 is not on the line);
 *  3. an `asm:` sku, a `fixtureId`, or a `fixture: true` line naming an
 *     assembly id → that assembly's live included members (gridSpecBomRows);
 *  4. otherwise the line is not an assembly (`expandLine` → null) and stands
 *     for itself.
 * Labor members (a Grid labor id, or a SKU `isInternal` flags) are left out,
 * as gridSpecBomRows leaves them out of a rack.
 *
 * `primaryMemberSku` / `memberAliases` — the PHOTO / PARAGRAPH / key-product
 * DATASHEET alias (Jeff, #332: assemblies borrow their light engine's). Only
 * an assembly line (`isAssemblyLine`: a fixture / system / hardware assembly
 * line or a portal fixture line — never a rack, never a track) aliases, and
 * only through its OWN `components` snapshot, never a live read: the browser
 * (which holds no fixture records) and the server then compute the same alias
 * from the same line, so Save to library writes to the part that prints. The
 * primary member is the light engine (component role "fixture"), else the
 * first included member.
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
  track?: unknown;
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
  // A rack reads live or stands for itself — its components are rack-level parts only (D578).
  if (rackId) return fixtureOf && fixtureOf(rackId)?.kind === "rack" ? liveMembers(rackId, item, qty, fixtureOf, isInternal) : null;
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

/**
 * An assembly line, for the photo / paragraph / key-product datasheet alias:
 * an Estimator fixture / system / hardware assembly line (`fixture: true`) or
 * a portal fixture line (`fixtureId`) — but never a rack line (`rackId`) and
 * never a track line (`track` config, or a `TRK-` sku, track-bom.ts). Racks
 * and tracks still expand for datasheets (`expandLine`); they don't borrow a
 * member's photo or paragraph.
 */
export function isAssemblyLine(item: MemberLine | null | undefined): boolean {
  if (!item || typeof item !== "object") return false;
  if (str(item.rackId)) return false;
  if (item.track != null || str(item.sku).toUpperCase().startsWith("TRK-")) return false;
  return item.fixture === true || !!str(item.fixtureId);
}

/** The member an assembly line's photo / paragraph / key-product datasheet
 *  borrows, or null (not an assembly line, or no included member in its own
 *  components). Never a live read — the same answer in the browser and on
 *  the server. */
export function primaryMemberSku(item: MemberLine | null | undefined): string | null {
  if (!isAssemblyLine(item)) return null;
  return expandLine(item)?.find((r) => r.primary)?.sku ?? null;
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
 * What the key-product photo / datasheet / library reads alias through —
 * client (use-estimator-state) and server (narrative/photos.ts,
 * package-docs-server.ts) call it on the same lines with no lookup.
 */
export function memberAliases(items: Iterable<MemberLine | null | undefined>): Map<string, string> {
  const out = new Map<string, string>();
  for (const it of items) {
    if (!it || typeof it !== "object") continue;
    const sku = str(it.sku);
    if (!sku || out.has(sku)) continue;
    const p = primaryMemberSku(it);
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
