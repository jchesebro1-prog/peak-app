import { proposeForPart, type RulePart } from "@/lib/catalog-port-rules";

/**
 * Applying port rules (#159, D196) — the DB-touching half, kept out of the
 * CLI so tests can import it without executing a script's main().
 */

export type ApplyResult = { applied: number; skippedHasPorts: number; byRule: Record<string, number> };

/**
 * A description that is really a model/part number, not prose — e.g. a bare
 * SKU repeated as the description, or a brand (Biamp/JBL, D192) that never
 * writes real prose at all. A rule can still technically match text like
 * this by accident, but no one reviewed that as a real proposal, so it must
 * not be treated as one.
 *
 * Shared between the report (scripts/port-rules.ts) and this apply path —
 * they MUST agree on which parts are even eligible, or the report undercounts
 * what apply would actually write. That is exactly how gate FIX 1 happened:
 * the report had its own local copy of this predicate and the apply path had
 * none, so a dry run wrote 90 rows (6%) the report never showed anyone. Do
 * not fork a second copy of this function — import it.
 */
export function isModelish(desc: string, sku: string): boolean {
  const d = (desc || "").trim();
  if (!d) return true;
  if (!/\s/.test(d)) return true;
  if (/^[\d.\-]+$/.test(d)) return true;
  const bare = sku.includes(":") ? sku.slice(sku.indexOf(":") + 1) : sku;
  return d.replace(/[^a-z0-9]/gi, "").toUpperCase() === bare.replace(/[^a-z0-9]/gi, "").toUpperCase();
}

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
    if (isModelish(part.desc, part.sku)) continue;
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
