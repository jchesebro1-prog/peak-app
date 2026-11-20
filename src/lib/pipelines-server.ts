import { getSettings, setSettings, updateSettings } from "@/lib/settings";
import { inTransaction } from "@/db";
import { isPreviewDeploy } from "@/lib/deploy-env";
import { listDocs, type Doc } from "@/db/doc-store";
import {
  resolvePipelines, validateQuotePipeline, quotePipelineFor, carriesPipeline,
  stageById, DEFAULT_PIPELINES, LEAD_QUALIFY_FIX, withLeadQualifyStage, type Pipelines, type QuotePipeline,
} from "@/lib/pipelines";

/**
 * Whether this read may run the one-time Lead / Qualify ensure: not yet marked done, never from a preview deploy
 * (previews share the production database — #353 review I2) and never inside the caller's transaction (#353 review
 * M1: the ensure takes the settings row lock and commits on its own; inside a unit it would ride — or deadlock —
 * the caller's transaction, and `outsideTransaction` can't be awaited there on one-connection PGlite). A skipped
 * read uses the stored list as is; the next eligible read runs it.
 */
export function shouldEnsureLeadQualify(s: { pipelineFixes?: unknown }, ctx: { preview: boolean; inTransaction: boolean }): boolean {
  if (ctx.preview || ctx.inTransaction) return false;
  return !(Array.isArray(s.pipelineFixes) && s.pipelineFixes.includes(LEAD_QUALIFY_FIX));
}

export async function loadPipelines(): Promise<Pipelines> {
  let s = await getSettings();
  if (shouldEnsureLeadQualify(s, { preview: isPreviewDeploy(), inTransaction: inTransaction() })) {
    try {
      await ensureLeadQualifyStage();
      s = await getSettings();
    } catch {
      // A failed ensure never breaks a pipelines read — the next read retries.
    }
  }
  return resolvePipelines(s);
}

/**
 * Jeff 2026-10-15 #42 — one-time, idempotent: a stored quote-pipeline list gets BID SPEC's new Lead / Qualify stage
 * before Collect Information (`withLeadQualifyStage`), under the settings row lock, and the `pipelineFixes` marker
 * is set in the same write — so it runs once per environment and a stage Jeff later deletes in Settings → Pipelines
 * never comes back. With no stored list the seeds already carry the stage; only the marker is written. Records keep
 * their stage. Returns whether the stored list changed.
 */
export async function ensureLeadQualifyStage(): Promise<boolean> {
  let changed = false;
  await updateSettings((cur) => {
    const fixes = Array.isArray(cur.pipelineFixes) ? (cur.pipelineFixes as unknown[]).filter((x): x is string => typeof x === "string") : [];
    changed = false;
    if (fixes.includes(LEAD_QUALIFY_FIX)) return null;
    const stored = Array.isArray(cur.quotePipelines) ? (cur.quotePipelines as QuotePipeline[]) : null;
    // Only a list resolvePipelines would actually use (an invalid one reads as the seeds).
    const valid = !!stored && resolvePipelines({ quotePipelines: stored }).quote === stored;
    const next = valid && stored ? withLeadQualifyStage(stored) : null;
    changed = !!next;
    return { pipelineFixes: [...fixes, LEAD_QUALIFY_FIX], ...(next ? { quotePipelines: next } : {}) };
  });
  return changed;
}

/** Stage ids in use, per pipeline id — the editor's "N records here" and the delete guard. */
export async function stageUsage(): Promise<Record<string, Record<string, number>>> {
  const pipes = await loadPipelines();
  const out: Record<string, Record<string, number>> = {};
  const bump = (pl: string, st: string) => { (out[pl] ||= {})[st] = (out[pl][st] || 0) + 1; };
  for (const q of await listDocs<Doc & { quoteType?: string; pipelineId?: string; stage?: string }>("quotes")) {
    if (!carriesPipeline(q.quoteType) || !q.stage) continue;
    bump(quotePipelineFor(pipes, q).id, q.stage);
  }
  return out;
}

export async function savePipelines(input: {
  quote?: QuotePipeline[]; defaultQuotePipelineId?: string;
}): Promise<{ ok: true } | { ok: false; errors: string[] }> {
  const errors: string[] = [];
  for (const p of input.quote || []) errors.push(...validateQuotePipeline(p).map((e) => `${p.label || p.id}: ${e}`));
  const current = await loadPipelines();
  const usage = await stageUsage();
  const checkRemoved = (before: { id: string; stages: { id: string; label: string }[] }[], after?: { id: string; stages: { id: string }[] }[]) => {
    if (!after) return;
    for (const pl of before) {
      const next = after.find((a) => a.id === pl.id);
      for (const s of pl.stages) {
        const n = usage[pl.id]?.[s.id] || 0;
        if (n > 0 && !next?.stages.some((x) => x.id === s.id))
          errors.push(`"${s.label}" still has ${n} record${n === 1 ? "" : "s"} — move them first.`);
      }
    }
  };
  checkRemoved(current.quote, input.quote);
  if (errors.length) return { ok: false, errors };
  const patch: Record<string, unknown> = {};
  if (input.quote) patch.quotePipelines = input.quote;
  if (input.defaultQuotePipelineId) patch.defaultQuotePipelineId = input.defaultQuotePipelineId;
  await setSettings(patch);
  return { ok: true };
}

/**
 * Settings → Pipelines "Move records": rewrite every live quote parked on an
 * in-use stage to a target stage of the SAME pipeline, so the stage can then
 * be removed. Quotes only move when the source and target stage share a tag:
 * a different tag would change the quote's Draft/Sent/Won status as a side
 * effect, which stays a deliberate action taken from the quote itself, not
 * from Settings.
 *
 * `@/lib/stores/quotes` imports `loadPipelines` from this module, so it is
 * loaded dynamically here to avoid a static import cycle.
 */
export async function moveStageRecords(
  kind: "quote",
  pipelineId: string,
  fromStage: string,
  toStage: string,
  actor: string
): Promise<{ ok: true; moved: number } | { ok: false; error: string }> {
  if (fromStage === toStage) return { ok: false, error: "Pick a different stage to move records to." };
  const pipes = await loadPipelines();

  if (kind !== "quote") return { ok: false, error: "Unknown pipeline or stage." };

  const pl = pipes.quote.find((q) => q.id === pipelineId);
  const from = pl && stageById(pl, fromStage);
  const to = pl && stageById(pl, toStage);
  if (!pl || !from || !to) return { ok: false, error: "Unknown pipeline or stage." };
  if (from.tag !== to.tag)
    return { ok: false, error: "Moving quotes between Draft/Sent/Won stages changes their status — do that from the quote." };
  const targets = (await listDocs<Doc & { quoteType?: string; pipelineId?: string; stage?: string }>("quotes")).filter(
    (q) => carriesPipeline(q.quoteType) && q.stage === fromStage && quotePipelineFor(pipes, q).id === pipelineId
  );
  const { update } = await import("@/lib/stores/quotes");
  let moved = 0;
  for (const q of targets) if (await update(q.id, { stage: toStage })) moved++;
  return { ok: true, moved };
}

export { DEFAULT_PIPELINES };
