import { listDocs, patchDoc, upsertDoc } from "@/db/doc-store";

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
 * ------------------------------------------------------------------ */

function uid(p: string): string {
  return p + Math.random().toString(36).slice(2, 10);
}

export type SpecSection = {
  id: string; // uid('ss-')
  /** CSI number, e.g. "11 61 43". Free text — Peak decides its own numbering. */
  number: string;
  title: string;
  /** Ordering within the assembled document. */
  sort: number;
  /** PART 1 — GENERAL boilerplate (scope, submittals, warranty…). */
  part1: string;
  /** PART 3 — EXECUTION boilerplate (installation, training, closeout…). */
  part3: string;
  updatedAt: number;
  updatedBy: string;
};

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
  const list = await listDocs<SpecSection>("spec_sections");
  return list.sort((a, b) => a.sort - b.sort || a.number.localeCompare(b.number));
}

export async function createSection(input: {
  number: string;
  title: string;
  sort?: number;
  part1?: string;
  part3?: string;
  by: string;
}): Promise<SpecSection> {
  const rec: SpecSection = {
    id: uid("ss-"),
    number: input.number.trim(),
    title: input.title.trim(),
    sort: Number(input.sort) || 100,
    part1: input.part1 || "",
    part3: input.part3 || "",
    updatedAt: Date.now(),
    updatedBy: input.by,
  };
  await upsertDoc<SpecSection>("spec_sections", rec);
  return rec;
}

export async function updateSection(
  id: string,
  patch: Partial<Pick<SpecSection, "number" | "title" | "sort" | "part1" | "part3">>,
  by: string
): Promise<void> {
  await patchDoc<SpecSection>("spec_sections", id, (d) => {
    Object.assign(d, patch);
    d.updatedAt = Date.now();
    d.updatedBy = by;
  });
}

/** Idempotent — safe to call from the UI's "add the starter sections" button. */
export async function seedStarterSections(by: string): Promise<number> {
  const existing = await allSections();
  const have = new Set(existing.map((s) => s.number));
  let made = 0;
  for (const s of STARTER_SECTIONS) {
    if (have.has(s.number)) continue;
    await createSection({ ...s, by });
    made++;
  }
  return made;
}
