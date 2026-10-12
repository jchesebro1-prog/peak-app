"use server";

import { sanitizeBomProjectionCounted } from "@/lib/estimate-output/bom-projection";
import { specPackageDocs } from "@/lib/estimate-output/package-docs-server";
import { bomMemberParents, clientDatasheetRows, type ClientDatasheetRow } from "@/lib/estimate-output/package-preview";
import type { FixtureRecord } from "@/lib/fixture-assemblies";
import { needsFixtureLookup } from "@/lib/quote-line-members";
import { requireUser } from "@/lib/session";
import { listFixtures } from "@/lib/stores/fixtures";

/** `truncated` — BOM entries the server's caps dropped (#333 review J), so the tab can say so. */
export type ClientPackageDocsResult = { ok: true; rows: ClientDatasheetRow[]; truncated: number } | { ok: false; error: string };

/**
 * #333 (spec 2026-10-12 §7.3, D-TBD-l) — the Client package tab's datasheet
 * rows, from the UNSAVED editor's trimmed BOM (bom-projection.ts). Any
 * signed-in team member, read-only (reviewDocsAction's rule). It runs the
 * package's own BOM + coverage rule with NO exclusions — the browser applies
 * the project's choices with the same pure rule the server uses
 * (part-docs/exclusions.ts), so a tick shows its effect instantly. Links are
 * staff routes only. Never throws.
 */
export async function clientPackageDocsAction(input: { sections: unknown }): Promise<ClientPackageDocsResult> {
  await requireUser();
  try {
    const { sections, dropped } = sanitizeBomProjectionCounted(input && typeof input === "object" ? (input as { sections?: unknown }).sections : null);
    // The rows' "Part of" walk needs the live assemblies only when some line resolves through one (#332).
    const needs = sections.some((s) => s.items.some((it) => needsFixtureLookup(it)));
    const fixtures = needs ? new Map((await listFixtures()).map((f) => [f.id, f] as const)) : new Map<string, FixtureRecord>();
    const docs = await specPackageDocs({ sections }, null);
    const members = bomMemberParents(sections, (id) => fixtures.get(id), docs.moved);
    return { ok: true, rows: clientDatasheetRows(docs, members), truncated: dropped };
  } catch (e) {
    console.warn("[client package] datasheet rows unavailable", e instanceof Error ? e.message : e);
    return { ok: false, error: "Couldn't load datasheets." };
  }
}
