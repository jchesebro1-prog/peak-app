/**
 * Grid notes #4 — equipment groups (pure, DB-free, client-safe).
 *
 * Any device can HOLD others (a rack, a booth, a panel…): a member names its
 * holder's placement id in `GridPlacement.groupId`. There is no groups list —
 * a holder is a placement some other placement names. One level only; curtains
 * never hold and are never held; a holder takes at most MAX_GROUP_MEMBERS.
 *
 * A member has no plan spot of its own: it is always on its holder's sheet
 * and page (a link across pages is dropped, never followed), and its x, y and
 * space pin MIRROR the holder's (settleGroups), so every reader of a placement's position
 * (spaces, schedule, riser, reading order, wires) puts it where its holder is.
 * The editor simply doesn't draw it. Spec:
 * docs/superpowers/specs/2026-10-12-grid-equipment-groups-design.md.
 */
import { clamp01, type Point } from "@/lib/annotations";

export const MAX_GROUP_MEMBERS = 200;

/** The fields the group rules read. */
export type GroupLite = {
  id: string;
  sheetId: string;
  page: number;
  x: number;
  y: number;
  optionId?: string;
  groupId?: string;
  spaceId?: string;
  curtain?: unknown;
};

export const GROUP_CURTAIN_HOLD = "Curtains can't hold other devices.";
export const GROUP_CURTAIN_MEMBER = "Curtains can't go inside another device.";
export const GROUP_HOLDER_IS_MEMBER = "That device is inside another one — a group can't go inside a group.";
export const GROUP_MEMBER_HOLDS = "A device that holds others can't go inside another.";
export const GROUP_SELF = "A device can't go inside itself.";
export const GROUP_HOLDER_GONE = "That device is no longer on this design — reload and try again.";
export const GROUP_OTHER_OPTION = "Devices can only go into a device on the same option.";
export const GROUP_OTHER_PAGE = "Devices can only go into a device on the same sheet and page.";
export const groupFull = (name: string) => `${name} already holds ${MAX_GROUP_MEMBERS} devices.`;

const optionOf = (pl: GroupLite, defaultOpt: string) => pl.optionId || defaultOpt;

/** holderId → number of member placements (as stored; not validated). */
export function memberCounts(placements: readonly GroupLite[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const pl of placements) if (pl.groupId) m.set(pl.groupId, (m.get(pl.groupId) || 0) + 1);
  return m;
}

/** A holder's members, in stored order. */
export function membersOf<P extends GroupLite>(placements: readonly P[], holderId: string): P[] {
  return placements.filter((pl) => pl.groupId === holderId && pl.id !== holderId);
}

/** The live holder a placement sits in, or null. */
export function holderOf<P extends GroupLite>(pl: GroupLite, byId: ReadonlyMap<string, P>): P | null {
  if (!pl.groupId || pl.groupId === pl.id) return null;
  return byId.get(pl.groupId) ?? null;
}

/** Why `holder` can't hold devices (a curtain, or itself a member), else null. */
export function holdRefusal(holder: GroupLite): string | null {
  if (holder.curtain) return GROUP_CURTAIN_HOLD;
  if (holder.groupId) return GROUP_HOLDER_IS_MEMBER;
  return null;
}

/**
 * The all-or-nothing check for putting `memberIds` into `holderId`. Members
 * already in that holder are fine (a no-op). `name` labels the holder in the
 * "full" sentence.
 */
export function groupRefusal(
  placements: readonly GroupLite[],
  holderId: string,
  memberIds: readonly string[],
  defaultOpt: string,
  name = "That device"
): string | null {
  const byId = new Map(placements.map((pl) => [pl.id, pl]));
  const holder = byId.get(holderId);
  if (!holder) return GROUP_HOLDER_GONE;
  const own = holdRefusal(holder);
  if (own) return own;
  const counts = memberCounts(placements);
  let adding = 0;
  for (const id of new Set(memberIds)) {
    const pl = byId.get(id);
    if (!pl) return GROUP_HOLDER_GONE;
    if (id === holderId) return GROUP_SELF;
    if (pl.curtain) return GROUP_CURTAIN_MEMBER;
    if ((counts.get(id) || 0) > 0) return GROUP_MEMBER_HOLDS;
    if (optionOf(pl, defaultOpt) !== optionOf(holder, defaultOpt)) return GROUP_OTHER_OPTION;
    if (pl.groupId === holderId) continue;
    if (pl.sheetId !== holder.sheetId || pl.page !== holder.page) return GROUP_OTHER_PAGE;
    adding++;
  }
  if ((counts.get(holderId) || 0) + adding > MAX_GROUP_MEMBERS) return groupFull(name);
  return null;
}

/**
 * The ≤ MAX_GROUP_MEMBERS check for a write that ADDS links (a paste, an undo
 * that puts devices back): each holder's live members (other than the ids
 * being added) plus the new links must fit. `nameOf` names a holder in the
 * refusal. null = fits. Checked before anything is written, so the repair
 * rule never has to drop a link the person asked for.
 */
export function groupCapRefusal(
  placements: readonly GroupLite[],
  adds: ReadonlyArray<{ id: string; groupId: string }>,
  nameOf: (holderId: string) => string = () => "That device"
): string | null {
  const adding = new Set(adds.map((a) => a.id));
  const n = new Map<string, number>();
  for (const pl of placements) if (pl.groupId && !adding.has(pl.id)) n.set(pl.groupId, (n.get(pl.groupId) || 0) + 1);
  for (const a of adds) n.set(a.groupId, (n.get(a.groupId) || 0) + 1);
  for (const [holderId, count] of n) if (count > MAX_GROUP_MEMBERS && adds.some((a) => a.groupId === holderId)) return groupFull(nameOf(holderId));
  return null;
}

/** Spots beside a holder for `n` devices taken out: a row to its right
 *  (`step` of the page apart), wrapping every 8, mirrored to the left when
 *  the right edge is too close; clamped to the page. */
export function takeOutPositions(holder: Point, n: number, step = 0.025): Point[] {
  const perRow = 8;
  const dir = holder.x + step * Math.min(n, perRow) > 0.98 ? -1 : 1;
  const out: Point[] = [];
  for (let i = 0; i < n; i++) {
    const col = (i % perRow) + 1;
    const row = Math.floor(i / perRow);
    out.push({ x: clamp01(holder.x + dir * step * col), y: clamp01(holder.y + step * row) });
  }
  return out;
}

/** Members of a holder among `ids` that aren't themselves in `ids`. */
export function membersLeftBehind<P extends GroupLite>(placements: readonly P[], ids: readonly string[]): P[] {
  const gone = new Set(ids);
  return placements.filter((pl) => !!pl.groupId && gone.has(pl.groupId) && !gone.has(pl.id));
}

export type DeleteMembers = "delete" | "keep";

/**
 * What deleting `ids` does to groups: "delete" removes every member of a
 * removed holder too; "keep" takes them out beside it (their spots). Members
 * named in `ids` are always removed.
 */
export function deletePlan<P extends GroupLite>(
  placements: readonly P[],
  ids: readonly string[],
  mode: DeleteMembers
): { removeIds: Set<string>; takeOut: { id: string; groupId: string; x: number; y: number }[] } {
  const removeIds = new Set(ids);
  const behind = membersLeftBehind(placements, ids);
  if (mode === "delete") {
    for (const pl of behind) removeIds.add(pl.id);
    return { removeIds, takeOut: [] };
  }
  const byId = new Map(placements.map((pl) => [pl.id, pl]));
  const byHolder = new Map<string, P[]>();
  for (const pl of behind) {
    const list = byHolder.get(pl.groupId!) || [];
    list.push(pl);
    byHolder.set(pl.groupId!, list);
  }
  const takeOut: { id: string; groupId: string; x: number; y: number }[] = [];
  for (const [holderId, list] of byHolder) {
    const holder = byId.get(holderId)!;
    const spots = takeOutPositions(holder, list.length);
    list.forEach((pl, i) => takeOut.push({ id: pl.id, groupId: holderId, ...spots[i] }));
  }
  return { removeIds, takeOut };
}

/** `ids` plus every member of a holder among them (stored order after the
 *  named ones) — what a copy or a Cut of a holder carries. */
export function withMembers(placements: readonly GroupLite[], ids: readonly string[]): string[] {
  const out = [...new Set(ids)];
  const have = new Set(out);
  for (const pl of placements) {
    if (pl.groupId && have.has(pl.groupId) && !have.has(pl.id)) {
      out.push(pl.id);
      have.add(pl.id);
    }
  }
  return out;
}

/**
 * The one repair rule (spec §1): a member whose link breaks an invariant
 * (holder missing, itself a member, a curtain, another option, another sheet
 * or page; the member a curtain or itself a holder; past MAX_GROUP_MEMBERS)
 * loses `groupId` where it stands; every valid member mirrors its holder's x,
 * y and space pin (never its page — a member is never moved across pages). Returns the same array when nothing changes; never mutates inputs.
 */
export function settleGroups<P extends GroupLite>(placements: readonly P[], defaultOpt: string): P[] {
  if (!placements.some((pl) => pl.groupId)) return placements as P[];
  const byId = new Map(placements.map((pl) => [pl.id, pl]));
  // Who is named as a holder by anyone at all (a live, non-curtain device).
  const named = new Set<string>();
  for (const pl of placements) {
    const h = pl.groupId && pl.groupId !== pl.id ? byId.get(pl.groupId) : undefined;
    if (h && !h.curtain && !pl.curtain && optionOf(pl, defaultOpt) === optionOf(h, defaultOpt) && pl.sheetId === h.sheetId && pl.page === h.page) named.add(h.id);
  }
  // A named holder keeps its members and loses its own link (one level).
  const valid = new Map<string, string>();
  const taken = new Map<string, number>();
  for (const pl of placements) {
    if (!pl.groupId) continue;
    const holder = byId.get(pl.groupId);
    const ok =
      !!holder &&
      holder.id !== pl.id &&
      !holder.curtain &&
      !pl.curtain &&
      // A member never holds: one that is named by others keeps them and
      // loses its own link (its holder, being named, never has one kept).
      !named.has(pl.id) &&
      optionOf(pl, defaultOpt) === optionOf(holder, defaultOpt) &&
      // Review: never carry a device to another page — a link across pages is dropped.
      pl.sheetId === holder.sheetId &&
      pl.page === holder.page;
    if (!ok) continue;
    const n = (taken.get(holder.id) || 0) + 1;
    if (n > MAX_GROUP_MEMBERS) continue;
    taken.set(holder.id, n);
    valid.set(pl.id, holder.id);
  }
  let changed = false;
  const out = placements.map((pl) => {
    const holderId = valid.get(pl.id);
    if (!holderId) {
      if (pl.groupId === undefined) return pl;
      // A holder named by someone that also names a holder: one level — it drops its own link.
      changed = true;
      const next = { ...pl };
      delete next.groupId;
      return next;
    }
    const h = byId.get(holderId)!;
    // Same sheet + page is part of a valid link (above), so only the spot and the pin can differ.
    const sameSpot = pl.x === h.x && pl.y === h.y && (pl.spaceId ?? undefined) === (h.spaceId ?? undefined);
    if (sameSpot) return pl;
    changed = true;
    const next = { ...pl, x: h.x, y: h.y };
    if (h.spaceId) next.spaceId = h.spaceId;
    else delete next.spaceId;
    return next;
  });
  return changed ? out : (placements as P[]);
}

/**
 * The holder a drag would drop into: the topmost candidate marker within
 * `radius` (x scaled by the page aspect) of `at` that isn't being dragged, can
 * hold, and would accept every dragged device. null = a plain move.
 */
export function dropHolderAt<P extends GroupLite>(
  at: Point,
  candidates: readonly P[],
  draggedIds: readonly string[],
  all: readonly GroupLite[],
  radius: number,
  aspect: number,
  defaultOpt: string
): P | null {
  const dragged = new Set(draggedIds);
  const hit = [...candidates]
    .reverse()
    .find((pl) => !dragged.has(pl.id) && Math.abs(pl.x - at.x) < radius && Math.abs(pl.y - at.y) < radius / (aspect || 1));
  if (!hit) return null;
  return groupRefusal(all, hit.id, draggedIds, defaultOpt) ? null : hit;
}

/**
 * Spreadsheet nesting: each holder's members follow it directly (in the order
 * they already have in `rows`), flagged `nested`; a member whose holder isn't
 * among `rows` (filtered out) keeps its own place, unflagged.
 */
export function nestRows<R extends { id: string; holderId: string | null }>(rows: readonly R[]): Array<R & { nested: boolean }> {
  const present = new Set(rows.map((r) => r.id));
  const kids = new Map<string, R[]>();
  for (const r of rows) {
    if (r.holderId && present.has(r.holderId)) {
      const list = kids.get(r.holderId) || [];
      list.push(r);
      kids.set(r.holderId, list);
    }
  }
  const out: Array<R & { nested: boolean }> = [];
  for (const r of rows) {
    if (r.holderId && present.has(r.holderId)) continue;
    out.push({ ...r, nested: false });
    for (const k of kids.get(r.id) || []) out.push({ ...k, nested: true });
  }
  return out;
}
