import { getSettings, setSettings } from "@/lib/settings";
import { listDocs, type Doc } from "@/db/doc-store";
import {
  resolvePipelines, resolveProjectStage, validateProjectPipeline, validateQuotePipeline, projectPipelineFor, quotePipelineFor, carriesPipeline,
  stageById, DEFAULT_PIPELINES, type Pipelines, type ProjectPipeline, type QuotePipeline,
} from "@/lib/pipelines";

export async function loadPipelines(): Promise<Pipelines> {
  const s = await getSettings();
  return resolvePipelines(s);
}

/** Stage ids in use, per pipeline id — the editor's "N records here" and the delete guard. */
export async function stageUsage(): Promise<Record<string, Record<string, number>>> {
  const pipes = await loadPipelines();
  const out: Record<string, Record<string, number>> = {};
  const bump = (pl: string, st: string) => { (out[pl] ||= {})[st] = (out[pl][st] || 0) + 1; };
  for (const p of await listDocs<Doc & { kind?: string; pipelineId?: string; stage?: string }>("projects")) {
    const pl = projectPipelineFor(pipes, p);
    // A doc not yet re-saved may still carry a pre-pipeline key — count it where it reads.
    if (p.stage) bump(pl.id, resolveProjectStage(pl, p.kind, p.stage));
  }
  for (const q of await listDocs<Doc & { quoteType?: string; pipelineId?: string; stage?: string }>("quotes")) {
    if (!carriesPipeline(q.quoteType) || !q.stage) continue;
    bump(quotePipelineFor(pipes, q).id, q.stage);
  }
  return out;
}

export async function savePipelines(input: {
  project?: ProjectPipeline[]; quote?: QuotePipeline[]; defaultQuotePipelineId?: string;
}): Promise<{ ok: true } | { ok: false; errors: string[] }> {
  const errors: string[] = [];
  for (const p of input.project || []) errors.push(...validateProjectPipeline(p).map((e) => `${p.label || p.id}: ${e}`));
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
  checkRemoved(current.project, input.project);
  checkRemoved(current.quote, input.quote);
  if (errors.length) return { ok: false, errors };
  const patch: Record<string, unknown> = {};
  if (input.project) patch.projectPipelines = input.project;
  if (input.quote) patch.quotePipelines = input.quote;
  if (input.defaultQuotePipelineId) patch.defaultQuotePipelineId = input.defaultQuotePipelineId;
  await setSettings(patch);
  return { ok: true };
}

/**
 * Settings → Pipelines "Move records": rewrite every live record parked on
 * an in-use stage to a target stage of the SAME pipeline, so the stage can
 * then be removed. Projects go through `setProjectStage` (records history,
 * runs the checklist/Done hooks — same as a normal drag). Quotes only move
 * when the source and target stage share a tag: a different tag would change
 * the quote's Draft/Sent/Won status as a side effect, which stays a
 * deliberate action taken from the quote itself, not from Settings.
 *
 * The store modules (`@/lib/stores/projects`, `@/lib/stores/quotes`) both
 * import `loadPipelines` from this module, so they're loaded dynamically
 * here to avoid a static import cycle — the same pattern `projects.ts` uses
 * for `@/lib/stores/tasks` inside `afterStageChange`.
 */
export async function moveStageRecords(
  kind: "project" | "quote",
  pipelineId: string,
  fromStage: string,
  toStage: string,
  actor: string
): Promise<{ ok: true; moved: number } | { ok: false; error: string }> {
  if (fromStage === toStage) return { ok: false, error: "Pick a different stage to move records to." };
  const pipes = await loadPipelines();

  if (kind === "project") {
    const pl = pipes.project.find((p) => p.id === pipelineId);
    if (!pl || !stageById(pl, fromStage) || !stageById(pl, toStage))
      return { ok: false, error: "Unknown pipeline or stage." };
    const { getAllProjects, setProjectStage } = await import("@/lib/stores/projects");
    const targets = (await getAllProjects()).filter(
      (p) => projectPipelineFor(pipes, p).id === pipelineId && p.stage === fromStage
    );
    let moved = 0;
    for (const p of targets) if (await setProjectStage(p.id, toStage, actor)) moved++;
    return { ok: true, moved };
  }

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
