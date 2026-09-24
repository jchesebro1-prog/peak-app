# Daylite Pipelines + History Import Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace hardcoded install-project stages with Settings-editable, Daylite-named pipelines (projects + system quotes), then import Jeff's Daylite project/opportunity history onto them.

**Architecture:** A pure `src/lib/pipelines.ts` owns pipeline types, seeds, validation, legacy-stage conversion and tag helpers. Stores stamp a derived `stageMeta` (tag/label/index/count) onto every project they read, so sync consumers ask `isDone(p)` etc. without loading settings. Quotes keep `status` as the field every module reads; a quote pipeline stage's tag *is* the status, kept in lock-step both directions. Part 2 is a pure classifier (`src/lib/daylite/history.ts`) plus a server commit module and an Import-hub card with preview → confirm.

**Tech Stack:** Next.js 16 App Router, TypeScript, Drizzle doc-store (JSONB docs in `projects`, `quotes`, `repair_jobs`), PGlite in dev/tests, spec harness `scripts/test-review-and-spec.ts` (plain `ok(cond, msg)` assertions).

**Spec:** `docs/superpowers/specs/2026-09-24-daylite-pipelines-and-history-import-design.md` — read it first; this plan implements it section by section.

## Global Constraints

- Worktree: `/Users/sm/Downloads/peak-app-worktree-daylite-pipelines`, branch `feat/daylite-pipelines`. Node: `export PATH=$HOME/.local/node/bin:$PATH`.
- **Never open `.data/pglite`.** Tests run on `npm run test:specs` (it sets a temp `PGLITE_PATH`). Never set `DATABASE_URL`.
- **Never `git stash`** (shared across worktrees). Commit instead.
- Code never compares stage ids or labels for behaviour — only tags (`backlog|scheduled|onsite|closeout|done`; quotes `draft|sent|won`).
- Seed stage ids/labels exactly as spec §3.2. Stage ids are kebab-case and immutable.
- Only quotes with `quoteType` `"system"` or missing carry a pipeline.
- Timestamps epoch-ms numbers. Keep existing copy/naming style; comment density like surrounding code.
- Every task ends green on: `npx tsc --noEmit` (0 errors), `npm run test:specs` (0 FAIL), `npx eslint <touched files>` (no new errors).
- Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## File Structure

| File | Responsibility |
|---|---|
| `src/lib/pipelines.ts` (new, pure) | types, seeds, validate, resolve, legacy map, stage meta, tag predicates, quote stage⇄status |
| `src/lib/pipelines-server.ts` (new) | `loadPipelines()` from settings; `savePipelines()` with validation |
| `src/lib/settings.ts` | `projectPipelines?`, `quotePipelines?`, `defaultQuotePipelineId?` on `AppSettingsData` |
| `src/lib/stores/projects.ts` | stage = pipeline stage id; normalizer converts + stamps `stageMeta`; tag-driven automation |
| `src/lib/stores/tasks.ts` | `TASK_TEMPLATE` re-keyed by stage id |
| `src/lib/stores/quotes.ts` | `pipelineId`/`stage` on system quotes; `setQuoteStage`; status→stage snap |
| project consumers (views, metrics, schedule, field-work, …) | tag predicates + `stageMeta` instead of literals |
| `src/app/(app)/settings/pipelines/*` (new) | Pipelines editor |
| `src/lib/job-value.ts` (new, pure) | `formatJobValue`, `knownValue` (UKN) |
| `scripts/daylite-ids.ts` | + `repairId`, `quoteId` |
| `src/lib/daylite/history.ts` (new, pure) | TSV parse, classify, stage maps, company splitter, row → plan |
| `src/lib/daylite/history-commit.ts` (new, server) | resolve against DB → preview; commit writes |
| `src/app/(app)/import/daylite/*` (new) | Import-hub card, preview, confirm |

---

## PART 1 — PIPELINES

### Task 1: Pure pipelines module

**Files:**
- Create: `src/lib/pipelines.ts`
- Test: `scripts/test-review-and-spec.ts` (append a block at the end, before the final summary/exit)

**Interfaces — Produces** (every later task relies on these exact names):
```ts
export type ProjectTag = "backlog" | "scheduled" | "onsite" | "closeout" | "done";
export type QuoteTag = "draft" | "sent" | "won";
export type PipelineStage<T extends string> = { id: string; label: string; tag: T; advanceOnDelivered?: boolean };
export type Pipeline<T extends string> = { id: string; label: string; stages: PipelineStage<T>[] };
export type ProjectPipeline = Pipeline<ProjectTag>;
export type QuotePipeline = Pipeline<QuoteTag>;
export type Pipelines = { project: ProjectPipeline[]; quote: QuotePipeline[]; defaultQuotePipelineId: string };
export type StageMeta = { pipelineId: string; tag: ProjectTag; label: string; index: number; count: number };
export const PROJECT_TAG_META: Record<ProjectTag, { label: string; ink: string; soft: string; bd: string; dot: string }>;
export const DEFAULT_PROJECT_PIPELINES: ProjectPipeline[];   // install, order
export const DEFAULT_QUOTE_PIPELINES: QuotePipeline[];       // estimate-design, bid-spec
export const DEFAULT_PIPELINES: Pipelines;
export const LEGACY_STAGE_LABELS: Record<string, string>;
export function validateProjectPipeline(p: ProjectPipeline): string[];
export function validateQuotePipeline(p: QuotePipeline): string[];
export function resolvePipelines(stored: { projectPipelines?: unknown; quotePipelines?: unknown; defaultQuotePipelineId?: unknown } | null | undefined): Pipelines;
export function projectPipelineFor(pipes: Pipelines, rec: { kind?: string | null; pipelineId?: string | null }): ProjectPipeline;
export function quotePipelineFor(pipes: Pipelines, rec: { pipelineId?: string | null }): QuotePipeline;
export function firstStage<T extends string>(pl: Pipeline<T>): PipelineStage<T>;
export function firstStageWithTag<T extends string>(pl: Pipeline<T>, tag: T): PipelineStage<T> | null;
export function nextStage<T extends string>(pl: Pipeline<T>, stageId: string): PipelineStage<T> | null;
export function stageById<T extends string>(pl: Pipeline<T>, stageId: string | null | undefined): PipelineStage<T> | null;
export function resolveProjectStage(pl: ProjectPipeline, kind: string | null | undefined, stage: string | null | undefined): string;
export function projectStageMeta(pipes: Pipelines, rec: { kind?: string | null; pipelineId?: string | null; stage?: string | null }): StageMeta;
export function projectTag(rec: { kind?: string | null; pipelineId?: string | null; stage?: string | null; stageMeta?: StageMeta | null }, pipes?: Pipelines): ProjectTag;
export function isDone(rec: Parameters<typeof projectTag>[0], pipes?: Pipelines): boolean;
export function isOnSite(rec: Parameters<typeof projectTag>[0], pipes?: Pipelines): boolean;
export function isBacklog(rec: Parameters<typeof projectTag>[0], pipes?: Pipelines): boolean;
export function isActive(rec: Parameters<typeof projectTag>[0], pipes?: Pipelines): boolean; // scheduled|onsite|closeout
export function stageLabelFor(pipes: Pipelines, rec: { kind?: string | null; pipelineId?: string | null }, stageId: string | null | undefined): string; // history rows
export const PROJECT_TAG_RANK: Record<ProjectTag, number>;
export const QUOTE_TAG_RANK: Record<QuoteTag, number>;
export function carriesPipeline(quoteType: string | null | undefined): boolean;
export function statusForQuoteStage(pl: QuotePipeline, stageId: string): QuoteTag | null;
export function quoteStageForStatus(pl: QuotePipeline, status: string, currentStageId: string | null | undefined): string | null;
```

- [ ] **Step 1: Write the failing tests** — append to `scripts/test-review-and-spec.ts` (imports may sit mid-file; the file already does this):

```ts
/* ============ PIPELINES (Daylite stages) — pure ============ */
import {
  DEFAULT_PIPELINES, DEFAULT_PROJECT_PIPELINES, DEFAULT_QUOTE_PIPELINES, validateProjectPipeline, validateQuotePipeline,
  resolvePipelines, projectPipelineFor, quotePipelineFor, firstStage, firstStageWithTag, nextStage, resolveProjectStage,
  projectStageMeta, projectTag, isDone, isOnSite, isBacklog, isActive, stageLabelFor, carriesPipeline,
  statusForQuoteStage, quoteStageForStatus,
} from "@/lib/pipelines";
{
  const install = DEFAULT_PROJECT_PIPELINES.find((p) => p.id === "install")!;
  ok(install.stages.map((s) => s.id).join(",") === "deposit,equipment-ordered,initial-contact,scheduled,installation,invoice,complete", "pipelines: install seed ids in Daylite order");
  ok(install.stages.map((s) => s.label).join("|") === "Deposit/PO received|Equipment ordered|Initial contact|Scheduled|Installation|Invoice|Complete", "pipelines: install seed labels");
  ok(install.stages.map((s) => s.tag).join(",") === "backlog,backlog,backlog,scheduled,onsite,closeout,done", "pipelines: install seed tags");
  ok(install.stages.find((s) => s.id === "equipment-ordered")?.advanceOnDelivered === true, "pipelines: equipment-ordered advances on delivered");
  const order = DEFAULT_PROJECT_PIPELINES.find((p) => p.id === "order")!;
  ok(order.stages.map((s) => s.id + ":" + s.tag).join(",") === "order-materials:backlog,deliveries:backlog,delivered:closeout,complete:done", "pipelines: order seed");
  const ed = DEFAULT_QUOTE_PIPELINES.find((p) => p.id === "estimate-design")!;
  const bs = DEFAULT_QUOTE_PIPELINES.find((p) => p.id === "bid-spec")!;
  ok(ed.stages.map((s) => s.id + ":" + s.tag).join(",") === "first-contact:draft,design:draft,presentation:sent,acceptance:won", "pipelines: estimate-design seed");
  ok(bs.stages.map((s) => s.id + ":" + s.tag).join(",") === "collect-info:draft,create-bid:draft,bid-sent:sent,awarded:won", "pipelines: bid-spec seed");
  ok(DEFAULT_PIPELINES.defaultQuotePipelineId === "estimate-design", "pipelines: default quote pipeline");
  for (const p of DEFAULT_PROJECT_PIPELINES) ok(validateProjectPipeline(p).length === 0, `pipelines: seed ${p.id} validates`);
  for (const p of DEFAULT_QUOTE_PIPELINES) ok(validateQuotePipeline(p).length === 0, `pipelines: seed ${p.id} validates`);

  // validator
  ok(validateProjectPipeline({ id: "x", label: "X", stages: [{ id: "a", label: "A", tag: "done" }] }).length > 0, "pipelines: a done-only pipeline is refused");
  ok(validateProjectPipeline({ id: "x", label: "X", stages: [{ id: "a", label: "A", tag: "done" }, { id: "b", label: "B", tag: "backlog" }] }).length > 0, "pipelines: done must be last");
  ok(validateProjectPipeline({ id: "x", label: "X", stages: [{ id: "a", label: "A", tag: "backlog" }, { id: "a", label: "B", tag: "done" }] }).length > 0, "pipelines: duplicate stage ids refused");
  ok(validateProjectPipeline({ id: "x", label: "X", stages: [{ id: "a", label: " ", tag: "backlog" }, { id: "b", label: "B", tag: "done" }] }).length > 0, "pipelines: blank label refused");
  ok(validateQuotePipeline({ id: "q", label: "Q", stages: [{ id: "a", label: "A", tag: "sent" }, { id: "b", label: "B", tag: "won" }] }).length > 0, "pipelines: quote needs a draft stage");
  ok(validateQuotePipeline({ id: "q", label: "Q", stages: [{ id: "a", label: "A", tag: "draft" }, { id: "b", label: "B", tag: "won" }, { id: "c", label: "C", tag: "sent" }] }).length > 0, "pipelines: quote tags must not go backwards / won last");

  // resolve: absent → defaults; invalid stored list → defaults; valid stored → used
  ok(resolvePipelines(null).project.length === 2, "pipelines: absent settings resolve to seeds");
  ok(resolvePipelines({ projectPipelines: [{ id: "bad", label: "B", stages: [] }] }).project[0].id === "install", "pipelines: an invalid stored list falls back to seeds");
  const custom = resolvePipelines({ projectPipelines: [{ id: "install", label: "Install", stages: [{ id: "a", label: "A", tag: "backlog" }, { id: "z", label: "Z", tag: "done" }] }, order] });
  ok(custom.project[0].stages.length === 2, "pipelines: a valid stored list wins");
  ok(resolvePipelines({ defaultQuotePipelineId: "nope" }).defaultQuotePipelineId === "estimate-design", "pipelines: unknown default quote pipeline falls back");

  // pipeline lookup
  ok(projectPipelineFor(DEFAULT_PIPELINES, { kind: "order" }).id === "order", "pipelines: order kind → order pipeline");
  ok(projectPipelineFor(DEFAULT_PIPELINES, { kind: "project" }).id === "install", "pipelines: project kind → install pipeline");
  ok(projectPipelineFor(DEFAULT_PIPELINES, { kind: "project", pipelineId: "gone" }).id === "install", "pipelines: unknown pipelineId falls back by kind");
  ok(quotePipelineFor(DEFAULT_PIPELINES, { pipelineId: "bid-spec" }).id === "bid-spec", "pipelines: quote pipeline by id");
  ok(quotePipelineFor(DEFAULT_PIPELINES, {}).id === "estimate-design", "pipelines: quote default pipeline");
  ok(firstStage(install).id === "deposit" && firstStageWithTag(install, "closeout")?.id === "invoice", "pipelines: first / first-with-tag");
  ok(nextStage(install, "equipment-ordered")?.id === "initial-contact" && nextStage(install, "complete") === null, "pipelines: nextStage");

  // legacy conversion (spec §3.6)
  const conv = (kind: string, s: string) => resolveProjectStage(projectPipelineFor(DEFAULT_PIPELINES, { kind }), kind, s);
  ok(conv("project", "procurement") === "equipment-ordered" && conv("project", "delivery") === "equipment-ordered", "pipelines: legacy procurement/delivery → equipment-ordered");
  ok(conv("project", "scheduled") === "scheduled" && conv("project", "install") === "installation" && conv("project", "training") === "installation", "pipelines: legacy scheduled/install/training");
  ok(conv("project", "signoff") === "invoice" && conv("project", "complete") === "complete", "pipelines: legacy signoff → invoice, complete stays");
  ok(conv("order", "procurement") === "order-materials" && conv("order", "delivery") === "deliveries" && conv("order", "signoff") === "delivered" && conv("order", "complete") === "complete", "pipelines: legacy order stages");
  ok(conv("project", "") === "deposit" && conv("project", "bogus") === "deposit", "pipelines: missing/unknown → first stage");
  ok(conv("project", "invoice") === "invoice", "pipelines: a current id is kept");

  // meta + predicates
  const m = projectStageMeta(DEFAULT_PIPELINES, { kind: "project", stage: "installation" });
  ok(m.tag === "onsite" && m.label === "Installation" && m.index === 4 && m.count === 7 && m.pipelineId === "install", "pipelines: stage meta");
  ok(isOnSite({ kind: "project", stage: "installation" }) && !isDone({ kind: "project", stage: "installation" }), "pipelines: isOnSite / isDone");
  ok(isDone({ kind: "project", stage: "complete" }) && isDone({ kind: "project", stage: "complete" }, DEFAULT_PIPELINES), "pipelines: complete is done");
  ok(isDone({ kind: "project", stage: "complete-legacy-unknown", stageMeta: { pipelineId: "install", tag: "done", label: "Complete", index: 6, count: 7 } }), "pipelines: stamped stageMeta wins over recomputation");
  ok(isBacklog({ kind: "project", stage: "procurement" }), "pipelines: a legacy stage on an unconverted record still resolves (offline copies)");
  ok(isActive({ kind: "project", stage: "invoice" }) && !isActive({ kind: "project", stage: "deposit" }), "pipelines: isActive = scheduled|onsite|closeout");
  ok(projectTag({ kind: "order", stage: "delivered" }) === "closeout", "pipelines: projectTag for orders");
  ok(stageLabelFor(DEFAULT_PIPELINES, { kind: "project" }, "training") === "Training" && stageLabelFor(DEFAULT_PIPELINES, { kind: "project" }, "scheduled") === "Scheduled", "pipelines: history labels — legacy keys keep their old names");

  // quotes
  ok(carriesPipeline("system") && carriesPipeline(undefined) && !carriesPipeline("flame_test") && !carriesPipeline("consulting"), "pipelines: only system quotes carry a pipeline");
  ok(statusForQuoteStage(ed, "design") === "draft" && statusForQuoteStage(ed, "presentation") === "sent" && statusForQuoteStage(ed, "acceptance") === "won", "pipelines: stage → status");
  ok(quoteStageForStatus(ed, "sent", "first-contact") === "presentation", "pipelines: status sent snaps a draft-stage quote forward");
  ok(quoteStageForStatus(ed, "draft", "design") === "design", "pipelines: same-tag status keeps the current stage");
  ok(quoteStageForStatus(ed, "won", "presentation") === "acceptance", "pipelines: won snaps to the won stage");
  ok(quoteStageForStatus(ed, "lost", "presentation") === "presentation", "pipelines: lost leaves the stage where the deal died");
  ok(quoteStageForStatus(ed, "draft", null) === "first-contact", "pipelines: no stage + draft → first stage");
  ok(quoteStageForStatus(ed, "sent", "acceptance") === "presentation", "pipelines: a status moving backwards moves the stage back to that status's first stage");
}
```

- [ ] **Step 2: Run to verify failure** — `npm run test:specs 2>&1 | tail -5` → fails to compile: `Cannot find module '@/lib/pipelines'`.

- [ ] **Step 3: Implement `src/lib/pipelines.ts`**

```ts
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
```

- [ ] **Step 4: Run** `npm run test:specs 2>&1 | grep -E "FAIL|pipelines" | head -80` → every `pipelines:` line PASS, no FAIL.
- [ ] **Step 5:** `npx tsc --noEmit` (0) and `npx eslint src/lib/pipelines.ts`.
- [ ] **Step 6: Commit** — `git add src/lib/pipelines.ts scripts/test-review-and-spec.ts && git commit -m "feat(pipelines): pure pipeline model — Daylite seeds, tags, legacy conversion, quote stage⇄status"`

---

### Task 2: Settings storage + server loader

**Files:**
- Modify: `src/lib/settings.ts` (`AppSettingsData`)
- Create: `src/lib/pipelines-server.ts`
- Test: `scripts/test-review-and-spec.ts`

**Interfaces — Consumes:** Task 1. **Produces:**
```ts
// src/lib/pipelines-server.ts
export async function loadPipelines(): Promise<Pipelines>;              // getSettings() → resolvePipelines
export async function savePipelines(input: { project?: ProjectPipeline[]; quote?: QuotePipeline[]; defaultQuotePipelineId?: string }): Promise<{ ok: true } | { ok: false; errors: string[] }>;
```

- [ ] **Step 1:** Add to `AppSettingsData` (after `gridCategoryShapes`), in the file's comment style:
```ts
  /** Pipelines (spec 2026-09-24 §3) — FULL REPLACEMENT lists (the wireTypes
   *  idiom). resolvePipelines in lib/pipelines returns the Daylite seeds when
   *  absent or invalid. Edited in Settings → Pipelines. */
  projectPipelines?: import("@/lib/pipelines").ProjectPipeline[];
  quotePipelines?: import("@/lib/pipelines").QuotePipeline[];
  defaultQuotePipelineId?: string;
```
- [ ] **Step 2: Failing test** (DB-backed; the harness has a temp PGlite):
```ts
import { loadPipelines, savePipelines } from "@/lib/pipelines-server";
{
  const before = await loadPipelines();
  ok(before.project[0].id === "install", "pipelines-server: fresh settings load the seeds");
  const bad = await savePipelines({ project: [{ id: "install", label: "Install", stages: [{ id: "a", label: "A", tag: "done" }] }] });
  ok(!bad.ok && bad.errors.length > 0, "pipelines-server: an invalid pipeline is refused, not stored");
  const install = before.project[0];
  const renamed = { ...install, stages: install.stages.map((s) => s.id === "invoice" ? { ...s, label: "Final invoice" } : s) };
  const good = await savePipelines({ project: [renamed, before.project[1]] });
  ok(good.ok, "pipelines-server: a valid edit saves");
  ok((await loadPipelines()).project[0].stages.find((s) => s.id === "invoice")?.label === "Final invoice", "pipelines-server: the saved label reads back");
  const idChange = await savePipelines({ project: [{ ...install, stages: install.stages.map((s) => s.id === "invoice" ? { ...s, id: "billing" } : s) }, before.project[1]] });
  ok(!idChange.ok, "pipelines-server: removing a stage id that exists in the current pipeline requires the in-use check (Task 7) — refused here when records use it; with none, allowed");
  await savePipelines({ project: before.project, quote: before.quote, defaultQuotePipelineId: "estimate-design" }); // restore
}
```
  NOTE on the `idChange` assertion: `savePipelines` must refuse removing any stage id that a live (non-deleted) project/quote currently sits in. With a fresh test DB the seeded test projects (if any) may sit in `invoice`; to keep the assertion deterministic, create one project at `invoice` before it:
  ```ts
  const { createProject, removeProject } = await import("@/lib/stores/projects");
  const tmp = await createProject({ name: "pipelines-server tmp", stage: "invoice" });
  // …idChange assertion…
  await removeProject(tmp.id);
  ```
  (Task 3 makes `createProject` accept stage ids; until then this block runs after Task 3 — place it with Task 3's tests if Task 2 lands first, and keep the in-use refusal here.)
- [ ] **Step 3: Implement** `src/lib/pipelines-server.ts`:
```ts
import "server-only";
import { getSettings, setSettings } from "@/lib/settings";
import { listDocs } from "@/db/doc-store";
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
  for (const p of await listDocs<{ kind?: string; pipelineId?: string; stage?: string }>("projects")) {
    const pl = projectPipelineFor(pipes, p);
    if (p.stage) bump(pl.id, p.stage);
  }
  for (const q of await listDocs<{ quoteType?: string; pipelineId?: string; stage?: string }>("quotes")) {
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
  await setSettings(patch as never);
  return { ok: true };
}

export { DEFAULT_PIPELINES };
```
  Check `setSettings`'s real signature in `src/lib/settings.ts:198` and adapt the call (it may take `(patch, actor)`); if `server-only` is not used elsewhere in `src/lib`, drop that import line (follow the neighbouring files).
- [ ] **Step 4:** tests PASS; tsc 0; eslint clean.
- [ ] **Step 5: Commit** `feat(pipelines): settings storage, loader and validated save with in-use guard`

---

### Task 3: Projects store on pipelines

**Files:**
- Modify: `src/lib/stores/projects.ts`, `src/lib/stores/tasks.ts`, `src/app/(app)/projects/actions.ts` (signoff/done hook only), `src/app/api/sync/push/route.ts` (normalize projects on push — read it first; if pushes go through a shared doc writer, normalize there for collection `projects`)
- Test: `scripts/test-review-and-spec.ts`

**Interfaces — Consumes:** Tasks 1–2. **Produces:**
```ts
// projects.ts
export type ProjectStage = string;                        // a pipeline stage id (kept as alias so imports compile)
ProjectRecord += { pipelineId: string; stageMeta?: StageMeta; valueUnknown?: boolean; legacyOwner?: string;
                   source?: { system: "daylite"; importedAt: number } | null };
ProjectStageChange = { at: number; from: string | null; to: string; by: string };
export function normalizeProject(p: ProjectRecord, pipes: Pipelines): ProjectRecord;   // now exported (import + sync use it)
export async function setProjectStage(id: string, stageId: string, by?: string): Promise<ProjectRecord | null>; // refuses ids not in the project's pipeline (returns null)
export function stagesOf(p: ProjectRecord, pipes: Pipelines): PipelineStage<ProjectTag>[];
export function progressPct(p: ProjectRecord): number;    // from stageMeta
export function riskFlags(p: ProjectRecord): RiskFlag[];  // isDone / isBacklog
// compatibility shims — REMOVED in Task 4b:
export const PROJECT_STAGES: StageDef[]; export const ORDER_STAGES: StageDef[];
export function stagesFor(kind: ProjectKind): StageDef[]; export function stageIndex(kind: ProjectKind, stage: string): number;
// StageDef = { key: string; label: string; short: string } built from DEFAULT_PIPELINES
```

- [ ] **Step 1: Failing tests** (DB-backed):
```ts
import * as ProjStore from "@/lib/stores/projects";
import { tasksForProject } from "@/lib/stores/tasks";
{
  const P = ProjStore;
  const a = await P.createProject({ name: "pl-test A" });
  ok(a.pipelineId === "install" && a.stage === "deposit", "projects: a new install lands at Deposit/PO received");
  ok(a.stageHistory.length === 1 && a.stageHistory[0].to === "deposit", "projects: opening history entry at the first stage");
  const o = await P.createProject({ name: "pl-test O", kind: "order" });
  ok(o.pipelineId === "order" && o.stage === "order-materials", "projects: an order lands at Order materials");

  // legacy doc on read
  const { upsertDoc } = await import("@/db/doc-store");
  await upsertDoc("projects", { ...a, id: "P-legacy-1", stage: "training", pipelineId: undefined, stageMeta: undefined } as never);
  const leg = (await P.getProject("P-legacy-1"))!;
  ok(leg.stage === "installation" && leg.stageMeta?.tag === "onsite", "projects: a legacy 'training' record reads as Installation (onsite)");

  // manual stage + refusal
  ok(!(await P.setProjectStage(a.id, "bogus")), "projects: a stage id outside the pipeline is refused");
  const moved = await P.setProjectStage(a.id, "equipment-ordered", "Test");
  ok(moved?.stage === "equipment-ordered" && moved.stageHistory.at(-1)?.from === "deposit", "projects: stage write records history");
  const keys = (await tasksForProject(a.id)).map((t) => t.coverageKey || "");
  ok(keys.some((k) => k.startsWith(a.id + ":equipment-ordered:")), "projects: entering Equipment ordered expands its checklist");

  // delivery advance: only when ALL received and stage.advanceOnDelivered
  await P.updateProject(a.id, { deliveries: [
    { id: "d1", label: "Rigging", vendor: "JR Clancy", eta: Date.now(), status: "scheduled" },
    { id: "d2", label: "Soft goods", vendor: "Rose Brand", eta: Date.now(), status: "scheduled" },
  ] } as never);
  await P.setDeliveryStatus(a.id, "d1", "received");
  ok((await P.getProject(a.id))!.stage === "equipment-ordered", "projects: one of two deliveries received does not advance");
  await P.setDeliveryStatus(a.id, "d2", "received");
  ok((await P.getProject(a.id))!.stage === "initial-contact", "projects: last delivery received advances to the next stage");

  // sign-off → closeout, not done
  await P.setSignoff(a.id, { name: "Pat", role: "Customer" }, "Test");
  const signed = (await P.getProject(a.id))!;
  ok(signed.stage === "invoice" && !ProjStore.riskFlags(signed).length, "projects: sign-off moves to Invoice, not Complete");
  ok(ProjStore.progressPct(signed) === Math.round((5 / 6) * 100), "projects: progress from stage index");

  // service-linked spawn lands done
  const svc = await P.spawnServiceLinkedProject({ id: "Q-pl-svc", name: "svc" } as never, "repair");
  ok(svc.pipelineId === "order" && svc.stage === "complete", "projects: service-linked record is born at order/complete");

  for (const id of [a.id, o.id, "P-legacy-1", svc.id]) await P.removeProject(id);
}
```
  Before writing `updateProject(... deliveries ...)` check the real `ProjectDelivery` field names in projects.ts and match them.

- [ ] **Step 2:** run → FAIL (compile or assertions).
- [ ] **Step 3: Implement in `projects.ts`:**
  1. Replace the `ProjectStage` union with `export type ProjectStage = string;` and add the record fields listed under Produces. Update `ProjectStageChange` to strings.
  2. Replace `PROJECT_STAGES`/`ORDER_STAGES`/`stagesFor`/`stageIndex` bodies with shims derived from `DEFAULT_PROJECT_PIPELINES` (`{ key: s.id, label: s.label, short: s.label }`), each with a `/** @deprecated — removed in Task 4b; use stagesOf / stageMeta */` comment.
  3. `export function normalizeProject(p, pipes)`: keep the array backfill; `kind ||= "project"`; `const pl = projectPipelineFor(pipes, p); p.pipelineId = pl.id; p.stage = resolveProjectStage(pl, p.kind, p.stage); p.stageMeta = projectStageMeta(pipes, p);` keep `projectType` backfill.
  4. `getAllProjects` / `getProject` / `getProjectByQuote`: `const pipes = await loadPipelines();` once per call, pass to `normalizeProject`.
  5. `createProject`: load pipes; default `stage` = `firstStage(projectPipelineFor(pipes, partial)).id` unless `partial.stage` (resolved through `resolveProjectStage`); set `pipelineId`; opening history `{from:null,to:stage}`; stamp `stageMeta`.
  6. `recordStageChange(p, to, by, pipes)` also re-stamps `p.stageMeta`.
  7. `setProjectStage(id, stageId, by)`: load pipes + current doc; refuse (return null) if `stageById(projectPipelineFor(pipes, doc), stageId)` is null; patch via `recordStageChange`; drop the `trainingAt` stamp; checklist: `expandTemplate(TASK_TEMPLATE[stageId] || [], id + ":" + stageId, existing)`; **done hook** — if the new tag is `done` and the previous stage's tag was not, create the assignment moved from `signoffAction` (same title/source/link text: `Walk the completed site with the end user: …`, `source: "auto: project complete (#16)"`), using `createAssignment` from the same module `actions.ts` imports it from.
  8. `fromQuote` / `syncProjectsFromQuotes` insert path: stage = first stage of the kind's pipeline, `pipelineId` set, opening `stageHistory` entry (the sweep currently writes none), `stageMeta` stamped.
  9. `spawnServiceLinkedProject`: `stage` = the `order` pipeline's done stage id, `pipelineId: "order"` (via `projectPipelineFor(pipes, {kind:"order"})`).
  10. `setDeliveryStatus`: replace the `doc.stage === "delivery"` rule with: `status === "received"`, all deliveries received, `stageById(pl, doc.stage)?.advanceOnDelivered` → `const nx = nextStage(pl, doc.stage); if (nx) recordStageChange(doc, nx.id, "System", pipes)` (no kind check — order pipeline's `deliveries` has the flag). Load pipes before `patchDoc`.
  11. `setSignoff`: when `signoff` non-null and `PROJECT_TAG_RANK[projectTag(p, pipes)] < PROJECT_TAG_RANK.closeout`, move to `firstStageWithTag(pl, "closeout")` (fall back to done stage if the pipeline has no closeout).
  12. `progressPct(p)`: `const m = p.stageMeta || projectStageMeta(DEFAULT_PIPELINES, p); return m.count > 1 ? Math.round((m.index / (m.count - 1)) * 100) : 100;`
  13. `riskFlags(p)`: `if (isDone(p)) return flags;` and the no-crew condition uses `p.kind === "project" && isBacklog(p)`.
  14. Add `export function stagesOf(p, pipes) { return projectPipelineFor(pipes, p).stages; }`.
- [ ] **Step 4: `tasks.ts`:** retype `TASK_TEMPLATE: Record<string, TaskTemplateItem[]>` and re-key, keeping every item and comment verbatim (move them, don't rewrite): `"equipment-ordered"` = old procurement items then old delivery items; `scheduled` = old scheduled; `installation` = old install then old training; `invoice` = old signoff; `complete` = old complete; for the order pipeline add `"order-materials"` = old procurement items, `deliveries` = old delivery items, `delivered` = old signoff items (reference the same arrays — define the old per-stage arrays as local consts and compose, so nothing is duplicated). Remove the `ProjectStage` import if now unused.
- [ ] **Step 5: `projects/actions.ts` `signoffAction`:** delete the `wasComplete` / `setProjectStage(id, "complete")` / `createAssignment` block (the done hook in step 3.7 owns it now); keep `setSignoff` + error paths. `setStageAction`: replace the `stagesFor(p.kind).some(...)` guard with `if (!await setProjectStage(id, stage, user.name)) projectErrorPath(...)` (setProjectStage refuses illegal ids).
- [ ] **Step 6: sync push:** in the push handler, for docs in collection `projects`, run `normalizeProject(doc, await loadPipelines())` before the write so an offline device's legacy stage is converted.
- [ ] **Step 7:** tests PASS (including every pre-existing assertion that still compiles — the Task-1-era `#19` assertions on `PROJECT_STAGES` keys will now FAIL; rewrite them to: `ok(ProjStore.PROJECT_STAGES.map(s=>s.key).join(",") === "deposit,equipment-ordered,initial-contact,scheduled,installation,invoice,complete", "#19: board columns follow the install pipeline")` and the order one to `"order-materials,deliveries,delivered,complete"`; `dueChipLabel` assertions stay until Task 4b). tsc: the remaining errors must be only in consumer files Task 4a/4b own — list them in the commit body. **If tsc errors appear outside consumers, fix them here.**
- [ ] **Step 8: Commit** `feat(projects): stages are pipeline stage ids — read-time legacy conversion, tag-driven delivery/sign-off/done automation`

---

### Task 4a: Server/lib consumers → tags

**Files (modify):** `src/lib/dashboard/metrics.ts`, `src/lib/nav-counts.ts`, `src/lib/venue-match.ts`, `src/lib/venue-history-server.ts`, `src/lib/customer-feed.ts`, `src/lib/customer-feed-rows.ts`, `src/app/api/projects/[id]/handoff/route.ts`, `src/app/(app)/companies/[id]/page.tsx`, `src/app/(app)/inbox/page.tsx`, `src/app/(app)/import/types.ts`, `src/app/(app)/import/registry.ts`, `src/db/seeds/projects.ts`, `scripts/test-review-and-spec.ts`

**Interfaces — Consumes:** Task 1 predicates, Task 3 `stageMeta`, `stagesOf`, `loadPipelines`.

Rules (apply mechanically; every literal from the consumer map):
- `p.stage === "complete"` → `isDone(p)`; `!== "complete"` → `!isDone(p)`.
- metrics.ts: delete `ACTIVE_STAGES`/`BACKLOG_STAGES`; `openProjects` uses `isActive`, `backlogProjects` uses `isBacklog`; `byStage` groups by `p.stageMeta?.label ?? p.stage` and returns tag alongside for colouring.
- venue-match.ts: `isOpenStage("project", stage)` → for projects, open = `!isDone({ kind: "project", stage })` (it receives a stage id; pass through `projectTag` with DEFAULT_PIPELINES). Keep other kinds unchanged. Update the spec-harness assertion to `isOpenStage("project", "installation") === true && isOpenStage("project", "complete") === false`.
- venue-history-server.ts: `status: p.stageMeta?.label ?? p.stage`.
- customer-feed(.ts|-rows.ts): labels via `stageLabelFor(pipes, p, id)` (load pipes once in the server caller and pass down); legacy history keys render their old names.
- handoff route: print `p.stageMeta?.label`.
- companies page: `stageIndex/stagesFor` → `p.stageMeta` (index/count/label), `isDone`, `riskFlags`.
- inbox: `!isDone(p)`.
- import types.ts projects `stage` field: `kind: "text"` (drop the enum options), label "Stage", example `"Deposit/PO received"`; registry create: `stage` = the matching stage **id or label** (case-insensitive) in `projectPipelineFor(pipes, {kind})`, else first stage (pipes loaded once per commit); export writes `p.stageMeta?.label`. Kind still `project|order`.
- seeds/projects.ts: seed stages → new ids (`install`→`installation`, `scheduled`→`scheduled`, `procurement`→`equipment-ordered`, order `delivery`→`deliveries`, `complete`→`complete`), add `pipelineId`, drop `trainingAt` writes if the field is removed (keep the field on the type as optional if seeds need it; otherwise delete).

- [ ] Step 1: add assertions — `metrics` on two in-memory projects: `openProjects([{kind:"project",stage:"scheduled"},{kind:"project",stage:"deposit"}] as any).length === 1` and `backlogProjects(...)` `=== 1` (use the real exported names in metrics.ts; read it first).
- [ ] Step 2: FAIL → Step 3: implement → Step 4: PASS, tsc errors only in Task 4b files.
- [ ] Step 5: Commit `refactor(projects): server consumers read tags, not stage literals`

### Task 4b: UI consumers → pipelines; remove shims

**Files (modify):** `src/app/(app)/projects/view.tsx`, `projects/board-lib.ts`, `projects/data.ts`, `projects/page.tsx` (pass pipelines), `src/app/(app)/field-work/page.tsx`, `field-work/controls.tsx`, `src/app/(app)/schedule/page.tsx`, `src/app/(app)/_dashboard/widgets/installs.tsx`, `_dashboard/widgets/backward.tsx`, `src/lib/stores/projects.ts` (delete shims), `scripts/test-review-and-spec.ts`

- Server pages call `loadPipelines()` and pass `pipelines` (or the relevant `ProjectPipeline`) as a prop to client components.
- view.tsx: delete `STAGE_META`; pill/bar colour = `PROJECT_TAG_META[p.stageMeta.tag]`, label = `p.stageMeta.label`; board columns = the `install` pipeline's stages (board still shows kind `project` only); stage tracker + Advance button iterate `stagesOf(p, pipelines)`, "Mark complete" when the next stage's tag is `done`; filters: active = `!isDone`, "In install" = `isOnSite`, complete = `isDone`; sign-off tab note uses `firstStageWithTag(pl,"closeout")` wording ("Sign-off moves the job to <label>").
- board-lib.ts: `dueChipLabel(done: boolean, due, closedDate)` — first param becomes a boolean; update callers and the 4 spec assertions (`dueChipLabel(true, -3, "Jul 20") === "Closed Jul 20"` etc.).
- data.ts: the `"complete"` filter key stays as a URL value but maps to `isDone`.
- field-work page + controls: delete both local `STAGE_META`s; chips from `stageMeta` + `PROJECT_TAG_META`; exclusion `isDone`; on-site `isOnSite`.
- schedule/page.tsx: delete `SM`; bookings carry `tag` + `label`; service-work bookings use `tag: "scheduled", label: "Scheduled"`; every colour read is `PROJECT_TAG_META[tag] ?? PROJECT_TAG_META.backlog` — fixes the :1831 throw.
- installs widget: `STG` → tag-based (5 tags) with `PROJECT_TAG_META`; backward widget copy "in procurement or delivery" → "in backlog stages".
- projects.ts: delete `PROJECT_STAGES`, `ORDER_STAGES`, `stagesFor`, `stageIndex`, `StageDef`; fix the harness `#19` assertions to read `DEFAULT_PROJECT_PIPELINES` instead.

- [ ] Step 1: update harness assertions (board-lib boolean signature) → FAIL.
- [ ] Step 2: implement → tsc **0 errors**, test:specs 0 FAIL, eslint clean on touched files.
- [ ] Step 3: `git grep -nE '"(procurement|delivery|training|signoff)"' -- src | grep -v pipelines.ts` → only non-project uses remain (letters' "signoff" section id, delivery *status* values). Paste the residue in the commit body.
- [ ] Step 4: Commit `refactor(projects): UI renders pipelines; one tag colour map; schedule never throws on an unknown stage`

---

### Task 5: Quotes carry a pipeline stage

**Files:** Modify `src/lib/stores/quotes.ts`, `src/lib/stores/leads.ts` (convert), `src/app/(app)/quotes/actions.ts` (+ new `setQuoteStageAction`); Test: harness.

**Produces:**
```ts
Quote += { pipelineId?: string | null; stage?: string | null };
export async function setQuoteStage(id: string, stageId: string, by?: string | null): Promise<Quote | null>; // throws the gate error like setStatus
// quotes/actions.ts
export async function setQuoteStageAction(formData: FormData): Promise<void>; // fields: id, stage
```
Behaviour (spec §3.4):
- Quote normalize-on-read (find the read path used by `getQuote`/`getAll`; add a `normalizeQuotePipeline(q, pipes)`): if `carriesPipeline(q.quoteType)` → `pipelineId` = `quotePipelineFor(pipes, q).id`; `stage` = existing valid stage id, else `quoteStageForStatus(pl, q.status, null)` (draft→first-contact, sent→presentation, won→acceptance, lost→null). Non-pipeline quotes: leave both absent.
- `create()`: system quotes get `pipelineId = pipes.defaultQuotePipelineId` unless given, `stage` = first stage.
- `setStatus` (inside the existing patch): after `doc.status = status`, if `carriesPipeline(doc.quoteType)` set `doc.stage = quoteStageForStatus(pl, status, doc.stage)`; push nothing extra to history.
- `setQuoteStage(id, stageId, by)`: load quote; refuse (return null) if not a pipeline quote or `stageId` not in its pipeline; `const tag = statusForQuoteStage(pl, stageId)`; if `tag !== q.status` → `await setStatus(id, tag, by)` (gate, spawn, revision all fire) then patch `stage = stageId` (setStatus will have snapped to the tag's first stage; overwrite with the chosen one); else plain patch `stage` + `updatedAt`. A lost quote may be moved back into the pipeline only through the existing status buttons (return null for stage moves while `status === "lost"`).
- Pipeline switch: `setQuotePipeline(id, pipelineId)` — allowed only while `status === "draft"`; stage → first stage of the new pipeline.
- leads.ts `convert`: the directly inserted draft quote gets `pipelineId` default + first stage.

- [ ] Step 1 failing tests:
```ts
import * as Q from "@/lib/stores/quotes";
{
  const q = await Q.create({ name: "pl-quote", customer: "Test" });
  ok(q.pipelineId === "estimate-design" && q.stage === "first-contact", "quotes: a new system quote starts at First Contact");
  const d = await Q.setQuoteStage(q.id, "design", "Test");
  ok(d?.stage === "design" && d.status === "draft", "quotes: same-tag stage move keeps status");
  let refused = false;
  try { await Q.setQuoteStage(q.id, "presentation", "Test"); } catch { refused = true; }
  ok(refused && (await Q.getQuote(q.id))?.stage === "design", "quotes: moving to a Sent stage hits the approval gate like the Send button");
  const s = await Q.setStatus(q.id, "sent", "Test", { bypassApprovalGate: "engine-owned-flow" });
  ok(s?.stage === "presentation", "quotes: status sent snaps the stage to Presentation/Delivery");
  const flame = await Q.create({ name: "pl-flame", quoteType: "flame_test" });
  ok(!flame.pipelineId && !flame.stage, "quotes: service quotes carry no pipeline");
  ok(!(await Q.setQuoteStage(flame.id, "design")), "quotes: stage moves on a non-pipeline quote are refused");
  for (const id of [q.id, flame.id]) await Q.remove?.(id);
}
```
  (Use the store's real getter/remover names — read quotes.ts exports first; adjust `getQuote`/`remove`.)
- [ ] Steps 2–4: FAIL → implement → PASS; tsc 0.
- [ ] Step 5: Commit `feat(quotes): system quotes carry a Daylite pipeline stage kept in lock-step with status`

### Task 6: Quote stage UI

**Files:** estimator header (`src/app/(app)/estimator/estimator-client.tsx` + `page.tsx` pass pipelines), quotes hub list (`src/app/(app)/quotes/page.tsx`) pill, `src/app/(app)/estimator/actions.ts` (stage + pipeline actions if the estimator uses its own action file).

- Estimator header: a compact stage bar (chevrons, current highlighted, `pk-*` classes, accent via `var(--accent)`) for pipeline quotes; clicking a stage posts `setQuoteStageAction`; gate errors surface in the existing estimator error toast/pattern. A pipeline switch (select: Estimate/Design ⇄ BID SPEC) shown only while status is draft.
- Quotes hub rows: for pipeline quotes, the status pill text becomes `<stage label>` (status colour unchanged); Lost stays "Lost".
- [ ] Verify in browser (worktree dev server on a scratch `PGLITE_PATH`, port not in use — `lsof -i :3100` first; see memory `peak-worktree-dev-server-browser-verification-traps`): create quote → stage bar shows First Contact; click Design; Send → Presentation/Delivery; screenshot.
- [ ] Commit `feat(estimator): Daylite stage bar + pipeline switch on system quotes`

### Task 7: Settings → Pipelines editor

**Files:** Create `src/app/(app)/settings/pipelines/page.tsx`, `pipelines-editor.tsx` (client), `actions.ts`; add the nav entry wherever Settings sub-sections are listed (read `src/app/(app)/settings/` layout/nav first and follow it). Admin permission: the same `requirePerm` the other admin settings sections use.

- One card per pipeline (Projects: Install, Order; Quotes: Estimate/Design, BID SPEC). Rows: label input, tag select (project tags / quote tags), `advanceOnDelivered` checkbox (project only), ↑/↓ reorder buttons (no drag library), remove (disabled with "N records" when `stageUsage()` > 0), "+ Add stage" (id = slugified label, de-duplicated with `-2`…; immutable after first save). Default-quote-pipeline radio. Save → `savePipelines`; errors listed inline; success `revalidatePath("/", "layout")`.
- "Move records" for an in-use stage: select a target stage in the same pipeline → server action rewrites those projects via `setProjectStage` (projects) / plain `stage` patch for same-tag quote stages only (different-tag moves are refused with a message — status changes stay deliberate).
- [ ] Browser verify: rename Invoice → "Final invoice", save, Projects board column shows it; attempt removing Scheduled with a project in it → blocked with count. Screenshot.
- [ ] Commit `feat(settings): Pipelines editor — rename/add/reorder/tag stages, in-use guard, move records`

### Task 8: Part 1 gates

- [ ] `npx tsc --noEmit` → 0; `npm run test:specs` → 0 FAIL (report PASS count); stop any worktree dev server, then `npm run test:smoke` → report pass/total; `npx eslint` on all touched files vs. `origin/main` baseline (`git diff --name-only origin/main` list) → no new errors.
- [ ] Browser sweep on scratch DB: Projects board + detail, Schedule, Field Work, Home dashboard installs widget, company page, estimator stage bar, Settings → Pipelines. No console errors.
- [ ] Commit any fixes. Part 1 is shippable here.

---

## PART 2 — HISTORY IMPORT

### Task 9: UKN values

**Files:** Create `src/lib/job-value.ts`; modify `projects.ts` (`valueUnknown` already typed in Task 3), `src/lib/stores/repair-jobs.ts` (`valueUnknown?: boolean`), `metrics.ts`, Projects list (view.tsx + data.ts filter `value-unknown`), company page totals, Reports (`src/app/(app)/reports/*` — find sums of project/repair `value`), project value edit action (clears flag).

```ts
// src/lib/job-value.ts — pure
export type Valued = { value?: number | null; valueUnknown?: boolean | null };
export const isValueUnknown = (r: Valued) => !!r.valueUnknown;
export function knownValue(r: Valued): number { return r.valueUnknown ? 0 : Number(r.value) || 0; }
export function formatJobValue(r: Valued, fmt: (n: number) => string): string { return r.valueUnknown ? "UKN" : fmt(Number(r.value) || 0); }
export function unknownCount(rs: Valued[]): number { return rs.filter(isValueUnknown).length; }
```
- Every sum of project/repair `value` switches to `knownValue`; every render of it to `formatJobValue` (grep `\.value\b` in the files above); dashboards/reports that total add "· N with unknown value" when `unknownCount > 0`.
- Saving a value (the project edit action) sets `valueUnknown: false`.
- [ ] Tests: `knownValue({value:500,valueUnknown:true}) === 0`, `formatJobValue({value:0,valueUnknown:true}, String) === "UKN"`, metrics projected-profit over one known + one unknown project equals the known one.
- [ ] Commit `feat(values): UKN — unknown job values render UKN and stay out of totals`

### Task 10: Pure Daylite classifier

**Files:** Modify `scripts/daylite-ids.ts` (add helpers); Create `src/lib/daylite/history.ts`; Test: harness.

```ts
// scripts/daylite-ids.ts additions (do NOT touch norm/hash)
export const repairId = (name: string, company: string): string => "RP-dl-" + hash(norm(name) + "|" + norm(company));
export const quoteId = (name: string, company: string): string => "Q-dl-" + hash(norm(name) + "|" + norm(company));
```

```ts
// src/lib/daylite/history.ts — pure (imports only ../../../scripts/daylite-ids via relative path or a tsconfig alias; check how
// scripts/daylite-ids is imported elsewhere from src — if never, import with a relative path)
export type TsvRow = Record<string, string>;
export function parseTsv(text: string): TsvRow[];            // RFC-4180-style quotes, tab delimiter, BOM stripped, header row, blank header cells ignored
export type Bucket = "skip" | "install" | "service" | "order";
export function classifyProject(r: TsvRow): { bucket: Bucket; reason?: string };
export const PROJECT_STAGE_MAP: Record<string, string>;      // stripped Daylite stage label (lowercase, no "N • ") → install stage id (spec §4.2 table)
export const SERVICE_STAGE_MAP: Record<string, "approved" | "scheduled" | "completed">;
export const OPP_STAGE_MAP: Record<string, { pipelineId: "estimate-design" | "bid-spec"; stage: string; projectStage?: string }>; // spec §4.3
export function stripStage(s: string): string;               // "8 • Final Payment Received" → "final payment received"
export function toMs(mdY: string): number | null;            // "10/21/11" → local-midnight epoch ms (2-digit → 20xx)
export function splitCompanies(cell: string, known: (name: string) => boolean): string[]; // greedy longest-run over comma pieces
export type ProjectPlan = {
  kind: "project" | "repair" | "order"; id: string; name: string; companyCandidates: string[]; people: string[]; owner: string;
  done: boolean; stage: string;                 // install stage id | repair stage key
  startedAt: number | null; endedAt: number | null; dueAt: number | null;
  value: number | null;                         // null = UKN
};
export type QuotePlan = { id: string; name: string; companyCandidates: string[]; people: string[]; owner: string;
  pipelineId: string; stage: string; status: "draft" | "sent" | "won"; value: number | null; projectStage?: string };
export function planHistory(input: { projects: TsvRow[]; opportunities: TsvRow[]; knownCompany: (name: string) => boolean }):
  { projects: ProjectPlan[]; quotes: QuotePlan[]; skipped: Record<string, number> };
```
Rules — encode spec §4.2/§4.3 exactly:
- `classifyProject`: Status in {Cancelled, Abandoned, Deferred} → skip (reason = status). Pipeline in {"Service Call","Repair"} or (Pipeline blank and Category in {"Service","Component Repair"}) → service. Pipeline "Custom Cables" → order. Else install.
- Done → `done: true`, install/order stage `complete`, repair stage `completed`. New → stage via the maps; unmapped/blank install → `initial-contact`; unmapped service → `approved`.
- ids: install/order `projectId(name, firstCompanyOrBlank)`, service `repairId(...)`, quotes `quoteId(...)` — use the RAW Companies cell's first resolved company (or "" when none) so ids are stable across re-runs.
- Opportunities: Won → value index only (`norm(name)|norm(company)` → value); Open → QuotePlan; others → skipped counts by State. `Value` "$84,500.00" → 84500; "$0.00" → null (UKN) for projects, 0 for quotes.
- Project value = matching Won opp value when > 0, else null.
- Open won-tagged quotes (`status: "won"`) carry `projectStage` from OPP_STAGE_MAP.

- [ ] Tests with inline fixtures (no Dropbox dependency):
```ts
import { parseTsv, classifyProject, planHistory, splitCompanies, stripStage, toMs } from "@/lib/daylite/history";
{
  const P = `\tCategory\tName\tStatus\tPipeline\tStage\tDue Date\tStart Date\tEnd Date\tNext Task\tNext Task Due\tPeople\tCompanies\tOwner\t
\t\t"Sisters of St. Francis Dubuque, IA - BID"\tDone\tInstallation\t"8 • Final Payment Received"\t\t10/21/11\t2/22/12\t\t\t\t"Sisters of St. Francis"\t"Jason Keagy"\t
\tService\t"SERVICE CALL:  Pardeeville Gym - Audio Issues"\tNew\tService Call\t"2 • Service Scheduled"\t\t3/2/26\t\t\t\t\t"Pardeeville Schools"\t"Mike Mundth"\t
\t\t"DEERFIELD HS - Gym AV BID"\tNew\tBasic Install\t"3 • Installation"\t\t4/1/26\t\t\t\t"Pat Doe"\t"Camosy Construction, Deerfield School District"\t"Isaac Mittlesteadt"\t
\t\t"Old job"\tCancelled\tBasic Install\t\t\t1/1/15\t\t\t\t\t"X"\t"Y"\t`;
  const O = `\tCategory\tName\tState\tState Reason\tForecasted Close\tValue\tPipeline\tStage\tNext Task\tNext Task Due\tPeople\tCompanies\tOwner\t
\t\t"Sisters of St. Francis Dubuque, IA - BID"\tWon\t\t\t"$48,200.00"\t\t\t\t\t\t"Sisters of St. Francis"\t"Jason Keagy"\t
\tBid\t"BIG FOOT HS WALWORTH - Auditorium AV Upgrades"\tOpen\t\t\t"$84,500.00"\tBID SPEC\t"5 • Awarded"\t\t\t\t"Big Foot High School"\t"Jeff Chesebro"\t
\tDesign\t"AL RINGLING - Lighting"\tOpen\t\t\t"$122,475.00"\tEstimate/Design\t"2 • Design"\t\t\t\t"Al Ringling Theatre"\t"Jeff Chesebro"\t`;
  const known = new Set(["sisters of st. francis", "pardeeville schools", "camosy construction", "deerfield school district", "big foot high school", "al ringling theatre", "sound devices, llc"]);
  const kn = (n: string) => known.has(n.trim().toLowerCase());
  const rows = parseTsv(P);
  ok(rows.length === 4 && rows[0]["Name"] === "Sisters of St. Francis Dubuque, IA - BID", "daylite: TSV parse keeps quoted commas");
  ok(classifyProject(rows[3]).bucket === "skip" && classifyProject(rows[1]).bucket === "service" && classifyProject(rows[0]).bucket === "install", "daylite: classify");
  ok(stripStage("8 • Final Payment Received") === "final payment received", "daylite: stripStage");
  ok(new Date(toMs("2/22/12")!).getFullYear() === 2012, "daylite: 2-digit years are 20xx");
  ok(splitCompanies("Camosy Construction, Deerfield School District", kn).length === 2, "daylite: multi-company split");
  ok(splitCompanies("Sound Devices, LLC", kn).length === 1, "daylite: a comma inside one company name is not a split");
  const plan = planHistory({ projects: rows, opportunities: parseTsv(O), knownCompany: kn });
  const sis = plan.projects.find((p) => p.name.startsWith("Sisters"))!;
  ok(sis.kind === "project" && sis.done && sis.stage === "complete" && sis.value === 48200, "daylite: done install valued from its won opp");
  ok(sis.endedAt !== null && new Date(sis.endedAt).getMonth() === 1, "daylite: closed on the End Date");
  const svc = plan.projects.find((p) => p.kind === "repair")!;
  ok(svc.stage === "scheduled" && !svc.done && svc.value === null, "daylite: live service call → scheduled repair, UKN");
  const dfd = plan.projects.find((p) => p.name.startsWith("DEERFIELD"))!;
  ok(dfd.stage === "installation" && dfd.companyCandidates.length === 2, "daylite: live install stage + two company candidates");
  ok(plan.skipped["Cancelled"] === 1, "daylite: cancelled skipped");
  const bf = plan.quotes.find((q) => q.name.startsWith("BIG FOOT"))!;
  ok(bf.pipelineId === "bid-spec" && bf.stage === "awarded" && bf.status === "won" && bf.projectStage === "deposit" && bf.value === 84500, "daylite: awarded open opp → won quote + project at Deposit");
  const al = plan.quotes.find((q) => q.name.startsWith("AL RINGLING"))!;
  ok(al.pipelineId === "estimate-design" && al.stage === "design" && al.status === "draft", "daylite: design-stage opp → draft quote");
  ok(!plan.quotes.some((q) => q.name.startsWith("Sisters")), "daylite: won opps are value-only, not quotes");
}
```
- [ ] Commit `feat(daylite): pure history classifier — buckets, stage maps, company splitter, deterministic ids`

### Task 11: Server preview + commit

**Files:** Create `src/lib/daylite/history-commit.ts`; modify `src/lib/stores/quotes.ts` only if needed to write a quote with a fixed id without spawn (prefer `upsertDoc("quotes", …)` built through the same builder `create()` uses — read it; never call `setStatus`, so nothing spawns); Test: harness (DB-backed).

```ts
export type PreviewRow = { id: string; kind: "project" | "repair" | "order" | "quote"; name: string; company: string | null;
  candidates: string[]; stage: string; done: boolean; value: number | null; already: boolean; flags: string[] };
export type Preview = { counts: Record<string, number>; rows: PreviewRow[]; needsPick: PreviewRow[]; live: PreviewRow[] };
export async function previewHistory(projectsTsv: string, oppsTsv: string): Promise<Preview>;
export async function commitHistory(projectsTsv: string, oppsTsv: string, picks: Record<string, string>, by: string):
  Promise<{ created: Record<string, number>; skippedExisting: number; errors: string[] }>;
```
Behaviour:
- Company resolution: `companyId(name)` against live `companies` rows (load once; `knownCompany` = id exists). One candidate → it. Several → default = first whose company `type` ∉ `PARTNER_TYPES` (`src/lib/identity/venue-defaults.ts`), else first; row goes to `needsPick`; `picks[rowId]` overrides. None → `company: null`, flag `no company`.
- Contact: first People name, split on last space → `contactId(first, last, companyName)`; exists → `contactId` on the record; else append "Contact (Daylite): <name>" to a note.
- Owner: exact case-insensitive match on `allUsers()` name → `owner`; else `owner: ""` (or the store's "unassigned" convention — read `createProject`/repair `create` defaults) + `legacyOwner`.
- `already`: a doc with the planned id exists (projects/repair_jobs/quotes) → skipped.
- Projects: `createProject({ id, kind, pipelineId, name, customer, customerId, owner, legacyOwner, value: value ?? 0, valueUnknown: value == null, stage, startedAt: startedAt ?? endedAt ?? Date.now(), targetDate: dueAt ?? endedAt ?? null, source })`, then for done rows rewrite `stageHistory` to `[{at: startedAt, from: null, to: firstStage}, {at: endedAt, from: firstStage, to: "complete", by: "Daylite import"}]` and `updatedAt = endedAt` via `updateProject` — so "Closed <date>" reads the End Date (check what `dueChipLabel`'s `closedDate` is derived from in view.tsx and make sure it is this history entry or `updatedAt`).
- Repairs: repair-jobs `create` with `id`, `stage`, `completedAt = endedAt` (done), `approvedAt = startedAt`, `value/valueUnknown`, `source: { kind: "direct", label: "Daylite import" }`, `warrantyMonths` default — **assert** no warranty follow-up task is created (read how repair warranty follow-ups are generated; if a sweep creates tasks for expiring warranties, completedAt years ago puts them in `expired`, which must not generate tasks — cover with a test).
- Quotes: build via the quotes builder with fixed `id`, `quoteType: "system"`, `pipelineId`, `stage`, `status`, `value`, `history: [{at: now, from: null, to: status}]`, note "Imported from Daylite", `source: "daylite"` marker in the same `source`-ish field the Quote type allows (it's `source: string` — use `"daylite"`), written with `upsertDoc` — **no `setStatus`, no spawn**.
- Won quotes: find a planned/new project with the same norm(name)+norm(company) among live installs → set its `quoteId` and move its stage forward to `projectStage` if later; else `createProject({ … quoteId, stage: projectStage, value, valueUnknown: false })`. Exactly one project per won quote.
- Commit runs inside per-row try/catch; errors collected; idempotent on re-run (second commit: all `already`).

- [ ] Tests (DB): seed two companies + one user via the identity helpers (`saveCompany` — read `src/lib/identity/companies.ts`), run `previewHistory` on the Task 10 fixtures → counts; `commitHistory` → project `P-dl-…` exists at complete with history closing on End Date; repair exists `completed`; big-foot quote `won` with exactly one linked project at `deposit`; rerun commit → `skippedExisting === created total`, no new docs; no tasks created for the done repair.
- [ ] Commit `feat(daylite): preview + idempotent commit — companies, contacts, owners, one project per sold job, no spawn`

### Task 12: Import-hub card + preview UI

**Files:** Create `src/app/(app)/import/daylite/page.tsx`, `daylite-client.tsx`, `actions.ts`; link a card from `src/app/(app)/import/page.tsx` (follow the existing card markup). Admin perm as the Import hub uses.

- Two file inputs (Projects TSV, Opportunities TSV; `.tsv,.txt,.csv`), read client-side as text (files are ~0.5 MB — under the 1200 kb server-action limit per memory `reference-vercel-blob-limits`; if either exceeds 1 MB, show an error asking for the file split rather than uploading).
- "Preview" → `previewHistoryAction` → counts table (done installs, live installs, done service, live service, orders, open quotes, sold+linked, skipped by reason, already imported, valued vs UKN, no-company), a `needsPick` table with a `<select>` per row, and the ~130 live rows listed.
- "Confirm import" (disabled until preview) → `commitHistoryAction(picks)` → result panel with links: `/projects?source=daylite`, `/repairs`, `/quotes`.
- [ ] Browser verify on scratch DB with the real Dropbox files (read-only): preview counts ≈ spec profile (done installs ≈1,000, service ≈950, orders 5, valued 303 ± matching, open quotes 73, pickers ≈33, no-company ≈86). Screenshot preview. Confirm on scratch DB; spot-check Sisters of St. Francis closed Feb 22, 2012 on Projects, UKN on an unvalued job.
- [ ] Commit `feat(import): Daylite history card — preview, company picks, confirm`

### Task 13: Retire old script branches, docs, final gates

**Files:** `scripts/import-daylite.ts` (delete the Opportunities→leads and Projects branches, their types, report lines, header doc lines 13, 23–24; keep identity), `DECISIONS.md`, `PUNCHLIST.md`, `AGENTS.md` (phase status line), `MASTER-QUESTIONS.md` (O1 BID SPEC stage 1).

- [ ] Recompute numbers **right before writing**: `git fetch && git show origin/main:DECISIONS.md | grep -oE "^## D[0-9]+" | tail -1` and the PUNCHLIST max `#`. Log decisions: pipelines + tags model; sign-off → closeout / Complete manual; quotes stop at Won; read-time stage conversion; UKN; Daylite import rules (skip set, service→repairs, won opps value-only, no-spawn import, deterministic ids incl. new RP-dl/Q-dl prefixes — a deviation from `RP-4000`/`Q-2041` id formats).
- [ ] Final gates (numbers in the report): tsc, test:specs, test:smoke, eslint baseline.
- [ ] `git fetch && git rebase origin/main` (other sessions touch quotes/spawn); re-run gates; resolve conflicts preserving both sides' intent.
- [ ] Commit `docs: Daylite pipelines + history import — decisions, punch, status`.
