import { round2 } from "./pricing";
import type { LaborDraft, LaborGroupRecord, SpecItem, SpecSection } from "./types";

/**
 * #269 — a labor group: every line one "Add labor" inserted (mobilization
 * labor, its #270 travel lines, shop & engineering, allowance, bonus) shares
 * one `laborGroup` id, and the configurator draft that produced them is kept
 * ONCE per group on the section (`sec.laborGroups[id]`), so clicking any of
 * those lines can reopen the Labor configurator pre-filled and replace the
 * group in place. Pure: no React, no server imports.
 *
 * The draft lives on the section rather than on a line so removing a line
 * never loses it; `pruneLaborGroups` drops a record once no line of its
 * group is left. Lines added before #269 carry no group and are not editable.
 */

/** A fresh group id — unique within an estimate (time + a random tail). */
export function newLaborGroupId(now: number = Date.now(), rnd: number = Math.random()): string {
  return "lg" + now.toString(36) + Math.floor(rnd * 1296).toString(36).padStart(2, "0");
}

/** A detached copy of a draft (plain strings/booleans), safe to persist. */
export function snapshotLaborDraft(d: LaborDraft): LaborDraft {
  return { ...d, mobs: (d.mobs || []).map((m) => ({ ...m })) };
}

/** The stored record for `group` on this section, if any. */
export function laborGroupRecord(sec: Pick<SpecSection, "laborGroups">, group: string | undefined): LaborGroupRecord | null {
  if (!group) return null;
  const map = sec.laborGroups;
  if (!map || typeof map !== "object" || !Object.prototype.hasOwnProperty.call(map, group)) return null;
  const rec = map[group];
  return rec && rec.draft && Array.isArray(rec.draft.mobs) ? rec : null;
}

/** True when this line can reopen the Labor configurator (#269). */
export function isLaborLineEditable(sec: Pick<SpecSection, "laborGroups">, it: Pick<SpecItem, "labor" | "laborGroup">): boolean {
  return !!it.labor && laborGroupRecord(sec, it.laborGroup) != null;
}

/**
 * Adds a group's lines to a section, or — when the group already has lines
 * there — replaces them IN PLACE: the new lines go where the group's first
 * line was, every other line keeps its position. The draft is stored with
 * the number of lines it produced (`laborGroupEdits` compares against it).
 * `lineOrder` is restamped by position when the section already uses it.
 */
export function withLaborGroup(sec: SpecSection, group: string, items: SpecItem[], draft: LaborDraft): SpecSection {
  const tagged = items.map((it) => ({ ...it, laborGroup: group }));
  const at = sec.items.findIndex((it) => it.laborGroup === group);
  let next: SpecItem[];
  if (at < 0) next = [...sec.items, ...tagged];
  else {
    const kept = sec.items.filter((it) => it.laborGroup !== group);
    // Lines before the first group line are exactly the kept lines before it.
    const before = sec.items.slice(0, at).length;
    next = [...kept.slice(0, before), ...tagged, ...kept.slice(before)];
  }
  if (sec.items.some((it) => typeof it.lineOrder === "number")) next = next.map((it, i) => ({ ...it, lineOrder: i }));
  return {
    ...sec,
    items: next,
    laborGroups: { ...(sec.laborGroups || {}), [group]: { draft: snapshotLaborDraft(draft), lines: tagged.length } },
  };
}

/** Drops stored drafts whose group has no line left in the section. */
export function pruneLaborGroups(sec: SpecSection): SpecSection {
  const map = sec.laborGroups;
  if (!map) return sec;
  const live = new Set(sec.items.map((it) => it.laborGroup).filter(Boolean) as string[]);
  const keys = Object.keys(map);
  const keep = keys.filter((k) => live.has(k));
  if (keep.length === keys.length) return sec;
  const out: SpecSection = { ...sec };
  if (keep.length) out.laborGroups = Object.fromEntries(keep.map((k) => [k, map[k]]));
  else delete out.laborGroups;
  return out;
}

/** The labor draft's margin fraction, read exactly as computeLabor reads it. */
function draftMargin(d: LaborDraft): number {
  return Math.min(0.95, Math.max(0, (parseFloat(d.margin) || 0) / 100));
}

/** Seeded-sell tolerance: the mobilization line carries its travel lines'
 *  rounding and the last line carries buildLaborItems' drift nudge (≤ 5¢). */
const SEED_TOLERANCE = 0.05;

/**
 * What an "Update labor" would overwrite (#269): lines of the group whose
 * qty or sell no longer match what the configurator produced (a typed price
 * or ext sell, a qty change, a margin slider), and how many of its lines
 * were removed since (an update brings them back).
 */
export function laborGroupEdits(sec: SpecSection, group: string): { handEdited: number; removed: number } {
  const rec = laborGroupRecord(sec, group);
  const lines = sec.items.filter((it) => it.laborGroup === group);
  if (!rec) return { handEdited: 0, removed: 0 };
  const m = draftMargin(rec.draft);
  const handEdited = lines.filter((it) => {
    if (it.qty !== 1) return true;
    if (it.sellOverride) return true;
    if (it.extSellOverride != null && Number.isFinite(it.extSellOverride)) return true;
    const seed = m < 1 ? round2(it.cost / (1 - m)) : it.cost;
    return Math.abs(it.price - seed) > SEED_TOLERANCE + 1e-9;
  }).length;
  return { handEdited, removed: Math.max(0, (rec.lines || 0) - lines.length) };
}

/**
 * #254/#266: when the tier moved a group's lines to a new labor margin, the
 * stored draft follows, so a later "Update labor" rebuilds at the tier's
 * margin rather than reverting it. Only drafts still at the previous
 * whole-percent margin move (a hand-typed margin stays the user's).
 */
export function syncLaborDraftMargins(
  sec: SpecSection,
  groups: ReadonlySet<string>,
  prevMargin: number,
  nextMargin: number
): SpecSection {
  const map = sec.laborGroups;
  if (!map || !groups.size) return sec;
  const prevPct = Math.round(prevMargin * 100);
  const nextPct = String(Math.round(nextMargin * 100));
  let changed = false;
  const out: Record<string, LaborGroupRecord> = {};
  for (const [k, rec] of Object.entries(map)) {
    if (groups.has(k) && rec && rec.draft && Math.round(draftMargin(rec.draft) * 100) === prevPct && rec.draft.margin !== nextPct) {
      out[k] = { ...rec, draft: { ...rec.draft, margin: nextPct } };
      changed = true;
    } else out[k] = rec;
  }
  return changed ? { ...sec, laborGroups: out } : sec;
}
