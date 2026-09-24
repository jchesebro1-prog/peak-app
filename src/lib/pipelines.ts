/**
 * Pipelines (Daylite stages, spec 2026-09-24-daylite-pipelines-and-history-import §3).
 *
 * Pure — no DB, no settings read. A pipeline is an ordered list of stages; each
 * stage carries a stable kebab-case `id` (stored on records, never shown), an
 * admin-editable `label`, and one fixed TAG. Behaviour (scheduling, risk flags,
 * Field Work, reports, quote status) is decided by the tag only — never by a
 * stage id or label — so Jeff can rename/add/reorder stages in Settings without
 * breaking anything.
 */

export type ProjectTag = "backlog" | "scheduled" | "onsite" | "closeout" | "done";
export type QuoteTag = "draft" | "sent" | "won";
export type PipelineStage<T extends string> = { id: string; label: string; tag: T; advanceOnDelivered?: boolean };
export type Pipeline<T extends string> = { id: string; label: string; stages: PipelineStage<T>[] };
export type ProjectPipeline = Pipeline<ProjectTag>;
export type QuotePipeline = Pipeline<QuoteTag>;
export type Pipelines = { project: ProjectPipeline[]; quote: QuotePipeline[]; defaultQuotePipelineId: string };
/** Derived per read by the projects store; never authoritative. */
export type StageMeta = { pipelineId: string; tag: ProjectTag; label: string; index: number; count: number };

export const PROJECT_TAGS: readonly ProjectTag[] = ["backlog", "scheduled", "onsite", "closeout", "done"];
export const QUOTE_TAGS: readonly QuoteTag[] = ["draft", "sent", "won"];
export const PROJECT_TAG_RANK: Record<ProjectTag, number> = { backlog: 0, scheduled: 1, onsite: 2, closeout: 3, done: 4 };
export const QUOTE_TAG_RANK: Record<QuoteTag, number> = { draft: 0, sent: 1, won: 2 };

/** One colour set per tag — replaces the five divergent stage maps. */
export const PROJECT_TAG_META: Record<ProjectTag, { label: string; ink: string; soft: string; bd: string; dot: string }> = {
  backlog: { label: "Backlog", ink: "#8a6d1f", soft: "#fbf3dd", bd: "#f0e2bd", dot: "#c98a2b" },
  scheduled: { label: "Scheduled", ink: "#3155a8", soft: "#e9eefb", bd: "#d4ddf3", dot: "#3155a8" },
  onsite: { label: "On site", ink: "#6a3fa0", soft: "#f1eafa", bd: "#dfd0f2", dot: "#6a3fa0" },
  closeout: { label: "Closeout", ink: "#1f6f7a", soft: "#e6f4f5", bd: "#c8e6e9", dot: "#1f6f7a" },
  done: { label: "Done", ink: "#1f7a52", soft: "#eaf6ef", bd: "#cce9da", dot: "#1f7a52" },
};

export const DEFAULT_PROJECT_PIPELINES: ProjectPipeline[] = [
  {
    id: "install",
    label: "Install",
    stages: [
      { id: "deposit", label: "Deposit/PO received", tag: "backlog" },
      { id: "equipment-ordered", label: "Equipment ordered", tag: "backlog", advanceOnDelivered: true },
      { id: "initial-contact", label: "Initial contact", tag: "backlog" },
      { id: "scheduled", label: "Scheduled", tag: "scheduled" },
      { id: "installation", label: "Installation", tag: "onsite" },
      { id: "invoice", label: "Invoice", tag: "closeout" },
      { id: "complete", label: "Complete", tag: "done" },
    ],
  },
  {
    id: "order",
    label: "Order",
    stages: [
      { id: "order-materials", label: "Order materials", tag: "backlog" },
      { id: "deliveries", label: "Deliveries", tag: "backlog", advanceOnDelivered: true },
      { id: "delivered", label: "Delivered & accepted", tag: "closeout" },
      { id: "complete", label: "Complete", tag: "done" },
    ],
  },
];

export const DEFAULT_QUOTE_PIPELINES: QuotePipeline[] = [
  {
    id: "estimate-design",
    label: "Estimate/Design",
    stages: [
      { id: "first-contact", label: "First Contact", tag: "draft" },
      { id: "design", label: "Design", tag: "draft" },
      { id: "presentation", label: "Presentation/Delivery", tag: "sent" },
      { id: "acceptance", label: "Acceptance", tag: "won" },
    ],
  },
  {
    id: "bid-spec",
    label: "BID SPEC",
    stages: [
      { id: "collect-info", label: "Collect Information", tag: "draft" },
      { id: "create-bid", label: "Create BID", tag: "draft" },
      { id: "bid-sent", label: "BID Sent", tag: "sent" },
      { id: "awarded", label: "Awarded", tag: "won" },
    ],
  },
];

export const DEFAULT_PIPELINES: Pipelines = {
  project: DEFAULT_PROJECT_PIPELINES,
  quote: DEFAULT_QUOTE_PIPELINES,
  defaultQuotePipelineId: "estimate-design",
};

/** The pre-pipeline 7-stage (and 4-stage order) keys → seeded stage ids (spec §3.6). */
const LEGACY_PROJECT_MAP: Record<string, string> = {
  procurement: "equipment-ordered", delivery: "equipment-ordered", scheduled: "scheduled",
  install: "installation", training: "installation", signoff: "invoice", complete: "complete",
};
const LEGACY_ORDER_MAP: Record<string, string> = {
  procurement: "order-materials", delivery: "deliveries", signoff: "delivered", complete: "complete",
};
/** Frozen labels for stageHistory rows written before pipelines existed. */
export const LEGACY_STAGE_LABELS: Record<string, string> = {
  procurement: "Order materials", delivery: "Deliveries", scheduled: "Crew scheduled",
  install: "Install", training: "Training", signoff: "Customer sign-off", complete: "Complete",
};

const ID_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function baseErrors<T extends string>(p: Pipeline<T>, tags: readonly T[]): string[] {
  const errs: string[] = [];
  if (!p || typeof p !== "object") return ["Pipeline is missing."];
  if (!ID_RE.test(p.id || "")) errs.push("Pipeline id must be lowercase letters, numbers and dashes.");
  if (!(p.label || "").trim()) errs.push("Pipeline needs a name.");
  if (!Array.isArray(p.stages) || p.stages.length < 2) return [...errs, "A pipeline needs at least two stages."];
  const seen = new Set<string>();
  for (const s of p.stages) {
    if (!ID_RE.test(s.id || "")) errs.push(`Stage id "${s.id}" must be lowercase letters, numbers and dashes.`);
    if (seen.has(s.id)) errs.push(`Stage id "${s.id}" is used twice.`);
    seen.add(s.id);
    if (!(s.label || "").trim()) errs.push("Every stage needs a name.");
    if (!tags.includes(s.tag)) errs.push(`Stage "${s.label}" has an unknown tag.`);
  }
  return errs;
}

export function validateProjectPipeline(p: ProjectPipeline): string[] {
  const errs = baseErrors(p, PROJECT_TAGS);
  if (errs.length) return errs;
  const done = p.stages.filter((s) => s.tag === "done");
  if (done.length !== 1) errs.push("A project pipeline needs exactly one Done stage.");
  else if (p.stages[p.stages.length - 1].tag !== "done") errs.push("The Done stage must be last.");
  return errs;
}

export function validateQuotePipeline(p: QuotePipeline): string[] {
  const errs = baseErrors(p, QUOTE_TAGS);
  if (errs.length) return errs;
  if (!p.stages.some((s) => s.tag === "draft")) errs.push("A quote pipeline needs at least one Draft stage.");
  if (p.stages.filter((s) => s.tag === "won").length !== 1 || p.stages[p.stages.length - 1].tag !== "won")
    errs.push("A quote pipeline needs exactly one Won stage, and it must be last.");
  for (let i = 1; i < p.stages.length; i++)
    if (QUOTE_TAG_RANK[p.stages[i].tag] < QUOTE_TAG_RANK[p.stages[i - 1].tag]) {
      errs.push("Quote stages must run Draft → Sent → Won without going backwards.");
      break;
    }
  return errs;
}

function validList<T>(v: unknown, check: (p: T) => string[]): T[] | null {
  if (!Array.isArray(v) || !v.length) return null;
  const ids = new Set<string>();
  for (const p of v as T[]) {
    if (check(p).length) return null;
    const id = (p as { id: string }).id;
    if (ids.has(id)) return null;
    ids.add(id);
  }
  return v as T[];
}

/** Settings → Pipelines. Full-replacement lists (the wireTypes idiom); an invalid stored list reads as the seeds. */
export function resolvePipelines(
  stored: { projectPipelines?: unknown; quotePipelines?: unknown; defaultQuotePipelineId?: unknown } | null | undefined
): Pipelines {
  const project = validList<ProjectPipeline>(stored?.projectPipelines, validateProjectPipeline) || DEFAULT_PROJECT_PIPELINES;
  const quote = validList<QuotePipeline>(stored?.quotePipelines, validateQuotePipeline) || DEFAULT_QUOTE_PIPELINES;
  const want = typeof stored?.defaultQuotePipelineId === "string" ? stored.defaultQuotePipelineId : "";
  const defaultQuotePipelineId = quote.some((q) => q.id === want) ? want
    : quote.some((q) => q.id === "estimate-design") ? "estimate-design" : quote[0].id;
  return { project, quote, defaultQuotePipelineId };
}

export function projectPipelineFor(pipes: Pipelines, rec: { kind?: string | null; pipelineId?: string | null }): ProjectPipeline {
  const byId = rec.pipelineId ? pipes.project.find((p) => p.id === rec.pipelineId) : null;
  if (byId) return byId;
  const want = rec.kind === "order" ? "order" : "install";
  return pipes.project.find((p) => p.id === want) || pipes.project[0];
}

export function quotePipelineFor(pipes: Pipelines, rec: { pipelineId?: string | null }): QuotePipeline {
  return (rec.pipelineId && pipes.quote.find((p) => p.id === rec.pipelineId))
    || pipes.quote.find((p) => p.id === pipes.defaultQuotePipelineId) || pipes.quote[0];
}

export function firstStage<T extends string>(pl: Pipeline<T>): PipelineStage<T> {
  return pl.stages[0];
}
export function firstStageWithTag<T extends string>(pl: Pipeline<T>, tag: T): PipelineStage<T> | null {
  return pl.stages.find((s) => s.tag === tag) || null;
}
export function stageById<T extends string>(pl: Pipeline<T>, stageId: string | null | undefined): PipelineStage<T> | null {
  return (stageId && pl.stages.find((s) => s.id === stageId)) || null;
}
export function nextStage<T extends string>(pl: Pipeline<T>, stageId: string): PipelineStage<T> | null {
  const i = pl.stages.findIndex((s) => s.id === stageId);
  return i >= 0 && i < pl.stages.length - 1 ? pl.stages[i + 1] : null;
}

/** Stored stage → a stage id valid in `pl`: current ids kept, legacy keys mapped, anything else → first stage. */
export function resolveProjectStage(pl: ProjectPipeline, kind: string | null | undefined, stage: string | null | undefined): string {
  if (stageById(pl, stage)) return stage as string;
  const legacy = stage ? (kind === "order" ? LEGACY_ORDER_MAP : LEGACY_PROJECT_MAP)[stage] : undefined;
  if (legacy && stageById(pl, legacy)) return legacy;
  if (stage === "complete" || legacy === "complete") {
    const done = pl.stages.find((s) => s.tag === "done");
    if (done) return done.id;
  }
  return firstStage(pl).id;
}

export function projectStageMeta(pipes: Pipelines, rec: { kind?: string | null; pipelineId?: string | null; stage?: string | null }): StageMeta {
  const pl = projectPipelineFor(pipes, rec);
  const id = resolveProjectStage(pl, rec.kind, rec.stage);
  const index = pl.stages.findIndex((s) => s.id === id);
  const s = pl.stages[index];
  return { pipelineId: pl.id, tag: s.tag, label: s.label, index, count: pl.stages.length };
}

type TagRec = { kind?: string | null; pipelineId?: string | null; stage?: string | null; stageMeta?: StageMeta | null };

/** The stamped meta when present (fresh from the store), else computed — against the seeds if no pipelines passed. */
export function projectTag(rec: TagRec, pipes: Pipelines = DEFAULT_PIPELINES): ProjectTag {
  return rec.stageMeta?.tag || projectStageMeta(pipes, rec).tag;
}
export const isDone = (rec: TagRec, pipes?: Pipelines) => projectTag(rec, pipes) === "done";
export const isOnSite = (rec: TagRec, pipes?: Pipelines) => projectTag(rec, pipes) === "onsite";
export const isBacklog = (rec: TagRec, pipes?: Pipelines) => projectTag(rec, pipes) === "backlog";
export const isActive = (rec: TagRec, pipes?: Pipelines) => {
  const t = projectTag(rec, pipes);
  return t === "scheduled" || t === "onsite" || t === "closeout";
};

/** Label for any stage id a record may carry in its history — current, legacy, or unknown. */
export function stageLabelFor(pipes: Pipelines, rec: { kind?: string | null; pipelineId?: string | null }, stageId: string | null | undefined): string {
  if (!stageId) return "";
  const s = stageById(projectPipelineFor(pipes, rec), stageId);
  return s ? s.label : LEGACY_STAGE_LABELS[stageId] || stageId;
}

/* ---------- quotes ---------- */

export function carriesPipeline(quoteType: string | null | undefined): boolean {
  return !quoteType || quoteType === "system";
}

export function statusForQuoteStage(pl: QuotePipeline, stageId: string): QuoteTag | null {
  return stageById(pl, stageId)?.tag || null;
}

/**
 * Where the stage should sit after a status write. `lost` leaves it alone (history of where
 * the deal died). A status whose tag matches the current stage's keeps it; otherwise snap to
 * the first stage carrying that status.
 */
export function quoteStageForStatus(pl: QuotePipeline, status: string, currentStageId: string | null | undefined): string | null {
  const cur = stageById(pl, currentStageId);
  if (status === "lost") return cur ? cur.id : null;
  if (!QUOTE_TAGS.includes(status as QuoteTag)) return cur ? cur.id : null;
  if (cur && cur.tag === status) return cur.id;
  return firstStageWithTag(pl, status as QuoteTag)?.id || firstStage(pl).id;
}
