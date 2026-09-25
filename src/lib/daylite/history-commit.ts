/**
 * Daylite history import — server preview + idempotent commit (Task 11).
 *
 * `history.ts` (pure) turns the two TSVs into a plan; this module resolves that
 * plan against the live database — companies, contacts, team members, ids
 * already imported — and, on commit, writes the records.
 *
 * What commit deliberately does NOT do (spec §4.2/§4.3):
 * - never calls setProjectStage / setSignoff / setDeliveryStatus — those fire
 *   the stage hook (checklist templates, the "walk the completed site"
 *   assignment). A thousand historical jobs must land silently, so projects
 *   are written with createProject + direct doc patches only.
 * - never calls Quotes.setStatus — that mints the "Install sold" assignment
 *   and runs quote-spawn. Imported quotes are written with create() + a plain
 *   update(); a won one is linked to (or creates) its project here, with
 *   `quoteId` set, so the page-load sweep syncProjectsFromQuotes sees the
 *   quote as already converted and never makes a second project.
 * - repairs are written through repair-jobs create(); completedAt years ago
 *   only reads as "Warranty lapsed" — nothing in the app turns a warranty
 *   state into a task or assignment.
 *
 * Idempotence: every id is deterministic (./ids). A planned id that already
 * exists — soft-deleted included, so a record Jeff deleted is not resurrected
 * by the upserting store creates — is skipped and counted.
 *
 * Design spec: docs/superpowers/specs/2026-09-24-daylite-pipelines-and-history-import-design.md §4.
 */

import { getDoc, listDocs, patchDoc } from "@/db/doc-store";
import type { ContactRow } from "@/db/schema";
import { allCompanies } from "@/lib/identity/companies";
import { allContacts } from "@/lib/identity/contacts";
import { PARTNER_TYPES } from "@/lib/identity/venue-defaults";
import { allUsers } from "@/lib/users";
import { loadPipelines } from "@/lib/pipelines-server";
import {
  firstStage,
  projectPipelineFor,
  resolveProjectStage,
  stageById,
  type Pipelines,
  type ProjectPipeline,
} from "@/lib/pipelines";
import {
  createProject,
  normalizeProject,
  type ProjectNote,
  type ProjectRecord,
  type ProjectStageChange,
} from "@/lib/stores/projects";
import * as Repairs from "@/lib/stores/repair-jobs";
import * as Quotes from "@/lib/stores/quotes";
import { parseTsv, planHistory, type ProjectPlan, type QuotePlan } from "./history";
import { companyId, contactId, projectId } from "./ids";

export type PreviewRow = {
  id: string;
  kind: "project" | "repair" | "order" | "quote";
  name: string;
  company: string | null;
  candidates: string[];
  stage: string;
  done: boolean;
  value: number | null;
  already: boolean;
  flags: string[];
};

export type Preview = {
  counts: Record<string, number>;
  rows: PreviewRow[];
  needsPick: PreviewRow[];
  live: PreviewRow[];
  stats: { valueConflicts: number; unmappedOppStages: Record<string, number> };
};

const IMPORT_ACTOR = "Daylite import";
const QUOTE_NOTE = "Imported from Daylite";

/* ---------------------------------------------------------------------------
 * Context — everything loaded ONCE per preview/commit
 * ------------------------------------------------------------------------- */

type CompanyInfo = { id: string; name: string; type: string };

type Ctx = {
  plan: ReturnType<typeof planHistory>;
  pipes: Pipelines;
  companies: Map<string, CompanyInfo>;
  contacts: Map<string, ContactRow>;
  usersByLc: Map<string, string>;
  /** Ids present in each collection, soft-deleted included. */
  taken: { projects: Set<string>; repairs: Set<string>; quotes: Set<string> };
  /** Live (not deleted) project ids — link targets for won quotes. */
  liveProjects: Set<string>;
  /** Project/order plan ids in this upload — link targets for won quotes. */
  plannedProjects: Set<string>;
};

async function loadContext(projectsTsv: string, oppsTsv: string): Promise<Ctx> {
  const [companyRows, contactRows, users, pipes, projAll, repAll, quoteAll] = await Promise.all([
    allCompanies(),
    allContacts(),
    allUsers(),
    loadPipelines(),
    listDocs("projects", { includeDeleted: true }),
    listDocs("repair_jobs", { includeDeleted: true }),
    listDocs("quotes", { includeDeleted: true }),
  ]);
  const companies = new Map<string, CompanyInfo>();
  for (const c of companyRows) companies.set(c.id, { id: c.id, name: c.name, type: c.type || "" });
  const contacts = new Map<string, ContactRow>();
  for (const c of contactRows) contacts.set(c.id, c);
  const usersByLc = new Map<string, string>();
  for (const u of users) {
    const n = (u.name || "").trim();
    if (n && !usersByLc.has(n.toLowerCase())) usersByLc.set(n.toLowerCase(), n);
  }
  const liveProjectIds = new Set((await listDocs("projects")).map((d) => d.id));

  const plan = planHistory({
    projects: projectsTsv ? parseTsv(projectsTsv) : [],
    opportunities: oppsTsv ? parseTsv(oppsTsv) : [],
    knownCompany: (name) => companies.has(companyId(name)),
  });

  return {
    plan,
    pipes,
    companies,
    contacts,
    usersByLc,
    taken: {
      projects: new Set(projAll.map((d) => d.id)),
      repairs: new Set(repAll.map((d) => d.id)),
      quotes: new Set(quoteAll.map((d) => d.id)),
    },
    liveProjects: liveProjectIds,
    plannedProjects: new Set(plan.projects.filter((p) => p.kind !== "repair").map((p) => p.id)),
  };
}

/* ---------------------------------------------------------------------------
 * Row resolution — shared by preview and commit so both see the same answer
 * ------------------------------------------------------------------------- */

type Resolved = {
  company: CompanyInfo | null;
  /** The company the preview pre-fills (before any pick). */
  defaultCompany: CompanyInfo | null;
  owner: string;
  legacyOwner?: string;
  contactName: string | null;
  contact: ContactRow | null;
  flags: string[];
};

/** A pick is a company id or a company name; it must name a company in the book. */
function companyFromPick(ctx: Ctx, pick: string | undefined): CompanyInfo | null {
  const p = (pick || "").trim();
  if (!p) return null;
  return ctx.companies.get(p) || ctx.companies.get(companyId(p)) || null;
}

function resolveCommon(
  ctx: Ctx,
  row: { id: string; companyCandidates: string[]; companyRaw?: string; companyUnmatched?: string[]; people: string[]; owner: string },
  picks: Record<string, string>
): Resolved {
  const flags: string[] = [];
  const cands = row.companyCandidates
    .map((n) => ctx.companies.get(companyId(n)))
    .filter((c): c is CompanyInfo => !!c);
  const defaultCompany = cands.find((c) => !PARTNER_TYPES.has(c.type.trim())) || cands[0] || null;
  let company = defaultCompany;
  if (cands.length > 1) {
    flags.push("pick company");
    const picked = companyFromPick(ctx, picks[row.id]);
    if (picked) company = picked;
  }
  if (!company) {
    flags.push("no company");
    if (row.companyRaw) flags.push(`not in book: ${row.companyRaw}`);
  }
  for (const u of row.companyUnmatched || []) flags.push(`not in book: ${u}`);

  const rawOwner = (row.owner || "").trim();
  const hit = rawOwner ? ctx.usersByLc.get(rawOwner.toLowerCase()) : undefined;
  const owner = hit || "";
  const legacyOwner = rawOwner && !hit ? rawOwner : undefined;
  if (legacyOwner) flags.push(`owner not on the team: ${legacyOwner}`);

  const person = (row.people[0] || "").trim();
  let contact: ContactRow | null = null;
  if (person) {
    const i = person.lastIndexOf(" ");
    const first = i < 0 ? person : person.slice(0, i);
    const last = i < 0 ? "" : person.slice(i + 1);
    contact = ctx.contacts.get(contactId(first, last, company?.name ?? "")) || null;
    if (!contact) flags.push(`contact not on file: ${person}`);
  }
  return { company, defaultCompany, owner, legacyOwner, contactName: person || null, contact, flags };
}

function takenFor(ctx: Ctx, p: ProjectPlan): boolean {
  return p.kind === "repair" ? ctx.taken.repairs.has(p.id) : ctx.taken.projects.has(p.id);
}

/** The project a won quote belongs to: same norm(name)+norm(company) → the same hash. */
function soldProjectId(q: QuotePlan): string {
  return projectId(q.name, q.companyCandidates[0] || q.companyRaw || "");
}

type SoldMode = "linked" | "new" | "blocked";

function soldMode(ctx: Ctx, q: QuotePlan): SoldMode {
  const target = soldProjectId(q);
  if (ctx.plannedProjects.has(target) || ctx.liveProjects.has(target)) return "linked";
  // A deleted project holds the id — creating it would resurrect that record.
  if (ctx.taken.projects.has(target)) return "blocked";
  return "new";
}

function projectPreviewRow(ctx: Ctx, p: ProjectPlan, picks: Record<string, string>): PreviewRow {
  const r = resolveCommon(ctx, p, picks);
  const already = takenFor(ctx, p);
  const flags = [...r.flags];
  if (p.value == null) flags.push("UKN value");
  if (already) flags.push("already imported");
  return {
    id: p.id,
    kind: p.kind,
    name: p.name,
    company: r.company?.name ?? null,
    candidates: p.companyCandidates,
    stage: p.stage,
    done: p.done,
    value: p.value,
    already,
    flags,
  };
}

function quotePreviewRow(ctx: Ctx, q: QuotePlan, picks: Record<string, string>): PreviewRow {
  const r = resolveCommon(ctx, q, picks);
  const already = ctx.taken.quotes.has(q.id);
  const flags = [...r.flags];
  if (q.status === "won") {
    const mode = soldMode(ctx, q);
    const target = soldProjectId(q);
    if (mode === "linked") flags.push(`sold → links ${target}`);
    else if (mode === "new") flags.push(`sold → new project at ${q.projectStage}`);
    else flags.push(`sold → project ${target} was deleted; not imported`);
  }
  if (already) flags.push("already imported");
  return {
    id: q.id,
    kind: "quote",
    name: q.name,
    company: r.company?.name ?? null,
    candidates: q.companyCandidates,
    stage: q.stage,
    done: false,
    value: q.value,
    already,
    flags,
  };
}

/* ---------------------------------------------------------------------------
 * Preview
 * ------------------------------------------------------------------------- */

export async function previewHistory(projectsTsv: string, oppsTsv: string): Promise<Preview> {
  const ctx = await loadContext(projectsTsv, oppsTsv);
  const { plan } = ctx;
  const counts: Record<string, number> = {
    doneInstalls: 0,
    liveInstalls: 0,
    doneService: 0,
    liveService: 0,
    orders: 0,
    openQuotes: plan.quotes.length,
    soldLinked: 0,
    soldNewProject: 0,
    valued: 0,
    ukn: 0,
    noCompany: 0,
    needsPick: 0,
    alreadyImported: 0,
    legacyOwners: 0,
  };
  const rows: PreviewRow[] = [];

  for (const p of plan.projects) {
    if (p.kind === "order") counts.orders++;
    else if (p.kind === "repair") counts[p.done ? "doneService" : "liveService"]++;
    else counts[p.done ? "doneInstalls" : "liveInstalls"]++;
    counts[p.value == null ? "ukn" : "valued"]++;
    rows.push(projectPreviewRow(ctx, p, {}));
  }
  for (const q of plan.quotes) {
    if (q.status === "won") {
      const mode = soldMode(ctx, q);
      if (mode === "linked") counts.soldLinked++;
      else if (mode === "new") counts.soldNewProject++;
    }
    rows.push(quotePreviewRow(ctx, q, {}));
  }
  for (const r of rows) {
    if (!r.company) counts.noCompany++;
    if (r.candidates.length > 1) counts.needsPick++;
    if (r.already) counts.alreadyImported++;
    if (r.flags.some((f) => f.startsWith("owner not on the team"))) counts.legacyOwners++;
  }
  for (const [k, n] of Object.entries(plan.skipped.projects)) counts[`skippedProjects_${k}`] = n;
  for (const [k, n] of Object.entries(plan.skipped.opportunities)) counts[`skippedOpps_${k}`] = n;

  return {
    counts,
    rows,
    needsPick: rows.filter((r) => r.candidates.length > 1),
    live: rows.filter((r) => r.kind !== "quote" && !r.done),
    stats: plan.stats,
  };
}

/* ---------------------------------------------------------------------------
 * Commit
 * ------------------------------------------------------------------------- */

function doneStageOf(pl: ProjectPipeline): string {
  return (pl.stages.find((s) => s.tag === "done") || pl.stages[pl.stages.length - 1]).id;
}

function contactNote(r: Resolved, by: string, at: number): ProjectNote[] {
  if (!r.contactName) return [];
  return [{ id: "nt-" + Math.random().toString(36).slice(2, 8), by, at, text: `Contact (Daylite): ${r.contactName}`, photo: null }];
}

async function writeProject(ctx: Ctx, p: ProjectPlan, r: Resolved, by: string, importedAt: number): Promise<void> {
  const kind = p.kind === "order" ? "order" : "project";
  const pl = projectPipelineFor(ctx.pipes, { kind });
  const first = firstStage(pl).id;
  const startedAt = p.startedAt ?? p.endedAt ?? importedAt;
  let stage: string;
  let history: ProjectStageChange[];
  let closedAt: number | null = null;
  if (p.done) {
    stage = doneStageOf(pl);
    closedAt = p.endedAt ?? startedAt;
    history = [
      { at: startedAt, from: null, to: first, by: IMPORT_ACTOR },
      { at: closedAt, from: first, to: stage, by: IMPORT_ACTOR },
    ];
  } else {
    stage = resolveProjectStage(pl, kind, p.stage);
    history = [{ at: startedAt, from: null, to: stage, by: IMPORT_ACTOR }];
  }
  await createProject({
    id: p.id,
    kind,
    pipelineId: pl.id,
    name: p.name,
    customer: r.company?.name ?? p.companyRaw ?? "",
    customerId: r.company?.id ?? null,
    owner: r.owner,
    ...(r.legacyOwner ? { legacyOwner: r.legacyOwner } : {}),
    value: p.value ?? 0,
    valueUnknown: p.value == null,
    stage,
    startedAt,
    targetDate: p.dueAt ?? p.endedAt ?? null,
    source: { system: "daylite", importedAt },
    stageHistory: history,
    notes: contactNote(r, by, importedAt),
  });
  // The Projects list's "Closed <date>" chip reads updatedAt (board-lib
  // dueChipLabel ← fmtDate(p.updatedAt)); createProject stamps now, so a done
  // record is re-dated to its End Date with a direct patch (updateProject
  // would bump it back to now).
  if (closedAt != null) {
    const at = closedAt;
    await patchDoc<ProjectRecord>("projects", p.id, (doc) => {
      doc.updatedAt = at;
      return doc;
    });
  }
}

async function writeRepair(p: ProjectPlan, r: Resolved, importedAt: number): Promise<void> {
  const stage = p.stage as Repairs.RepairStageKey;
  const completedAt = stage === "completed" ? p.endedAt ?? p.startedAt ?? null : null;
  await Repairs.create({
    id: p.id,
    title: p.name,
    customer: r.company?.name ?? p.companyRaw ?? "",
    customerId: r.company?.id ?? null,
    value: p.value ?? 0,
    valueUnknown: p.value == null,
    stage,
    approvedAt: p.startedAt ?? p.endedAt ?? importedAt,
    completedAt,
    owner: r.owner,
    ...(r.legacyOwner ? { legacyOwner: r.legacyOwner } : {}),
    contact: r.contactName ? { name: r.contactName, ...(r.contact?.title ? { role: r.contact.title } : {}) } : null,
    source: { kind: "direct", label: "Daylite import" },
  });
  // Historical repairs sort by their completion, not by import day.
  if (p.done && completedAt != null) {
    await patchDoc<Repairs.RepairJobRecord>("repair_jobs", p.id, (doc) => {
      doc.updatedAt = completedAt;
      return doc;
    });
  }
}

/**
 * A won quote's project: link the matching project (moving it forward to the
 * mapped stage when that is later and it isn't done — a direct patch with a
 * history entry, never setProjectStage), or create it with `quoteId` set.
 */
async function linkOrCreateSoldProject(
  ctx: Ctx,
  q: QuotePlan,
  r: Resolved,
  by: string,
  importedAt: number
): Promise<"linked" | "new"> {
  const targetId = soldProjectId(q);
  const existing = await getDoc<ProjectRecord>("projects", targetId);
  if (existing) {
    if (existing.quoteId && existing.quoteId !== q.id)
      throw new Error(`project ${targetId} is already linked to quote ${existing.quoteId}`);
    await patchDoc<ProjectRecord>("projects", targetId, (doc) => {
      normalizeProject(doc, ctx.pipes);
      doc.quoteId = q.id;
      if (!doc.projectType) doc.projectType = "system";
      const pl = projectPipelineFor(ctx.pipes, doc);
      const want = q.projectStage ? stageById(pl, q.projectStage) : null;
      const cur = pl.stages.findIndex((s) => s.id === doc.stage);
      const next = want ? pl.stages.findIndex((s) => s.id === want.id) : -1;
      if (want && pl.stages[cur]?.tag !== "done" && next > cur) {
        doc.stageHistory.push({ at: importedAt, from: doc.stage, to: want.id, by: IMPORT_ACTOR });
        doc.stage = want.id;
        normalizeProject(doc, ctx.pipes);
      }
      if (doc.valueUnknown && q.value && q.value > 0) {
        doc.value = q.value;
        doc.valueUnknown = false;
      }
      return doc;
    });
    return "linked";
  }
  if (ctx.taken.projects.has(targetId)) throw new Error(`project ${targetId} was deleted — not re-created`);
  const pl = projectPipelineFor(ctx.pipes, { kind: "project" });
  const stage = resolveProjectStage(pl, "project", q.projectStage || firstStage(pl).id);
  const known = !!q.value && q.value > 0;
  await createProject({
    id: targetId,
    kind: "project",
    pipelineId: pl.id,
    quoteId: q.id,
    projectType: "system",
    name: q.name,
    customer: r.company?.name ?? q.companyRaw ?? "",
    customerId: r.company?.id ?? null,
    owner: r.owner,
    ...(r.legacyOwner ? { legacyOwner: r.legacyOwner } : {}),
    value: known ? (q.value as number) : 0,
    valueUnknown: !known,
    stage,
    startedAt: importedAt,
    targetDate: null,
    source: { system: "daylite", importedAt },
    stageHistory: [{ at: importedAt, from: null, to: stage, by: IMPORT_ACTOR }],
    notes: contactNote(r, by, importedAt),
  });
  ctx.taken.projects.add(targetId);
  return "new";
}

async function writeQuote(q: QuotePlan, r: Resolved, importedAt: number): Promise<void> {
  await Quotes.create({
    id: q.id,
    name: q.name,
    customer: r.company?.name ?? q.companyRaw ?? "",
    customerId: r.company?.id ?? null,
    contactName: r.contactName ?? "",
    value: q.value ?? 0,
    owner: r.owner,
    quoteType: "system",
    pipelineId: q.pipelineId,
    source: "daylite",
    quoteNote: QUOTE_NOTE,
  });
  // create() always opens a draft on the pipeline's first stage and defaults
  // an empty owner to Jeff; a plain update sets the imported state — never
  // setStatus, which would mint the "Install sold" assignment and spawn.
  await Quotes.update(q.id, {
    status: q.status,
    pipelineId: q.pipelineId,
    stage: q.stage,
    owner: r.owner,
    ...(r.legacyOwner ? { legacyOwner: r.legacyOwner } : {}),
    history: [{ at: importedAt, to: q.status }],
  });
}

export async function commitHistory(
  projectsTsv: string,
  oppsTsv: string,
  picks: Record<string, string>,
  by: string
): Promise<{ created: Record<string, number>; skippedExisting: number; errors: string[] }> {
  const ctx = await loadContext(projectsTsv, oppsTsv);
  const importedAt = Date.now();
  const created: Record<string, number> = {
    projects: 0,
    orders: 0,
    repairs: 0,
    quotes: 0,
    soldLinked: 0,
    soldNewProject: 0,
  };
  let skippedExisting = 0;
  const errors: string[] = [];
  const fail = (id: string, name: string, e: unknown) =>
    errors.push(`${id} ${name}: ${e instanceof Error ? e.message : String(e)}`);

  // Projects/repairs/orders first, so a won quote below can link a project
  // written in this same run.
  for (const p of ctx.plan.projects) {
    if (takenFor(ctx, p)) {
      skippedExisting++;
      continue;
    }
    try {
      const r = resolveCommon(ctx, p, picks);
      if (p.kind === "repair") {
        await writeRepair(p, r, importedAt);
        ctx.taken.repairs.add(p.id);
        created.repairs++;
      } else {
        await writeProject(ctx, p, r, by, importedAt);
        ctx.taken.projects.add(p.id);
        created[p.kind === "order" ? "orders" : "projects"]++;
      }
    } catch (e) {
      fail(p.id, p.name, e);
    }
  }

  for (const q of ctx.plan.quotes) {
    if (ctx.taken.quotes.has(q.id)) {
      skippedExisting++;
      continue;
    }
    try {
      const r = resolveCommon(ctx, q, picks);
      // The project goes first: if the quote write then fails, a re-run finds
      // the project already carrying this quoteId and just writes the quote —
      // whereas a won quote landing first with no project would be picked up
      // by syncProjectsFromQuotes (kickoff task and all).
      if (q.status === "won") {
        const mode = await linkOrCreateSoldProject(ctx, q, r, by, importedAt);
        created[mode === "linked" ? "soldLinked" : "soldNewProject"]++;
      }
      await writeQuote(q, r, importedAt);
      ctx.taken.quotes.add(q.id);
      created.quotes++;
    } catch (e) {
      fail(q.id, q.name, e);
    }
  }

  return { created, skippedExisting, errors };
}
