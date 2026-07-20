import { getDoc, listDocs, upsertDoc } from "@/db/doc-store";
import type { AssembledSpec, BomRow } from "@/lib/bid-spec";

/* ------------------------------------------------------------------ *
 * Generated bid specs (D94) — one saved artifact per generation.
 * Design: docs/superpowers/specs/2026-07-19-bid-spec-generator-design.md
 *
 * The assembled document is FROZEN on save. Regenerating produces a new
 * record rather than mutating this one, so what went out to an architect
 * stays retrievable after the catalog language moves on.
 * ------------------------------------------------------------------ */

function uid(p: string): string {
  return p + Math.random().toString(36).slice(2, 10);
}

export type GeneratedSpec = {
  id: string; // uid('gs-')
  engagementId: string;
  /** "quote:Q-2043" or "upload" — where the equipment list came from. */
  source: string;
  /** The BOM as generated from, kept so a regeneration can be compared. */
  bom: BomRow[];
  /** Frozen output. */
  spec: AssembledSpec;
  /** Rows consciously left unspecified, mirrored for quick display. */
  waivedCount: number;
  createdAt: number;
  createdBy: string;
};

export async function specsForEngagement(engagementId: string): Promise<GeneratedSpec[]> {
  const all = await listDocs<GeneratedSpec>("generated_specs");
  return all
    .filter((s) => s.engagementId === engagementId)
    .sort((a, b) => b.createdAt - a.createdAt);
}

export async function getGeneratedSpec(id: string): Promise<GeneratedSpec | null> {
  return getDoc<GeneratedSpec>("generated_specs", id);
}

export async function saveGeneratedSpec(input: {
  engagementId: string;
  source: string;
  bom: BomRow[];
  spec: AssembledSpec;
  by: string;
}): Promise<GeneratedSpec> {
  const rec: GeneratedSpec = {
    id: uid("gs-"),
    engagementId: input.engagementId,
    source: input.source,
    bom: input.bom,
    spec: input.spec,
    waivedCount: input.spec.waived.length,
    createdAt: Date.now(),
    createdBy: input.by,
  };
  await upsertDoc<GeneratedSpec>("generated_specs", rec);
  return rec;
}
