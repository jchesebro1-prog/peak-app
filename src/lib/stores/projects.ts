import {
  getBlob,
  getDoc,
  insertWithPrefixedId,
  listDocs,
  patchDoc,
  setBlob,
  softDeleteDoc,
  upsertDoc,
} from "@/db/doc-store";
import { withQuoteLock } from "@/db";
import { createAssignment } from "@/lib/stores/assignments";
import { loadPipelines } from "@/lib/pipelines-server";
import { yearAwareDate } from "@/lib/format";
import {
  DEFAULT_PIPELINES,
  PROJECT_TAG_RANK,
  firstStage,
  firstStageWithTag,
  isBacklog,
  isDone,
  nextStage,
  projectPipelineFor,
  projectStageMeta,
  projectTag,
  resolveProjectStage,
  stageById,
  type PipelineStage,
  type Pipelines,
  type ProjectTag,
  type StageMeta,
} from "@/lib/pipelines";

/**
 * ProjectStore — post-acceptance project & order lifecycle. Direct port of
 * app/project.js (rss_projects_v2) onto the doc-store.
 *
 * When a quote is WON it converts into one of two things:
 *   - Project     ('project', ids P-#### from base 3000) — the job includes
 *     install LABOR. Full lifecycle: procurement → deliveries → crew
 *     scheduled → install → training → sign-off → complete.
 *   - Sales order ('order', ids S-#### from base 4000) — materials only.
 *     Shorter lifecycle: procurement → deliveries → delivered → complete.
 *
 * Lead times live on each procurement line and drive order-by dates, the
 * flagged critical (longest-lead) item, and per-item status.
 *
 * Prototype details that do not port to the server:
 * - localStorage cache/read/write/ensure — replaced by doc-store rows.
 * - emit() 'rss-projects' CustomEvent — client reactivity, no server analog.
 * - migrate()'s customerId backfill via window.CustomerStore.resolveId —
 *   a legacy repair for pre-link localStorage saves; server records always
 *   carry customerId (seeds + create/fromQuote set it explicitly).
 * - window.Team.CURRENT — replaced by explicit actor parameters falling
 *   back to DEFAULT_ACTOR (the prototype's own literal fallback).
 * - AppSettings.seedDemo lazy seeding inside ensure() — seeding is explicit
 *   via src/db/seeds/projects.ts.
 *
 * The dismissed list (won quoteIds the user converted-then-deleted) is a
 * separate blob singleton, id "projects_dismissed" — port of DKEY
 * rss_projects_dismissed_v2.
 */

const DAY = 86400000;

/** Days everything should land on site before install (project.js STAGING_BUFFER). */
export const STAGING_BUFFER = 7;

/** Prototype fallback for window.Team.CURRENT (team.js default identity). */
const DEFAULT_ACTOR = "Jeff Chesebro";

/** Blob id of the dismissed list. Exported so no other module — including
 *  the test harness, which snapshots and restores the singleton — has to
 *  restate the literal. */
export const DISMISSED_BLOB_ID = "projects_dismissed";

function now(): number {
  return Date.now();
}
function ahead(d: number): number {
  return now() + d * DAY;
}
function uid(p?: string): string {
  return (p || "x") + Math.random().toString(36).slice(2, 8);
}

/* ---------- lifecycle definitions ---------- */

export type ProjectKind = "project" | "order";

/** A pipeline stage id (Settings → Pipelines). Kept as an alias so imports compile. */
export type ProjectStage = string;

/** The stages of the pipeline this record runs on. */
export function stagesOf(p: Pick<ProjectRecord, "kind" | "pipelineId">, pipes: Pipelines): PipelineStage<ProjectTag>[] {
  return projectPipelineFor(pipes, p).stages;
}

/* ---------- vendor + lead-time knowledge (days to procure) ---------- */

export const VENDORS: Record<string, { lead: number; scope: string }> = {
  "JR Clancy": { lead: 45, scope: "Rigging hardware & hoists" },
  "Rose Brand": { lead: 32, scope: "Soft goods (sewn to order)" },
  ETC: { lead: 56, scope: "Dimming, control & fixtures" },
  Wenger: { lead: 70, scope: "Acoustical shell & risers" },
  "In-stock": { lead: 10, scope: "Hardware & consumables" },
};

/* ---------- record shapes ---------- */

export type LineStatus = "pending" | "ordered" | "shipped" | "received";

export type ProcurementLine = {
  id: string; // uid('pl-')
  sku: string;
  desc: string;
  vendor: string;
  qty: number;
  unit: string;
  cost: number;
  leadDays: number;
  status: LineStatus;
  orderedAt: number | null;
  po: string;
};

export type DeliveryStatus = "scheduled" | "in_transit" | "received";

export type ProjectDelivery = {
  id: string; // uid('dl-')
  label: string;
  vendor: string;
  eta: number;
  status: DeliveryStatus;
  receivedAt?: number | null;
};

export type CrewAssignment = {
  id: string; // uid('cw-')
  person: string;
  role: string;
  start: number;
  end: number;
  mobId?: string | null;
  googleEventId?: string | null;
};

/** Estimator mobilization rows carried onto the project (spec.mobs). */
export type Mobilization = Record<string, unknown> & {
  id?: string; // uid('mb-')
  type?: string;
  days?: number;
  crew?: number;
  discipline?: string;
};

export type ProjectTask = {
  id: string; // uid('tk-')
  title: string;
  section: string;
  assignee: string;
  done: boolean;
  doneAt?: number | null;
};

export type ProjectNote = {
  id: string; // uid('nt-')
  by: string;
  at: number;
  text: string;
  photo: string | null;
  /** Soft-delete flag (Round 2 delete pass) — embedded in the project doc,
   *  so removal marks the entry rather than removing the parent's own
   *  softDeleteDoc tombstone. Absent/false = live. */
  deleted?: boolean;
};

export type TimeLog = {
  id: string; // uid('tl-')
  person: string;
  date: number;
  hours: number;
  note: string;
  /** Soft-delete flag — see ProjectNote.deleted. */
  deleted?: boolean;
};

export type ProjectSignoff = {
  name?: string;
  role?: string;
  signedBy: string;
  signedAt: number;
  note?: string;
  /** Small PNG data URL captured on the field device at hand-off. */
  signature?: string;
  /** Per-scope completion acknowledgements captured at hand-off. */
  scopeChecks?: Record<string, boolean>;
};

export type ProjectRecord = {
  id: string; // P-#### (base 3000) | S-#### (base 4000)
  kind: ProjectKind;
  quoteId: string | null;
  /** The originating quote's quoteType ("system" | "flame_test" | "repair" |
   *  "inspection" | "consulting"), carried through at conversion (PUNCHLIST
   *  #13, decision 2) — previously dropped at fromQuote() entirely. null on
   *  projects created before this field existed or without a quote. */
  projectType: string | null;
  name: string;
  customer: string;
  customerId: string | null;
  locationId: string | null;
  owner: string;
  value: number;
  margin: number;
  createdAt: number;
  updatedAt: number;
  startedAt: number;
  targetDate: number | null;
  installStart: number | null;
  installEnd: number | null;
  /** Settings → Pipelines pipeline id ("install" | "order" seeds). Stamped on every read. */
  pipelineId: string;
  /** A stage id within `pipelineId`. Legacy 7-stage keys are converted on read. */
  stage: ProjectStage;
  /** Derived on every read/write (tag, label, index) — never authoritative. */
  stageMeta?: StageMeta;
  /** Imported record whose value wasn't known at the source. */
  valueUnknown?: boolean;
  /** The source system's owner name when it didn't match a team member. */
  legacyOwner?: string;
  /** Where an imported record came from. */
  source?: { system: "daylite"; importedAt: number } | null;
  stageHistory: ProjectStageChange[];
  procurement: ProcurementLine[];
  mobilizations: Mobilization[];
  deliveries: ProjectDelivery[];
  crew: CrewAssignment[];
  tasks: ProjectTask[];
  notes: ProjectNote[];
  timeLogs: TimeLog[];
  signoff: ProjectSignoff | null;
  trainingAt: number | null;
};

/** Stable closeout scopes derived from the project's purchased lines. */
export function signoffScopes(project: Pick<ProjectRecord, "procurement">): string[] {
  const scopes = new Set<string>();
  for (const line of project.procurement || []) {
    const scope = VENDORS[line.vendor]?.scope || line.vendor;
    if (scope?.trim()) scopes.add(scope.trim());
  }
  if (!scopes.size) scopes.add("General installation");
  return [...scopes].sort((a, b) => a.localeCompare(b));
}

/**
 * One stage transition, appended on every stage write. Mirrors QuoteHistoryEntry
 * ({at, from, to}) and adds the actor. `from: null` marks the record's opening
 * stage. Existing projects start with an empty array — history before this
 * change was overwritten in place and is unrecoverable.
 */
export type ProjectStageChange = {
  at: number;
  from: string | null;
  to: string;
  by: string;
};

export type RiskFlag = { kind: "late-order" | "no-crew"; label: string };

/** Minimal structural view of a quote doc (read via doc-store, never via the quotes lib module). */
export type QuoteLike = Record<string, unknown> & {
  id: string;
  name: string;
  customer?: string;
  customerId?: string | null;
  locationId?: string | null;
  owner?: string;
  value?: number;
  margin?: number;
  status?: string;
  quoteType?: string;
  updatedAt?: number;
  spec?:
    | (Record<string, unknown> & {
        sections?: Array<Record<string, unknown> & { kind?: string; items?: unknown[] }>;
        hasLabor?: boolean;
        systems?: string[];
        mobs?: Mobilization[];
      })
    | null;
};

/* ---------- builders ---------- */

/** Build a procurement line — port of project.js line(). */
export function buildProcurementLine(o: Partial<ProcurementLine> = {}): ProcurementLine {
  const vend = o.vendor || "In-stock";
  return {
    id: o.id || uid("pl-"),
    sku: o.sku || "",
    desc: o.desc || "Item",
    vendor: vend,
    qty: o.qty || 1,
    unit: o.unit || "ea",
    cost: o.cost || 0,
    leadDays: o.leadDays != null ? o.leadDays : VENDORS[vend] ? VENDORS[vend].lead : 21,
    status: o.status || "pending",
    orderedAt: o.orderedAt || null,
    po: o.po || "",
  };
}

/**
 * Port of migrate(): backfill array fields and kind, then put the record on its
 * pipeline — legacy 7-stage keys convert to stage ids (spec §3.6) and the
 * derived stageMeta is stamped. Exported for the import + sync push paths.
 */
export function normalizeProject(p: ProjectRecord, pipes: Pipelines): ProjectRecord {
  const rec = p as Record<string, unknown>;
  for (const k of [
    "procurement",
    "deliveries",
    "crew",
    "tasks",
    "notes",
    "timeLogs",
    "mobilizations",
    "stageHistory",
  ]) {
    if (!Array.isArray(rec[k])) rec[k] = [];
  }
  if (!p.kind) p.kind = "project";
  const pl = projectPipelineFor(pipes, p);
  p.pipelineId = pl.id;
  p.stage = resolveProjectStage(pl, p.kind, p.stage);
  p.stageMeta = projectStageMeta(pipes, p);
  if (p.projectType === undefined) p.projectType = null;
  return p;
}

/* ---------- dismissed list (blob singleton "projects_dismissed") ---------- */

/**
 * Quotes whose converted project was DELETED — the sweep (and, since #169,
 * the per-quote creator reached from `quote-spawn.ts`) must never re-create
 * them. Exported so the router can consult the list without a second module
 * restating DISMISSED_BLOB_ID.
 */
export async function dismissedQuoteIds(): Promise<string[]> {
  const blob = await getBlob<{ ids: string[] }>(DISMISSED_BLOB_ID, { ids: [] });
  return Array.isArray(blob.ids) ? blob.ids : [];
}

async function addDismissed(quoteId: string | null | undefined): Promise<void> {
  if (!quoteId) return;
  const ids = await dismissedQuoteIds();
  if (!ids.includes(quoteId)) await setBlob(DISMISSED_BLOB_ID, { ids: [...ids, quoteId] });
}

/* ---------- CRUD ---------- */

/** All projects & orders, newest activity first (port of getAll). */
export async function getAllProjects(): Promise<ProjectRecord[]> {
  const list = await listDocs<ProjectRecord>("projects");
  const pipes = await loadPipelines();
  return list.map((p) => normalizeProject(p, pipes)).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
}

export async function getProject(id: string): Promise<ProjectRecord | null> {
  const p = await getDoc<ProjectRecord>("projects", id);
  return p ? normalizeProject(p, await loadPipelines()) : null;
}

/** Port of byQuote(qid). */
export async function getProjectByQuote(quoteId: string): Promise<ProjectRecord | null> {
  const list = await listDocs<ProjectRecord>("projects");
  const p = list.find((x) => x.quoteId === quoteId);
  return p ? normalizeProject(p, await loadPipelines()) : null;
}

/**
 * The record createProject() writes, built without writing it. Pure: the
 * caller supplies the pipelines and the timestamp. Exported so an importer can
 * overlay fields (e.g. a historical updatedAt) and write the doc once.
 */
export function buildProject(
  id: string,
  partial: Partial<ProjectRecord>,
  pipes: Pipelines,
  t: number
): ProjectRecord {
  const pl = projectPipelineFor(pipes, partial);
  const stage = partial.stage ? resolveProjectStage(pl, partial.kind, partial.stage) : firstStage(pl).id;
  const p: ProjectRecord = {
    kind: "project",
    quoteId: null,
    projectType: null,
    name: "Untitled project",
    customer: "",
    customerId: null,
    locationId: null,
    owner: DEFAULT_ACTOR,
    value: 0,
    margin: 0,
    startedAt: t,
    targetDate: t + 42 * DAY,
    installStart: null,
    installEnd: null,
    stageHistory: [],
    procurement: [],
    mobilizations: [],
    deliveries: [],
    crew: [],
    tasks: [],
    notes: [],
    timeLogs: [],
    signoff: null,
    trainingAt: null,
    ...partial,
    pipelineId: pl.id,
    stage,
    id,
    createdAt: t,
    updatedAt: t,
  };
  p.stageMeta = projectStageMeta(pipes, p);
  // Anchor the history at the stage the record opened in, so the first
  // real transition has a "from" to render against.
  if (!p.stageHistory.length) {
    p.stageHistory = [{ at: t, from: null, to: p.stage, by: p.owner }];
  }
  return p;
}

export async function createProject(
  partial: Partial<ProjectRecord> = {}
): Promise<ProjectRecord> {
  const t = now();
  const prefix = partial.kind === "order" ? "S" : "P";
  const base = prefix === "S" ? 4000 : 3000;
  const pipes = await loadPipelines();
  const build = (id: string): ProjectRecord => buildProject(id, partial, pipes, t);
  if (partial.id) {
    const p = build(partial.id);
    await upsertDoc<ProjectRecord>("projects", p);
    return p;
  }
  return insertWithPrefixedId<ProjectRecord>("projects", prefix, base, build);
}

/** Shallow-merge patch, bump updatedAt (port of update). */
export async function updateProject(
  id: string,
  patch: Partial<ProjectRecord>
): Promise<ProjectRecord | null> {
  return patchDoc<ProjectRecord>("projects", id, (p) => ({
    ...p,
    ...patch,
    id,
    updatedAt: now(),
  }));
}

/**
 * Task 9 follow-up (#UKN "fill it in later") — set a Daylite-imported
 * project's contract value by hand and clear `valueUnknown` so it drops out
 * of the value-unknown filter/worklist and starts counting in every total
 * (knownValue). A narrow, guarded patch — NOT the unguarded updateProject(),
 * which would let a caller silently reintroduce valueUnknown or touch fields
 * this form has no business changing. Leaves an audit note (like addNote)
 * only when the record actually was unknown, so a routine value correction
 * on an already-known project doesn't spam the notes feed.
 */
export async function setProjectValue(
  id: string,
  value: number,
  by: string = DEFAULT_ACTOR
): Promise<ProjectRecord | null> {
  return patchDoc<ProjectRecord>("projects", id, (p) => {
    const wasUnknown = !!p.valueUnknown;
    p.value = value;
    p.valueUnknown = false;
    if (wasUnknown) {
      p.notes = Array.isArray(p.notes) ? p.notes : [];
      p.notes.unshift({
        id: uid("nt-"),
        by,
        at: now(),
        text: `Contract value set to $${value.toLocaleString("en-US")} (was imported without a known value).`,
        photo: null,
      });
    }
    p.updatedAt = now();
    return p;
  });
}

/**
 * Port of remove(): a converted-then-deleted project adds its quoteId to the
 * dismissed list so syncFromQuotes never re-creates it. Soft delete.
 */
export async function removeProject(id: string): Promise<void> {
  const p = await getProject(id);
  if (p && p.quoteId) await addDismissed(p.quoteId);
  await softDeleteDoc("projects", id);
}

/** Append a transition to the record's stage history. No-op when the stage is unchanged. */
function recordStageChange(p: ProjectRecord, to: string, by: string, pipes: Pipelines): void {
  if (p.stage === to) return;
  if (!Array.isArray(p.stageHistory)) p.stageHistory = [];
  p.stageHistory.push({ at: now(), from: p.stage ?? null, to, by });
  p.stage = to;
  p.stageMeta = projectStageMeta(pipes, p);
}

type StageAt = { stage: string; tag: ProjectTag };

function stageAt(p: ProjectRecord, pipes: Pipelines): StageAt {
  return { stage: p.stage, tag: projectTag(p, pipes) };
}

/**
 * The one post-transition hook — every stage writer (setProjectStage, the
 * delivery auto-advance, sign-off) calls it AFTER its patch lands, with the
 * before/after stage + tag. No-op when the stage didn't change.
 *
 * - #17 template expansion: entering a stage adds its standard checklist once
 *   (coverage-key de-dup), whichever path moved the record there. Logged,
 *   never thrown, like the Done hook.
 * - Done hook (Item 16 / punch #16): the first time a record lands on its
 *   pipeline's Done-tagged stage, mint the "walk the completed site" Home
 *   Queue assignment (moved here from signoffAction). A failed mint is logged,
 *   never thrown — the stage change is already saved and must not be reported
 *   to the user as a failed stage update.
 */
async function afterStageChange(p: ProjectRecord, prev: StageAt, next: StageAt, by: string): Promise<void> {
  if (prev.stage === next.stage) return;
  // Same contract as the Done hook below: the stage is already saved, so a
  // checklist failure is logged, never surfaced as a failed stage update.
  try {
    const { templateForStage, expandTemplate, tasksForProject, createAutoTask } = await import("@/lib/stores/tasks");
    const existing = new Set((await tasksForProject(p.id)).map((t) => t.coverageKey).filter(Boolean) as string[]);
    for (const item of expandTemplate(templateForStage(next.stage), p.id + ":" + next.stage, existing)) {
      await createAutoTask({ ...item, projectId: p.id, title: item.title });
    }
  } catch (error) {
    console.error(`afterStageChange: ${next.stage} checklist for ${p.id} could not be created`, error);
  }
  if (prev.tag !== "done" && next.tag === "done") {
    const label = p.name || p.customer || p.id;
    try {
      await createAssignment({
        title: `Walk the completed site with the end user: ${label}`,
        assignee: p.owner || "Jeff Chesebro",
        createdBy: by,
        link: { kind: "project", id: p.id, label },
        source: "auto: project complete (#16)",
      });
    } catch (error) {
      console.error(`afterStageChange: completion follow-up for ${p.id} could not be created`, error);
    }
  }
}

/**
 * Move a record to a stage of its own pipeline. Refuses (returns null) a stage
 * id that isn't in the record's pipeline, or a missing/deleted record.
 */
export async function setProjectStage(
  id: string,
  stageId: string,
  by: string = DEFAULT_ACTOR
): Promise<ProjectRecord | null> {
  const pipes = await loadPipelines();
  const current = await getDoc<ProjectRecord>("projects", id);
  if (!current) return null;
  if (!stageById(projectPipelineFor(pipes, current), stageId)) return null;
  const prev: { at: StageAt | null } = { at: null };
  const result = await patchDoc<ProjectRecord>("projects", id, (p) => {
    normalizeProject(p, pipes);
    prev.at = stageAt(p, pipes);
    recordStageChange(p, stageId, by, pipes);
    p.updatedAt = now();
    return p;
  });
  // Guarded on `result` — patchDoc returns null for a nonexistent or
  // soft-deleted project, and the hook must not fire when the patch never applied.
  if (result && prev.at) await afterStageChange(result, prev.at, stageAt(result, pipes), by);

  return result;
}

/* ---------- quote conversion ---------- */

/** Detect whether a won quote carries install labor (port of quoteHasLabor). */
function quoteHasLabor(q: QuoteLike | null): boolean {
  if (!q) return true;
  const spec = q.spec;
  if (spec && Array.isArray(spec.sections))
    return spec.sections.some((s) => s.kind === "labor" && (s.items || []).length > 0);
  if (spec && typeof spec.hasLabor === "boolean") return spec.hasLabor;
  // sandbox/estimator stage-systems jobs are installed → labor by default.
  return true;
}

/** Generate a plausible procurement list for an auto-converted quote (port of deriveProcurement). */
function deriveProcurement(q: QuoteLike): ProcurementLine[] {
  const systems = (q.spec && q.spec.systems) || [];
  const out: ProcurementLine[] = [];
  const has = (s: string) => systems.some((x) => (x || "").toLowerCase().indexOf(s) >= 0);
  if (!systems.length || has("rig"))
    out.push(
      buildProcurementLine({
        sku: "JC-RIG-PKG",
        desc: "Rigging hardware package",
        vendor: "JR Clancy",
        qty: 1,
        unit: "lot",
        cost: Math.round((q.value || 0) * 0.22),
      })
    );
  if (!systems.length || has("curt") || has("drap"))
    out.push(
      buildProcurementLine({
        sku: "RB-SG-PKG",
        desc: "Soft goods package (sewn to order)",
        vendor: "Rose Brand",
        qty: 1,
        unit: "lot",
        cost: Math.round((q.value || 0) * 0.18),
      })
    );
  if (has("control") || has("fixture") || has("light"))
    out.push(
      buildProcurementLine({
        sku: "ETC-CTL-PKG",
        desc: "Control & dimming package",
        vendor: "ETC",
        qty: 1,
        unit: "lot",
        cost: Math.round((q.value || 0) * 0.2),
      })
    );
  if (has("shell") || has("acoust"))
    out.push(
      buildProcurementLine({
        sku: "WN-SHELL-PKG",
        desc: "Acoustical shell package",
        vendor: "Wenger",
        qty: 1,
        unit: "lot",
        cost: Math.round((q.value || 0) * 0.3),
      })
    );
  out.push(
    buildProcurementLine({
      sku: "GEN-HW",
      desc: "Field hardware & consumables",
      vendor: "In-stock",
      qty: 1,
      unit: "lot",
      cost: Math.round((q.value || 0) * 0.05),
    })
  );
  return out;
}

/** Port of fromQuote(q) — the id is assigned by the caller. Lands on the first stage of the kind's pipeline. */
function fromQuote(q: QuoteLike, pipes: Pipelines): Omit<ProjectRecord, "id"> {
  const labor = quoteHasLabor(q);
  const t = now();
  const requestedWindow = typeof q.installTimeframe === "string" ? q.installTimeframe.trim() : "";
  const windowDays: Record<string, number> = {
    ASAP: 14,
    "Under 1 month": 30,
    "1–3 months": 90,
    "3–6 months": 180,
    "6–12 months": 365,
  };
  const targetDays = windowDays[requestedWindow] ?? (labor ? 42 : 21);
  const targetDate = ahead(targetDays);
  const installDuration = labor ? Math.max(6, Number((q.spec as { mobs?: { days?: number }[] } | undefined)?.mobs?.reduce((sum, m) => sum + (Number(m.days) || 0), 0)) || 6) : 0;
  const kind: ProjectKind = labor ? "project" : "order";
  const pl = projectPipelineFor(pipes, { kind });
  const stage = firstStage(pl).id;
  return {
    kind,
    pipelineId: pl.id,
    quoteId: q.id,
    projectType: q.quoteType || null,
    name: q.name,
    customer: q.customer || "",
    customerId: q.customerId || null,
    locationId: q.locationId || null,
    owner: q.owner || DEFAULT_ACTOR,
    value: q.value || 0,
    margin: q.margin || 0,
    createdAt: t,
    updatedAt: t,
    startedAt: t,
    targetDate,
    installStart: labor ? ahead(Math.max(0, targetDays - installDuration)) : null,
    installEnd: labor ? targetDate : null,
    stage,
    stageMeta: projectStageMeta(pipes, { kind, pipelineId: pl.id, stage }),
    // Opening entry — createProject() re-anchors it too, but the sync sweep
    // inserts directly and must carry its own.
    stageHistory: [{ at: t, from: null, to: stage, by: q.owner || DEFAULT_ACTOR }],
    procurement: deriveProcurement(q),
    mobilizations: (q.spec && q.spec.mobs) || [],
    deliveries: [],
    crew: [],
    tasks: [],
    notes: [],
    timeLogs: [],
    signoff: null,
    trainingAt: null,
  };
}

/**
 * Convert a specific won quote into a project/order — idempotent (port of
 * createFromQuote).
 *
 * #180: the whole check-then-insert runs under an advisory lock keyed on the
 * quote id (`withQuoteLock`), so a healing sweep racing another sweep or a
 * live re-approval for the SAME quote serializes instead of minting a
 * duplicate project. `q` and the dismissed list are both re-read fresh
 * *inside* the lock rather than trusted from a caller's snapshot, so a
 * quote a concurrent action since dismissed (#169) or marked lost cannot
 * spawn a project here — see #180's status-recheck requirement.
 *
 * Always honours the dismissed list, including from the Projects screen's
 * explicit "convert this pending quote" action (`startConversionAction`).
 * An earlier version let that one caller pass an option to skip this check,
 * on the theory that a person re-converting a quote they'd dismissed meant
 * it — dropped in review: `pendingConversions` already hides a dismissed
 * quote from that screen entirely, so the only way to reach this with a
 * dismissed id was a hand-crafted POST, and a bypass reachable that way is
 * a way to resurrect a project the user deliberately deleted (#169).
 */
export async function createProjectFromQuote(
  quoteId: string
): Promise<ProjectRecord | null> {
  return withQuoteLock(quoteId, async () => {
    const existing = await getProjectByQuote(quoteId);
    if (existing) return existing;
    if ((await dismissedQuoteIds()).includes(quoteId)) return null;
    const q = await getDoc<QuoteLike>("quotes", quoteId);
    if (
      !q ||
      q.status !== "won" ||
      q.quoteType === "flame_test" ||
      q.quoteType === "repair" ||
      q.quoteType === "inspection" ||
      q.quoteType === "consulting" ||
      q.quoteType === "rental"
    )
      return null;
    const p = await createProject(fromQuote(q, await loadPipelines()));

    // Item 16 (task-first): a sold install spawns the PM kickoff follow-up.
    // Unassigned until the project-roles model exists (D87: assign-by-role later).
    const { createAutoTask } = await import("@/lib/stores/tasks");
    await createAutoTask({
      coverageKey: `item16:sold:${p.id}`,
      title: `Sold — kickoff call for ${p.name}`,
      projectId: p.id, quoteId: p.quoteId, section: "Follow-up",
      dueAt: Date.now() + 7 * DAY, // kickoff within a week of sale; overdue then nags the bell (unassigned until roles model, D87)
    });

    return p;
  });
}

/**
 * PUNCHLIST #13, decision A — a lightweight, non-progressing project entry
 * linked from a won inspection/repair quote (dual-write: the inspection or
 * repair record stays what it is and gains a `projectId` back-link, it does
 * not get converted). Called from inspections.ts/repair-jobs.ts's own
 * createFromQuote/syncFromQuotes — those already own the "signed off" =
 * quote-approved trigger (decision B), so this only needs to spawn the
 * project, not decide when to.
 *
 * Deliberately NOT a real install/order to progress:
 * - Born on the order pipeline's Done-tagged stage, never moved there via
 *   setProjectStage() — so it never fires that function's post-transition
 *   hook (the #16 completion follow-up, TASK_TEMPLATE expansion), which is
 *   for real installs work a PM actually walks through, not a service job's
 *   shadow record.
 * - The Installs book and every open/active rollup (lib/dashboard/metrics.ts)
 *   filter on the Done tag (isDone / isActive), so a done-from-birth record
 *   can never inflate an active-pipeline rollup.
 * - `value: 0`, not copied from the quote — the real dollar figure already
 *   lives on the quote/inspection/repair record; carrying it here too would
 *   double-count revenue in anything that sums ProjectRecord.value.
 * - No crew, no procurement, no deliveries — an inspection/repair already
 *   owns its own scheduling (assignedTo/scheduledDate) and already renders
 *   on the main Gantt via operations-work.ts (D100/D115); this project
 *   entry exists purely so the job also shows up in /projects, not to
 *   duplicate its scheduling.
 *
 * Idempotent on quoteId, matching createProjectFromQuote's own pattern.
 */
export async function spawnServiceLinkedProject(
  q: QuoteLike,
  projectType: "inspection" | "repair"
): Promise<ProjectRecord> {
  const existing = await getProjectByQuote(q.id);
  if (existing) return existing;
  const pl = projectPipelineFor(await loadPipelines(), { kind: "order" });
  const done = pl.stages.find((s) => s.tag === "done") || pl.stages[pl.stages.length - 1];
  return createProject({
    kind: "order",
    pipelineId: pl.id,
    quoteId: q.id,
    projectType,
    name: q.name,
    customer: q.customer || "",
    customerId: q.customerId || null,
    locationId: q.locationId || null,
    owner: q.owner || DEFAULT_ACTOR,
    value: 0,
    margin: 0,
    stage: done.id,
  });
}

/**
 * Scan won quotes and auto-create any not yet converted (and not dismissed).
 * Returns the number created. Called on the Projects screen load.
 *
 * Flame-test quotes have their own independent job lifecycle (FlameJobStore)
 * — they must NOT become Installs projects (port of syncFromQuotes).
 */
export async function syncProjectsFromQuotes(): Promise<{ created: number; skipped: string[] }> {
  const skip = await dismissedQuoteIds();
  const projects = await listDocs<ProjectRecord>("projects");
  const haveQ = new Set<string>();
  for (const p of projects) if (p.quoteId) haveQ.add(p.quoteId);
  // QuoteStore.getAll() order: newest activity first.
  const quotes = (await listDocs<QuoteLike>("quotes"))
    .slice()
    .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  let made = 0;
  const skipped: string[] = [];
  for (const q of quotes) {
    // Only install/system quotes become Projects. Repair and inspection wins
    // spawn their OWN records (repair-jobs / inspections syncs) — before this
    // filter they ALSO minted phantom Projects that polluted the Projects
    // list, Schedule, and Field Work (PUNCHLIST #13 bug). Consulting wins
    // spawn ConsultingEngagements (engagements sync, D90) — same rule.
    if (
      q.status !== "won" ||
      q.quoteType === "flame_test" ||
      q.quoteType === "repair" ||
      q.quoteType === "inspection" ||
      q.quoteType === "consulting" ||
      q.quoteType === "rental"
    )
      continue;
    // `haveQ`/`skip` are only a fast-path skip built from one snapshot, not
    // the correctness guard — createProjectFromQuote (#180) re-reads both
    // the live project and the dismissed list fresh, under its advisory
    // lock, before it will insert.
    if (haveQ.has(q.id) || skip.includes(q.id)) continue;
    try {
      const rec = await createProjectFromQuote(q.id);
      if (rec) {
        haveQ.add(q.id);
        made++;
      }
    } catch (error) {
      skipped.push(q.id);
      console.error(`syncProjectsFromQuotes: skipped ${q.id} during page-load reconciliation`, error);
    }
  }
  return { created: made, skipped };
}

/** Won quotes that have not been converted yet — the "ready to start" strip (port of pendingConversions). */
/**
 * Won quotes that have not been converted yet — the "ready to start" strip.
 *
 * #180 review: this exclusion list must match createProjectFromQuote's own
 * refusal list EXACTLY, or a quote type that function refuses (and so
 * createProjectFromQuote returns null for) still shows up here with a
 * "Start" button that silently does nothing when clicked. It was missing
 * repair/inspection — those spawn their OWN records (repair-jobs.ts /
 * inspections.ts) and createProjectFromQuote has refused them since #13,
 * but this list only ever excluded flame_test/consulting.
 *
 * "rental" is excluded here, matching createProjectFromQuote and
 * syncProjectsFromQuotes — a won rental becomes equipment bookings
 * (equipment-bookings.ts on the real win path), not an Installs project.
 */
export async function pendingConversions(): Promise<QuoteLike[]> {
  const skip = await dismissedQuoteIds();
  const have = new Set<string>();
  for (const p of await listDocs<ProjectRecord>("projects")) if (p.quoteId) have.add(p.quoteId);
  return (await listDocs<QuoteLike>("quotes"))
    .filter(
      (q) =>
        q.status === "won" &&
        q.quoteType !== "flame_test" &&
        q.quoteType !== "repair" &&
        q.quoteType !== "inspection" &&
        q.quoteType !== "consulting" &&
        q.quoteType !== "rental" &&
        !have.has(q.id) &&
        !skip.includes(q.id)
    )
    .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
}

/* ---------- procurement / lead times ---------- */

export async function setLineStatus(
  id: string,
  lineId: string,
  status: LineStatus
): Promise<ProjectRecord | null> {
  const p = await getProject(id);
  if (!p) return null;
  if (!(p.procurement || []).some((l) => l.id === lineId)) return null;
  return patchDoc<ProjectRecord>("projects", id, (doc) => {
    const l = (doc.procurement || []).find((x) => x.id === lineId);
    if (!l) return doc;
    l.status = status;
    if (status === "ordered" && !l.orderedAt) {
      l.orderedAt = now();
    }
    doc.updatedAt = now();
    return doc;
  });
}

/** Record the real PO number from the procurement system (punch #67 — free text, no format/uniqueness enforcement). */
export async function setLinePo(
  id: string,
  lineId: string,
  po: string
): Promise<ProjectRecord | null> {
  const p = await getProject(id);
  if (!p) return null;
  if (!(p.procurement || []).some((l) => l.id === lineId)) return null;
  return patchDoc<ProjectRecord>("projects", id, (doc) => {
    const l = (doc.procurement || []).find((x) => x.id === lineId);
    if (!l) return doc;
    l.po = po.trim();
    doc.updatedAt = now();
    return doc;
  });
}

export async function setDeliveryStatus(
  id: string,
  deliveryId: string,
  status: DeliveryStatus
): Promise<ProjectRecord | null> {
  const p = await getProject(id);
  if (!p) return null;
  if (!(p.deliveries || []).some((d) => d.id === deliveryId)) return null;
  const pipes = await loadPipelines();
  const prev: { at: StageAt | null } = { at: null };
  const result = await patchDoc<ProjectRecord>("projects", id, (doc) => {
    normalizeProject(doc, pipes);
    prev.at = stageAt(doc, pipes);
    const pl = projectPipelineFor(pipes, doc);
    const deliveries = Array.isArray(doc.deliveries) ? doc.deliveries : [];
    doc.deliveries = deliveries;
    const d = deliveries.find((x) => x.id === deliveryId);
    if (!d) return doc;
    d.status = status;
    if (status === "received") d.receivedAt = now();
    // Delivery-driven lifecycle (#44): once every shipment is physically
    // received, a stage flagged advanceOnDelivered (Equipment ordered,
    // Deliveries) moves on to the next stage of its pipeline. This does not
    // block crew booking and the normal stage controls can still undo or
    // correct the transition when a receipt was entered in error.
    if (
      status === "received" &&
      deliveries.length > 0 &&
      deliveries.every((row) => row.status === "received") &&
      stageById(pl, doc.stage)?.advanceOnDelivered
    ) {
      const nx = nextStage(pl, doc.stage);
      if (nx) recordStageChange(doc, nx.id, "System", pipes);
    }
    doc.updatedAt = now();
    return doc;
  });
  if (result && prev.at) await afterStageChange(result, prev.at, stageAt(result, pipes), "System");
  return result;
}

/* ---------- crew ---------- */

export async function addCrew(
  id: string,
  person: string,
  role?: string,
  start?: number | null,
  end?: number | null,
  mobId?: string | null
): Promise<ProjectRecord | null> {
  return patchDoc<ProjectRecord>("projects", id, (p) => {
    p.crew = Array.isArray(p.crew) ? p.crew : [];
    p.crew.push({
      id: uid("cw-"),
      person,
      role: role || "Installer",
      start: start || p.installStart || ahead(7),
      end: end || p.installEnd || ahead(10),
      mobId: mobId || null,
    });
    p.updatedAt = now();
    return p;
  });
}

export async function removeCrew(id: string, crewId: string): Promise<ProjectRecord | null> {
  return patchDoc<ProjectRecord>("projects", id, (p) => {
    p.crew = (p.crew || []).filter((c) => c.id !== crewId);
    p.updatedAt = now();
    return p;
  });
}

/** Reschedule / reassign a booking (used by the resource scheduler — drag to move). */
export async function updateCrew(
  id: string,
  crewId: string,
  patch: Partial<CrewAssignment>
): Promise<ProjectRecord | null> {
  const p = await getProject(id);
  if (!p) return null;
  if (!(p.crew || []).some((c) => c.id === crewId)) return null;
  return patchDoc<ProjectRecord>("projects", id, (doc) => {
    const c = (doc.crew || []).find((x) => x.id === crewId);
    if (!c) return doc;
    Object.assign(c, patch || {});
    doc.updatedAt = now();
    return doc;
  });
}

/* ---------- field: notes, time ---------- */
// addTask / toggleTask (embedded ProjectTask[] writers) removed — tasks (#17)
// now live in the tasks collection (src/lib/stores/tasks.ts). The `tasks`
// field + ProjectTask type stay for legacy docs and the lazy migration
// (ensureProjectTasksMigrated) that reads them.

export async function addNote(
  id: string,
  by?: string,
  text?: string,
  photo?: string | null
): Promise<ProjectRecord | null> {
  return patchDoc<ProjectRecord>("projects", id, (p) => {
    p.notes = Array.isArray(p.notes) ? p.notes : [];
    p.notes.unshift({
      id: uid("nt-"),
      by: by || "Field",
      at: now(),
      text: text || "",
      photo: photo || null,
    });
    p.updatedAt = now();
    return p;
  });
}

export async function addTime(
  id: string,
  person?: string,
  hours?: number | string,
  note?: string
): Promise<ProjectRecord | null> {
  return patchDoc<ProjectRecord>("projects", id, (p) => {
    p.timeLogs = Array.isArray(p.timeLogs) ? p.timeLogs : [];
    p.timeLogs.push({
      id: uid("tl-"),
      person: person || DEFAULT_ACTOR,
      date: now(),
      hours: parseFloat(String(hours)) || 0,
      note: note || "",
    });
    p.updatedAt = now();
    return p;
  });
}

/** Soft-delete one field note (Round 2 delete pass) — flags the embedded
 *  entry rather than splicing it, matching the studio-designs.ts blob
 *  convention for items that live inside a larger record. */
export async function removeNote(id: string, noteId: string): Promise<ProjectRecord | null> {
  return patchDoc<ProjectRecord>("projects", id, (p) => {
    p.notes = (p.notes || []).map((n) => (n.id === noteId ? { ...n, deleted: true } : n));
    p.updatedAt = now();
    return p;
  });
}

/** Soft-delete one time-log entry — see removeNote above. */
export async function removeTime(id: string, entryId: string): Promise<ProjectRecord | null> {
  return patchDoc<ProjectRecord>("projects", id, (p) => {
    p.timeLogs = (p.timeLogs || []).map((t) => (t.id === entryId ? { ...t, deleted: true } : t));
    p.updatedAt = now();
    return p;
  });
}

export async function setSignoff(
  id: string,
  signoff: Partial<ProjectSignoff> | null,
  signedBy?: string
): Promise<ProjectRecord | null> {
  const pipes = await loadPipelines();
  const prev: { at: StageAt | null } = { at: null };
  const result = await patchDoc<ProjectRecord>("projects", id, (p) => {
    normalizeProject(p, pipes);
    prev.at = stageAt(p, pipes);
    p.signoff = signoff
      ? { signedBy: signedBy || DEFAULT_ACTOR, signedAt: now(), ...signoff }
      : null;
    // Sign-off is the hand-off, not the close: it moves a record that hasn't
    // reached closeout yet onto its pipeline's first closeout stage (Invoice /
    // Delivered & accepted). Done is a separate, explicit step.
    if (signoff && PROJECT_TAG_RANK[projectTag(p, pipes)] < PROJECT_TAG_RANK.closeout) {
      const pl = projectPipelineFor(pipes, p);
      const to = firstStageWithTag(pl, "closeout") || firstStageWithTag(pl, "done");
      if (to) recordStageChange(p, to.id, signedBy || DEFAULT_ACTOR, pipes);
    }
    p.updatedAt = now();
    return p;
  });
  if (result && prev.at) await afterStageChange(result, prev.at, stageAt(result, pipes), signedBy || DEFAULT_ACTOR);
  return result;
}

/* ---------- derived helpers (lead times) — pure, synchronous ---------- */

/** Order-by date: when a line must be on order so it lands STAGING_BUFFER days before target. */
export function orderByDate(p: ProjectRecord, l: ProcurementLine): number {
  const lead = (l.leadDays || 0) + STAGING_BUFFER;
  return (p.targetDate || ahead(30)) - lead * DAY;
}

/** The single longest-lead (critical path) line id. */
export function criticalLineId(p: ProjectRecord): string | null {
  let best: string | null = null;
  let bestLead = -1;
  for (const l of p.procurement || []) {
    if ((l.leadDays || 0) > bestLead) {
      bestLead = l.leadDays || 0;
      best = l.id;
    }
  }
  return best;
}

/** Is a pending/late line past the date it should have been ordered? */
export function lineLate(p: ProjectRecord, l: ProcurementLine): boolean {
  if (l.status === "received" || l.status === "shipped") return false;
  return orderByDate(p, l) < now();
}

export function procurementProgress(p: ProjectRecord): number {
  const lines = p.procurement || [];
  if (!lines.length) return 1;
  const score = (s: LineStatus) =>
    s === "received" ? 1 : s === "shipped" ? 0.75 : s === "ordered" ? 0.4 : 0;
  return lines.reduce((a, l) => a + score(l.status), 0) / lines.length;
}

export function progressPct(p: ProjectRecord): number {
  const m = p.stageMeta || projectStageMeta(DEFAULT_PIPELINES, p);
  return m.count > 1 ? Math.round((m.index / (m.count - 1)) * 100) : 100;
}

/** Anything needing the PM's attention on this project (port of riskFlags). */
export function riskFlags(p: ProjectRecord): RiskFlag[] {
  const flags: RiskFlag[] = [];
  if (isDone(p)) return flags;
  for (const l of p.procurement || []) {
    if (lineLate(p, l)) flags.push({ kind: "late-order", label: "Order overdue: " + l.desc });
  }
  const dueIn = Math.ceil(((p.targetDate || 0) - now()) / DAY);
  if (
    p.kind === "project" &&
    isBacklog(p) &&
    dueIn <= 14 &&
    dueIn >= 0
  ) {
    if (!(p.crew || []).length)
      flags.push({ kind: "no-crew", label: "No crew scheduled, install in " + dueIn + "d" });
  }
  return flags;
}

/* ---------- formatting helpers (ported for parity) ---------- */

export function timeAgo(ts: number | null | undefined): string {
  if (!ts) return "—";
  const diff = now() - ts;
  const d = Math.floor(diff / DAY);
  if (d <= 0) {
    const h = Math.floor(diff / 3600000);
    return h <= 0 ? "just now" : h + "h ago";
  }
  if (d === 1) return "yesterday";
  if (d < 14) return d + "d ago";
  return new Date(ts).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

/** "Feb 22" for a date in the current year, "Feb 22, 2012" otherwise — the
 *  Daylite history import brings jobs back to 2005, and a year-less date on
 *  one of those ("Closed Sep 14") reads as this year. The logic lives in
 *  lib/format's client-safe yearAwareDate (Field Work's client controls use
 *  it directly). `nowTs` is for tests. */
export function fmtDate(ts: number | null | undefined, nowTs: number = now()): string {
  return yearAwareDate(ts, nowTs);
}

export function fmtDateY(ts: number | null | undefined): string {
  return ts
    ? new Date(ts).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
      })
    : "—";
}

export function daysUntil(ts: number | null | undefined): number {
  return Math.ceil(((ts || 0) - now()) / DAY);
}

/* ---------- seed reset ---------- */

/** Port of resetToSeed(): replace the collection with the demo seed set. */
export async function resetProjectsToSeed(): Promise<ProjectRecord[]> {
  const { projectsSeed } = await import("@/db/seeds/projects");
  const existing = await listDocs<ProjectRecord>("projects");
  for (const p of existing) await softDeleteDoc("projects", p.id);
  const seeds = projectsSeed();
  for (const p of seeds) await upsertDoc<ProjectRecord>("projects", p);
  return seeds;
}
