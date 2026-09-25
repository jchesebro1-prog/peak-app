import { getDoc, listDocs, patchDoc, softDeleteDoc, upsertDoc } from "@/db/doc-store";
import {
  normalizeSection,
  type RawSpecSection,
  type SpecArticle,
  type SpecPart2Style,
  type SpecQuantities,
  type SpecSection,
} from "@/lib/specs/sections";

/* ------------------------------------------------------------------ *
 * Bid-spec section library (D94).
 * Design: docs/superpowers/specs/2026-07-19-bid-spec-generator-design.md
 *
 * A CSI MasterFormat section written ONCE and reused on every bid. Part 1
 * (General) and Part 3 (Execution) are boilerplate Jeff authors here; Part 2
 * (Products) is assembled from the spec paragraphs attached to the catalog
 * parts that landed in the BOM.
 *
 * All of it is plain data in the app — no AI at generation time (D89). Jeff
 * may draft the wording with Claude's help, but the app only ever assembles
 * text a human already approved. That is what lets anyone at Peak produce a
 * spec without Jeff and without an AI subscription.
 *
 * The section shape itself (articles, part2Style, quantities) lives in the
 * pure `src/lib/specs/sections.ts` module — see its header comment — so it
 * can be imported by client code without dragging in the database.
 * ------------------------------------------------------------------ */

export type { SpecArticle, SpecPart2Style, SpecQuantities, SpecSection };
export { SPEC_PART2_STYLES, SPEC_QUANTITIES, newArticleId, partText, toArticles } from "@/lib/specs/sections";

function uid(p: string): string {
  return p + Math.random().toString(36).slice(2, 10);
}

/** Seeds for a first run — the sections Peak actually bids. Empty bodies on
 *  purpose: boilerplate nobody wrote is worse than an obvious blank. */
export const STARTER_SECTIONS: Array<Pick<SpecSection, "number" | "title" | "sort">> = [
  { number: "11 61 33", title: "Rigging Systems and Controls", sort: 10 },
  { number: "11 61 43", title: "Stage Curtains", sort: 20 },
  { number: "26 09 61", title: "Theatrical Lighting Controls", sort: 30 },
  { number: "26 55 61", title: "Theatrical Lighting Fixtures", sort: 40 },
  { number: "27 41 16", title: "Performance Audio-Video Systems", sort: 50 },
];

export async function allSections(): Promise<SpecSection[]> {
  const list = await listDocs<RawSpecSection>("spec_sections");
  return list
    .map(normalizeSection)
    .sort((a, b) => a.sort - b.sort || a.number.localeCompare(b.number));
}

export async function getSection(id: string): Promise<SpecSection | null> {
  const raw = await getDoc<RawSpecSection>("spec_sections", id);
  return raw ? normalizeSection(raw) : null;
}

export async function createSection(input: {
  number: string;
  title: string;
  sort?: number;
  part1?: SpecArticle[];
  part3?: SpecArticle[];
  part2Style?: SpecPart2Style;
  quantities?: SpecQuantities;
  by: string;
}): Promise<SpecSection> {
  const rec = normalizeSection({
    id: uid("ss-"),
    number: input.number,
    title: input.title,
    sort: Number(input.sort) || 100,
    part1: input.part1 ?? [],
    part3: input.part3 ?? [],
    part2Style: input.part2Style,
    quantities: input.quantities,
    updatedAt: Date.now(),
    updatedBy: input.by,
  } as RawSpecSection);
  await upsertDoc<SpecSection>("spec_sections", rec);
  return rec;
}

export async function updateSection(
  id: string,
  patch: Partial<Pick<SpecSection, "number" | "title" | "sort" | "part1" | "part3" | "part2Style" | "quantities">>,
  by: string
): Promise<void> {
  await patchDoc<RawSpecSection>("spec_sections", id, (d) => {
    const next = normalizeSection({ ...d, ...patch } as RawSpecSection);
    next.updatedAt = Date.now();
    next.updatedBy = by;
    return next as unknown as RawSpecSection;
  });
}

/** Soft delete. The refusal rules (parts or articles still pointing here)
 *  live in the action, which can read the catalog; the store just deletes. */
export async function removeSection(id: string): Promise<void> {
  await softDeleteDoc("spec_sections", id);
}

/**
 * Idempotent — safe to call from the library screen's "add the starter
 * sections" button. Tombstone-aware: a section id is random, so re-creating
 * a starter someone deliberately deleted would mint a NEW id and quietly
 * undo their delete. A starter number present on any record, live OR
 * soft-deleted, is skipped (`listDocs(..., { includeDeleted: true })`).
 * Someone who really wants a deleted starter back adds it by hand.
 */
export async function seedStarterSections(by: string): Promise<number> {
  const everything = await listDocs<RawSpecSection>("spec_sections", { includeDeleted: true });
  const have = new Set(everything.map((s) => String(s.number || "").trim()));
  let made = 0;
  for (const s of STARTER_SECTIONS) {
    if (have.has(s.number)) continue;
    await createSection({ ...s, by });
    made++;
  }
  return made;
}
