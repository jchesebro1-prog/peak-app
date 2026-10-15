/**
 * Oct 15 #47 (Jeff): Spec Library section numbers follow Bray Associates'
 * table of contents. Pure — the plan for `npm run specs:renumber-bray`
 * (scripts/specs-renumber-bray.ts), which reads a mapping file
 * (docs/specs-seed/bray-toc-map.json) that Jeff confirms from a real Bray
 * project manual TOC (section 00 01 10).
 *
 * What moves: each mapped `spec_sections.number` (and its title, when the map
 * gives one) and every `spec_records.section` carrying that number — records
 * through saveSpecRecord, so each change appends a revision. What never moves:
 * record ids (`PS-116123-003` stays — an id is opaque and pinned on BOM rows;
 * new records in a renumbered section get ids from the new number), section
 * ids, article links and saved project specs (SP-####).
 *
 * Idempotent: a section already at its target is left alone, so a second run
 * plans nothing. Refused as a whole (nothing planned) when the map is
 * malformed or a target number is already held by a section the map doesn't
 * move away.
 */
import { csiKey } from "./articles";

export type BrayMapEntry = { from: string; to: string; title?: string };
export type BrayMap = { source: string; entries: BrayMapEntry[] };

export type SectionLite = { id: string; number: string; title: string };
export type RecordLite = { specId: string; section: string };

export type RenumberPlan = {
  sections: Array<{ id: string; from: string; to: string; titleFrom: string; titleTo: string }>;
  records: Array<{ specId: string; from: string; to: string }>;
  /** Map entries whose `from` matches no section and no record (already renumbered, or never in the library). */
  notFound: string[];
  /** Map entries already applied (a section at `to`, none at `from`). */
  already: string[];
};

/** "11 61 23" / "11 61 23.13": two-digit groups, one space apart. */
const CSI = /^\d{2} \d{2} \d{2}(\.\d{2})?$/;

/** The mapping file's JSON → a checked map, or the reasons it can't be used. */
export function parseBrayMap(raw: unknown): { ok: true; map: BrayMap } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { ok: false, errors: ["The map must be a JSON object."] };
  const o = raw as Record<string, unknown>;
  const source = typeof o.source === "string" ? o.source.trim() : "";
  if (!source) errors.push('Name the TOC the map comes from in "source" (project, number, date).');
  if (o.confirmed !== true) errors.push('Set "confirmed": true once Jeff has checked the map against Bray\'s TOC.');
  const list = Array.isArray(o.sections) ? o.sections : null;
  if (!list || !list.length) errors.push('List the renumbering in "sections": [{ "from": "11 61 23", "to": "11 06 10" }].');
  const entries: BrayMapEntry[] = [];
  const froms = new Set<string>();
  const tos = new Set<string>();
  for (const [i, e] of (list ?? []).entries()) {
    const r = e && typeof e === "object" ? (e as Record<string, unknown>) : {};
    const from = typeof r.from === "string" ? r.from.trim().replace(/\s+/g, " ") : "";
    const to = typeof r.to === "string" ? r.to.trim().replace(/\s+/g, " ") : "";
    const title = typeof r.title === "string" ? r.title.trim().replace(/\s+/g, " ") : "";
    if (!CSI.test(from) || !CSI.test(to)) {
      errors.push(`sections[${i}]: "from" and "to" must be CSI numbers like "11 61 23".`);
      continue;
    }
    if (froms.has(csiKey(from))) errors.push(`sections[${i}]: ${from} is listed twice.`);
    if (tos.has(csiKey(to))) errors.push(`sections[${i}]: two sections can't both become ${to}.`);
    froms.add(csiKey(from));
    tos.add(csiKey(to));
    if (csiKey(from) === csiKey(to) && !title) continue; // nothing to do
    entries.push({ from, to, ...(title ? { title } : {}) });
  }
  return errors.length ? { ok: false, errors } : { ok: true, map: { source, entries } };
}

/** The changes a map makes to this library, or the collisions that stop it. */
export function planRenumber(
  map: BrayMap,
  sections: readonly SectionLite[],
  records: readonly RecordLite[]
): { ok: true; plan: RenumberPlan } | { ok: false; errors: string[] } {
  const plan: RenumberPlan = { sections: [], records: [], notFound: [], already: [] };
  const errors: string[] = [];
  const movingAway = new Set(map.entries.map((e) => csiKey(e.from)));
  for (const e of map.entries) {
    const fromK = csiKey(e.from), toK = csiKey(e.to);
    const atFrom = sections.filter((s) => csiKey(s.number) === fromK);
    const recs = records.filter((r) => csiKey(r.section) === fromK);
    if (fromK !== toK) {
      // A target held by a section that stays put would leave two sections with one number.
      const blocker = sections.find((s) => csiKey(s.number) === toK && !movingAway.has(toK));
      if (blocker && atFrom.length) errors.push(`${e.to} is already section "${blocker.title}" — move it first, or leave ${e.from} out of the map.`);
    }
    if (!atFrom.length && !recs.length) {
      if (sections.some((s) => csiKey(s.number) === toK)) plan.already.push(`${e.from} → ${e.to}`);
      else plan.notFound.push(e.from);
      continue;
    }
    for (const s of atFrom) {
      const titleTo = e.title ?? s.title;
      if (csiKey(s.number) === toK && titleTo === s.title) continue;
      plan.sections.push({ id: s.id, from: s.number, to: e.to, titleFrom: s.title, titleTo });
    }
    if (fromK !== toK) for (const r of recs) plan.records.push({ specId: r.specId, from: r.section, to: e.to });
  }
  return errors.length ? { ok: false, errors } : { ok: true, plan };
}

/** The revision note each renumbered record carries. */
export const renumberWhy = (from: string, source: string) => `Renumbered from ${from} to follow Bray's TOC (${source}).`;
