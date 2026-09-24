import { getSettings, setSettings } from "@/lib/settings";
import { listDocs, type Doc } from "@/db/doc-store";
import {
  resolvePipelines, validateProjectPipeline, validateQuotePipeline, projectPipelineFor, quotePipelineFor, carriesPipeline,
  DEFAULT_PIPELINES, type Pipelines, type ProjectPipeline, type QuotePipeline,
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
    if (p.stage) bump(pl.id, p.stage);
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

export { DEFAULT_PIPELINES };
