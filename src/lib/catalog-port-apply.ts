import { proposeForPart, type RulePart } from "@/lib/catalog-port-rules";

/**
 * Applying port rules (#159, D196) — the DB-touching half, kept out of the
 * CLI so tests can import it without executing a script's main().
 */

export type ApplyResult = { applied: number; skippedHasPorts: number; byRule: Record<string, number> };

/**
 * Apply ONLY the named rules. Nothing runs without being named (D196) — there
 * is deliberately no "apply all".
 *
 * A part that already has ports is skipped unconditionally: hand edits beat
 * the engine, always. That makes re-running safe and idempotent, so improving
 * a rule and re-running costs nothing.
 *
 * Writes `ports` and nothing else.
 */
export async function applyRules(
  ruleIds: readonly string[],
  opts: { commit: boolean }
): Promise<ApplyResult> {
  const { getDb } = await import("@/db");
  const { catalogParts } = await import("@/db/doc-tables");
  const { mergeUpsert } = await import("@/lib/stores/catalog");
  const wanted = new Set(ruleIds);
  const db = await getDb();
  const rows = await db.select().from(catalogParts);
  const res: ApplyResult = { applied: 0, skippedHasPorts: 0, byRule: {} };

  for (const r of rows) {
    if ((r as { deleted?: boolean }).deleted) continue;
    const d = r.doc as Record<string, unknown>;
    const part: RulePart = {
      sku: String(d.sku || ""), desc: String(d.desc || ""),
      category: String(d.category || ""), mfr: String(d.mfr || ""),
    };
    if (!part.sku) continue;
    const existing = d.ports as unknown[] | undefined;
    const proposal = proposeForPart(part);
    if (!proposal || !wanted.has(proposal.rule.id)) continue;
    if (Array.isArray(existing) && existing.length > 0) { res.skippedHasPorts++; continue; }
    if (opts.commit) await mergeUpsert(part.sku, { ports: proposal.ports });
    res.applied++;
    res.byRule[proposal.rule.id] = (res.byRule[proposal.rule.id] || 0) + 1;
  }
  return res;
}
