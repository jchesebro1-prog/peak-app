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

const DISMISSED_BLOB_ID = "projects_dismissed";

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

export type ProjectStage =
  | "procurement"
  | "delivery"
  | "scheduled"
  | "install"
  | "training"
  | "signoff"
  | "complete";

export type StageDef = { key: ProjectStage; label: string; short: string };

export const PROJECT_STAGES: StageDef[] = [
  { key: "procurement", label: "Order materials", short: "Materials" },
  { key: "delivery", label: "Deliveries", short: "Deliveries" },
  { key: "scheduled", label: "Crew scheduled", short: "Scheduled" },
  { key: "install", label: "Install", short: "Install" },
  { key: "training", label: "Training", short: "Training" },
  { key: "signoff", label: "Customer sign-off", short: "Sign-off" },
  { key: "complete", label: "Complete", short: "Complete" },
];

export const ORDER_STAGES: StageDef[] = [
  { key: "procurement", label: "Order materials", short: "Materials" },
  { key: "delivery", label: "Deliveries", short: "Deliveries" },
  { key: "signoff", label: "Delivered & accepted", short: "Delivered" },
  { key: "complete", label: "Complete", short: "Complete" },
];

export function stagesFor(kind: ProjectKind): StageDef[] {
  return kind === "order" ? ORDER_STAGES : PROJECT_STAGES;
}

export function stageIndex(kind: ProjectKind, stage: ProjectStage): number {
  const s = stagesFor(kind);
  const i = s.findIndex((x) => x.key === stage);
  return i < 0 ? 0 : i;
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
};

export type TimeLog = {
  id: string; // uid('tl-')
  person: string;
  date: number;
  hours: number;
  note: string;
};

export type ProjectSignoff = {
  name?: string;
  role?: string;
  signedBy: string;
  signedAt: number;
  note?: string;
};

export type ProjectRecord = {
  id: string; // P-#### (base 3000) | S-#### (base 4000)
  kind: ProjectKind;
  quoteId: string | null;
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
  stage: ProjectStage;
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

/**
 * One stage transition, appended on every stage write. Mirrors QuoteHistoryEntry
 * ({at, from, to}) and adds the actor. `from: null` marks the record's opening
 * stage. Existing projects start with an empty array — history before this
 * change was overwritten in place and is unrecoverable.
 */
export type ProjectStageChange = {
  at: number;
  from: ProjectStage | null;
  to: ProjectStage;
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

/** Port of migrate(): backfill array fields, kind, and stage on read. */
function normalizeProject(p: ProjectRecord): ProjectRecord {
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
  if (!p.stage) p.stage = "procurement";
  return p;
}

/* ---------- dismissed list (blob singleton "projects_dismissed") ---------- */

async function dismissedQuoteIds(): Promise<string[]> {
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
  return list.map(normalizeProject).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
}

export async function getProject(id: string): Promise<ProjectRecord | null> {
  const p = await getDoc<ProjectRecord>("projects", id);
  return p ? normalizeProject(p) : null;
}

/** Port of byQuote(qid). */
export async function getProjectByQuote(quoteId: string): Promise<ProjectRecord | null> {
  const list = await listDocs<ProjectRecord>("projects");
  const p = list.find((x) => x.quoteId === quoteId);
  return p ? normalizeProject(p) : null;
}

export async function createProject(
  partial: Partial<ProjectRecord> = {}
): Promise<ProjectRecord> {
  const t = now();
  const prefix = partial.kind === "order" ? "S" : "P";
  const base = prefix === "S" ? 4000 : 3000;
  const build = (id: string): ProjectRecord => {
    const p: ProjectRecord = {
      kind: "project",
      quoteId: null,
      name: "Untitled project",
      customer: "",
      customerId: null,
      locationId: null,
      owner: DEFAULT_ACTOR,
      value: 0,
      margin: 0,
      startedAt: t,
      targetDate: ahead(42),
      installStart: null,
      installEnd: null,
      stage: "procurement",
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
      id,
      createdAt: t,
      updatedAt: t,
    };
    // Anchor the history at the stage the record opened in, so the first
    // real transition has a "from" to render against.
    if (!p.stageHistory.length) {
      p.stageHistory = [{ at: t, from: null, to: p.stage, by: p.owner }];
    }
    return p;
  };
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
 * Port of remove(): a converted-then-deleted project adds its quoteId to the
 * dismissed list so syncFromQuotes never re-creates it. Soft delete.
 */
export async function removeProject(id: string): Promise<void> {
  const p = await getProject(id);
  if (p && p.quoteId) await addDismissed(p.quoteId);
  await softDeleteDoc("projects", id);
}

/** Append a transition to the record's stage history. No-op when the stage is unchanged. */
function recordStageChange(p: ProjectRecord, to: ProjectStage, by: string): void {
  if (p.stage === to) return;
  if (!Array.isArray(p.stageHistory)) p.stageHistory = [];
  p.stageHistory.push({ at: now(), from: p.stage ?? null, to, by });
  p.stage = to;
}

export async function setProjectStage(
  id: string,
  stage: ProjectStage,
  by: string = DEFAULT_ACTOR
): Promise<ProjectRecord | null> {
  const result = await patchDoc<ProjectRecord>("projects", id, (p) => {
    recordStageChange(p, stage, by);
    if (stage === "training" && !p.trainingAt) p.trainingAt = now();
    p.updatedAt = now();
    return p;
  });

  // #17 template expansion: entering a stage adds its standard checklist once
  // (coverage-key de-dup; TASK_TEMPLATE ships empty until the checklist
  // homework lands, so this is a safe no-op today). Guarded on `result` —
  // patchDoc returns null for a nonexistent or soft-deleted project, and the
  // expansion must not fire when the stage patch never actually applied.
  if (result) {
    const { TASK_TEMPLATE, expandTemplate, tasksForProject, createAutoTask } = await import("@/lib/stores/tasks");
    const existing = new Set((await tasksForProject(id)).map((t) => t.coverageKey).filter(Boolean) as string[]);
    for (const item of expandTemplate(TASK_TEMPLATE[stage] || [], id + ":" + stage, existing)) {
      await createAutoTask({ ...item, projectId: id, title: item.title });
    }

    // Item 16: completion spawns the salesperson's how-did-it-go follow-up.
    // "Lead Sales" ≈ the originating quote's owner until roles exist (D87).
    if (stage === "complete") {
      let owner = "";
      if (result.quoteId) {
        const q = await getDoc<QuoteLike>("quotes", result.quoteId);
        owner = q?.owner || "";
      }
      await createAutoTask({
        coverageKey: `item16:completed:${id}`,
        title: `Completed — follow up with customer on ${result.name}`,
        projectId: id, quoteId: result.quoteId, section: "Follow-up",
        assigneeName: owner,
      });
    }
  }

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

/** Port of fromQuote(q) — the id is assigned by the caller. */
function fromQuote(q: QuoteLike): Omit<ProjectRecord, "id"> {
  const labor = quoteHasLabor(q);
  const t = now();
  const kind: ProjectKind = labor ? "project" : "order";
  return {
    kind,
    quoteId: q.id,
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
    targetDate: ahead(labor ? 42 : 21),
    installStart: labor ? ahead(38) : null,
    installEnd: labor ? ahead(44) : null,
    stage: "procurement",
    stageHistory: [], // createProject() anchors the opening entry
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

/** Convert a specific won quote into a project/order — idempotent (port of createFromQuote). */
export async function createProjectFromQuote(quoteId: string): Promise<ProjectRecord | null> {
  const existing = await getProjectByQuote(quoteId);
  if (existing) return existing;
  const q = await getDoc<QuoteLike>("quotes", quoteId);
  if (!q || q.quoteType === "flame_test" || q.quoteType === "consulting") return null;
  const p = await createProject(fromQuote(q));

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
}

/**
 * Scan won quotes and auto-create any not yet converted (and not dismissed).
 * Returns the number created. Called on the Projects screen load.
 *
 * Flame-test quotes have their own independent job lifecycle (FlameJobStore)
 * — they must NOT become Installs projects (port of syncFromQuotes).
 */
export async function syncProjectsFromQuotes(): Promise<number> {
  const skip = await dismissedQuoteIds();
  const projects = await listDocs<ProjectRecord>("projects");
  const haveQ = new Set<string>();
  for (const p of projects) if (p.quoteId) haveQ.add(p.quoteId);
  // QuoteStore.getAll() order: newest activity first.
  const quotes = (await listDocs<QuoteLike>("quotes"))
    .slice()
    .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  let made = 0;
  const { createAutoTask } = await import("@/lib/stores/tasks");
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
      q.quoteType === "consulting"
    )
      continue;
    if (haveQ.has(q.id) || skip.includes(q.id)) continue;
    const body = fromQuote(q);
    const rec = await insertWithPrefixedId<ProjectRecord>(
      "projects",
      body.kind === "order" ? "S" : "P",
      body.kind === "order" ? 4000 : 3000,
      (id) => ({ ...body, id })
    );
    const id = rec.id;
    haveQ.add(q.id);
    made++;

    // Item 16 (task-first): a sold install spawns the PM kickoff follow-up.
    // Unassigned until the project-roles model exists (D87: assign-by-role
    // later). Deterministic coverageKey makes double-hooking alongside
    // createProjectFromQuote's own call harmless (createAutoTask no-ops).
    await createAutoTask({
      coverageKey: `item16:sold:${id}`,
      title: `Sold — kickoff call for ${body.name}`,
      projectId: id, quoteId: body.quoteId, section: "Follow-up",
      dueAt: Date.now() + 7 * DAY, // kickoff within a week of sale; overdue then nags the bell (unassigned until roles model, D87)
    });
  }
  return made;
}

/** Won quotes that have not been converted yet — the "ready to start" strip (port of pendingConversions). */
export async function pendingConversions(): Promise<QuoteLike[]> {
  const skip = await dismissedQuoteIds();
  const have = new Set<string>();
  for (const p of await listDocs<ProjectRecord>("projects")) if (p.quoteId) have.add(p.quoteId);
  return (await listDocs<QuoteLike>("quotes"))
    .filter(
      (q) =>
        q.status === "won" &&
        q.quoteType !== "flame_test" &&
        q.quoteType !== "consulting" &&
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

export async function setDeliveryStatus(
  id: string,
  deliveryId: string,
  status: DeliveryStatus
): Promise<ProjectRecord | null> {
  const p = await getProject(id);
  if (!p) return null;
  if (!(p.deliveries || []).some((d) => d.id === deliveryId)) return null;
  return patchDoc<ProjectRecord>("projects", id, (doc) => {
    const d = (doc.deliveries || []).find((x) => x.id === deliveryId);
    if (!d) return doc;
    d.status = status;
    if (status === "received") d.receivedAt = now();
    doc.updatedAt = now();
    return doc;
  });
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

export async function setSignoff(
  id: string,
  signoff: Partial<ProjectSignoff> | null,
  signedBy?: string
): Promise<ProjectRecord | null> {
  return patchDoc<ProjectRecord>("projects", id, (p) => {
    p.signoff = signoff
      ? { signedBy: signedBy || DEFAULT_ACTOR, signedAt: now(), ...signoff }
      : null;
    if (signoff && p.stage !== "complete") {
      recordStageChange(p, "signoff", signedBy || DEFAULT_ACTOR);
    }
    p.updatedAt = now();
    return p;
  });
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
  const stages = stagesFor(p.kind);
  const i = stageIndex(p.kind, p.stage);
  return Math.round((i / (stages.length - 1)) * 100);
}

/** Anything needing the PM's attention on this project (port of riskFlags). */
export function riskFlags(p: ProjectRecord): RiskFlag[] {
  const flags: RiskFlag[] = [];
  if (p.stage === "complete") return flags;
  for (const l of p.procurement || []) {
    if (lineLate(p, l)) flags.push({ kind: "late-order", label: "Order overdue: " + l.desc });
  }
  const dueIn = Math.ceil(((p.targetDate || 0) - now()) / DAY);
  if (
    p.kind === "project" &&
    (p.stage === "procurement" || p.stage === "delivery") &&
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

export function fmtDate(ts: number | null | undefined): string {
  return ts
    ? new Date(ts).toLocaleDateString("en-US", { month: "short", day: "numeric" })
    : "—";
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
