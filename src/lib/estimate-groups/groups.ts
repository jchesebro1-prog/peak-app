/**
 * Estimator Phase 2a — system groups (pure rules).
 *
 * A quote's systems (sections) can sit under named group headings. Stored
 * order invariant: ungrouped systems first, then each group in `groups`
 * order, relative order kept; a `groupId` that names no group is dropped.
 * Everything here is pure and generic over `{ id, groupId?, built? }` so the
 * Estimator, the actions and the loaders can all share it.
 *
 * Where a function "returns the input unchanged" it returns the SAME
 * reference, so callers can cheaply detect a no-op with `===`.
 */

export type SystemGroup = { id: string; name: string; alternate: boolean };

export const GROUP_NAME_MAX = 80;
export const GROUPS_MAX = 20;
export const UNTITLED_GROUP = "Untitled group";

const GROUP_ID_RE = /^g-[a-z0-9]{1,24}$/;
const CONTROL_RE = /[\u0000-\u001f\u007f-\u009f]/g;

type Grouped = { id: string; groupId?: string; alternate?: true };

/** "g-" + base36 time/random, ≤ 26 chars. The only impure function here. */
export function newGroupId(): string {
  return "g-" + (Date.now().toString(36) + Math.random().toString(36).slice(2, 8)).slice(0, 24);
}

function cleanName(raw: unknown): string {
  const s = typeof raw === "string" ? raw.replace(CONTROL_RE, "").trim().slice(0, GROUP_NAME_MAX).trim() : "";
  return s || UNTITLED_GROUP;
}

export function sanitizeGroups(raw: unknown): SystemGroup[] {
  if (!Array.isArray(raw)) return [];
  const out: SystemGroup[] = [];
  const seen = new Set<string>();
  for (const e of raw) {
    if (out.length >= GROUPS_MAX) break;
    if (!e || typeof e !== "object") continue;
    const r = e as Record<string, unknown>;
    if (typeof r.id !== "string" || !GROUP_ID_RE.test(r.id) || seen.has(r.id)) continue;
    seen.add(r.id);
    out.push({ id: r.id, name: cleanName(r.name), alternate: r.alternate === true });
  }
  return out;
}

function sameItems<T>(a: T[], b: T[]): boolean {
  return a.length === b.length && a.every((x, i) => x === b[i]);
}

function dropGroupId<S extends { groupId?: string }>(s: S): S {
  const { groupId: _drop, ...rest } = s;
  void _drop;
  return rest as unknown as S;
}

function dropAlternate<S extends { alternate?: true }>(s: S): S {
  const { alternate: _drop, ...rest } = s;
  void _drop;
  return rest as unknown as S;
}

/**
 * Phase 2b: the derived `alternate` stamp — `alternate: true` exactly when the
 * section's group is an Alternate group, the key absent otherwise (never
 * false). Same reference when the stamp is already right.
 */
function withAlternateStamp<S extends Grouped>(s: S, alternateIds: Set<string>): S {
  const want = s.groupId !== undefined && alternateIds.has(s.groupId);
  if (want) return s.alternate === true ? s : { ...s, alternate: true };
  return "alternate" in s ? dropAlternate(s) : s;
}

/**
 * Ungrouped first, then groups in order. Unknown groupId is dropped.
 * Phase 2b: also stamps `alternate` (see withAlternateStamp) — the ONLY writer
 * of that key. The input array comes back unchanged (same reference) only
 * when both the order and every section's stamp were already right.
 */
export function normalizeSystemOrder<S extends Grouped>(sections: S[], groups: SystemGroup[]): S[] {
  const known = new Set(groups.map((g) => g.id));
  const alternateIds = new Set(groups.filter((g) => g.alternate === true).map((g) => g.id));
  const fixed = sections.map((s) => withAlternateStamp(s.groupId !== undefined && !known.has(s.groupId) ? dropGroupId(s) : s, alternateIds));
  const out: S[] = fixed.filter((s) => s.groupId === undefined);
  for (const g of groups) for (const s of fixed) if (s.groupId === g.id) out.push(s);
  return sameItems(out, sections) ? sections : out;
}

export type GroupBlock<S> = { group: SystemGroup | null; sections: S[] };

export function groupBlocks<S extends Grouped>(
  sections: S[],
  groups: SystemGroup[],
  opts?: { includeEmpty?: boolean },
): GroupBlock<S>[] {
  const norm = normalizeSystemOrder(sections, groups);
  const blocks: GroupBlock<S>[] = [];
  const ungrouped = norm.filter((s) => s.groupId === undefined);
  if (ungrouped.length) blocks.push({ group: null, sections: ungrouped });
  for (const g of groups) {
    const secs = norm.filter((s) => s.groupId === g.id);
    if (secs.length || opts?.includeEmpty) blocks.push({ group: g, sections: secs });
  }
  return blocks;
}

/** Ungrouped block (always present) then one block per group, empties included. */
function allBlocks<S extends Grouped>(sections: S[], groups: SystemGroup[]): S[][] {
  const norm = normalizeSystemOrder(sections, groups);
  return [norm.filter((s) => s.groupId === undefined), ...groups.map((g) => norm.filter((s) => s.groupId === g.id))];
}

export function moveSystemTo<S extends Grouped>(
  sections: S[],
  groups: SystemGroup[],
  id: string,
  target: { groupId: string | null; beforeId: string | null },
): S[] {
  const moving = sections.find((s) => s.id === id);
  if (!moving) return sections;
  if (target.groupId !== null && !groups.some((g) => g.id === target.groupId)) return sections;
  // Dropping onto itself is a no-op: return the normalised order (same reference if already normal).
  if (target.beforeId === id) return normalizeSystemOrder(sections, groups);
  const base = normalizeSystemOrder(sections, groups);
  const rest = base.filter((s) => s.id !== id);
  const placed = target.groupId === null ? dropGroupId(moving) : moving.groupId === target.groupId ? moving : { ...moving, groupId: target.groupId };
  const blocks = allBlocks(rest, groups);
  const bi = target.groupId === null ? 0 : groups.findIndex((g) => g.id === target.groupId) + 1;
  const at = target.beforeId === null ? -1 : blocks[bi].findIndex((s) => s.id === target.beforeId);
  if (at >= 0) blocks[bi].splice(at, 0, placed);
  else blocks[bi].push(placed);
  const next = normalizeSystemOrder(blocks.flat(), groups);
  // A drop that lands the system exactly where it already is changes nothing.
  const same = next.length === base.length && next.every((s, i) => s.id === base[i].id && (s.groupId ?? null) === (base[i].groupId ?? null));
  return same ? base : next;
}

export function moveSystemBy<S extends Grouped>(sections: S[], groups: SystemGroup[], id: string, delta: -1 | 1): S[] {
  if (!sections.some((s) => s.id === id)) return sections;
  const blocks = allBlocks(sections, groups);
  const bi = blocks.findIndex((b) => b.some((s) => s.id === id));
  const i = blocks[bi].findIndex((s) => s.id === id);
  const ni = i + delta;
  if (ni >= 0 && ni < blocks[bi].length) {
    // Same block: swap with the neighbour.
    const beforeId = delta === -1 ? blocks[bi][ni].id : (blocks[bi][ni + 1]?.id ?? null);
    return moveSystemTo(sections, groups, id, { groupId: bi === 0 ? null : groups[bi - 1].id, beforeId });
  }
  const nb = bi + delta;
  if (nb < 0 || nb >= blocks.length) return sections;
  // Leaving a block: last of the previous one going up, first of the next going down.
  return moveSystemTo(sections, groups, id, {
    groupId: nb === 0 ? null : groups[nb - 1].id,
    beforeId: delta === 1 ? (blocks[nb][0]?.id ?? null) : null,
  });
}

export function addGroup(groups: SystemGroup[], name?: string, id?: string): SystemGroup[] {
  if (groups.length >= GROUPS_MAX) return groups;
  return [...groups, { id: id ?? newGroupId(), name: cleanName(name), alternate: false }];
}

export function renameGroup(groups: SystemGroup[], id: string, name: string): SystemGroup[] {
  const at = groups.findIndex((g) => g.id === id);
  if (at < 0) return groups;
  const next = cleanName(name);
  if (groups[at].name === next) return groups;
  return groups.map((g, i) => (i === at ? { ...g, name: next } : g));
}

export function moveGroupBy(groups: SystemGroup[], id: string, delta: -1 | 1): SystemGroup[] {
  const at = groups.findIndex((g) => g.id === id);
  const to = at + delta;
  if (at < 0 || to < 0 || to >= groups.length) return groups;
  const next = groups.slice();
  [next[at], next[to]] = [next[to], next[at]];
  return next;
}

export function removeGroup<S extends Grouped>(
  sections: S[],
  groups: SystemGroup[],
  id: string,
): { sections: S[]; groups: SystemGroup[] } {
  if (!groups.some((g) => g.id === id)) return { sections, groups };
  const left = groups.filter((g) => g.id !== id);
  // normalizeSystemOrder drops the (now unknown) groupId and re-sorts.
  return { sections: normalizeSystemOrder(sections, left), groups: left };
}

/** A system leaving this estimate carries neither its group, its built flag nor its alternate stamp. */
export function withoutGroupMeta<S extends { groupId?: string; built?: boolean; alternate?: true }>(sec: S): S {
  if (!("groupId" in sec) && !("built" in sec) && !("alternate" in sec)) return sec;
  const { groupId: _g, built: _b, alternate: _a, ...rest } = sec;
  void _g;
  void _b;
  void _a;
  return rest as unknown as S;
}

/**
 * Server-side hardening on save: `built` survives only when exactly `true`,
 * `groupId` only when a string (unknown ids are dropped by normalizeSystemOrder).
 * Phase 2b: a posted `alternate` is never trusted — it is always stripped and
 * normalizeSystemOrder re-derives it from the groups.
 * Returns the same reference when nothing needs stripping.
 */
export function sanitizeSectionGroupMeta<S extends { groupId?: unknown; built?: unknown; alternate?: unknown }>(sec: S): S {
  if (!sec || typeof sec !== "object") return sec;
  const badBuilt = "built" in sec && sec.built !== true;
  const badGroup = "groupId" in sec && typeof sec.groupId !== "string";
  if (!badBuilt && !badGroup && !("alternate" in sec)) return sec;
  const { built: _b, groupId: _g, alternate: _a, ...rest } = sec;
  void _b;
  void _g;
  void _a;
  return {
    ...rest,
    ...(!badBuilt && "built" in sec ? { built: sec.built } : {}),
    ...(!badGroup && "groupId" in sec ? { groupId: sec.groupId } : {}),
  } as unknown as S;
}

export function withoutBuilt<S extends { built?: boolean }>(sec: S): S {
  if (!("built" in sec)) return sec;
  const { built: _b, ...rest } = sec;
  void _b;
  return rest as unknown as S;
}

/**
 * Any edit to a built section other than `built` itself clears `built`.
 * Moving it between groups (a `groupId`-only change) is not an edit, so a
 * move keeps `built` (Phase 2a decision).
 */
export function unmarkEdited<S extends { id: string; built?: boolean; groupId?: string }>(prev: S[], next: S[]): S[] {
  const before = new Map(prev.map((s) => [s.id, s]));
  let changed = false;
  const out = next.map((s) => {
    if (!s.built) return s;
    const p = before.get(s.id);
    if (!p || p === s) return s;
    if (JSON.stringify(withoutGroupMeta(p)) === JSON.stringify(withoutGroupMeta(s))) return s;
    changed = true;
    return withoutBuilt(s);
  });
  return changed ? out : next;
}
