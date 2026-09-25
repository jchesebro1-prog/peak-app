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
 *   are built with the store's builder and written directly.
 * - never calls Quotes.setStatus — that mints the "Install sold" assignment
 *   and runs quote-spawn. Imported quotes are built with create()'s builder
 *   and written once; a won one is linked to (or creates) its project here, with
 *   `quoteId` set, so the page-load sweep syncProjectsFromQuotes sees the
 *   quote as already converted and never makes a second project.
 * - repairs are built with repair-jobs' own builder and dayliteImportSource();
 *   isImportedHistory() keeps the done-in-Daylite ones out of the warranty
 *   follow-up worklist, and nothing turns a warranty state into a task.
 * - every record is written ONCE (the store's builder + one upsert), so a
 *   failure can never leave a half-written record a re-run would then skip.
 *
 * Idempotence: every id is deterministic (./ids). A planned id that already
 * exists — soft-deleted included, so a record Jeff deleted is not resurrected
 * by the upsert — is skipped and counted.
 *
 * Superseding the July import (Task 12b, spec §4.6): scripts/import-daylite.ts
 * already wrote cruder `P-dl-*` projects and `L-dl-*` leads. A July record
 * NOBODY has touched (./july-cleanup isJulyRecord + isUntouched) is replaced
 * per row — overwritten in place when the new id is the July id, otherwise
 * soft-deleted once the new record exists (service calls move to Repairs;
 * cancelled/abandoned/deferred/duplicate rows just retire theirs). An edited
 * July record is left exactly as it is and the row writes nothing. Every
 * decision reads only the plan and the current state of that row's own ids,
 * so a chunk re-run is safe. `finalizeHistory` then retires the July leads
 * and the combined-name company stubs once, after the last chunk.
 *
 * Design spec: docs/superpowers/specs/2026-09-24-daylite-pipelines-and-history-import-design.md §4.
 */

import { getDoc, listDocs, patchDoc, upsertDoc } from "@/db/doc-store";
import type { CollectionName } from "@/db/doc-tables";
import type { ContactRow } from "@/db/schema";
import { allCompanies } from "@/lib/identity/companies";
import { allContacts } from "@/lib/identity/contacts";
import { PARTNER_TYPES } from "@/lib/identity/venue-defaults";
import { activeUsers } from "@/lib/users";
import { loadPipelines } from "@/lib/pipelines-server";
import {
  firstStage,
  projectPipelineFor,
  quotePipelineFor,
  resolveProjectStage,
  stageById,
  type Pipelines,
  type ProjectPipeline,
} from "@/lib/pipelines";
import {
  buildProject,
  normalizeProject,
  type ProjectNote,
  type ProjectRecord,
  type ProjectStageChange,
} from "@/lib/stores/projects";
import * as Repairs from "@/lib/stores/repair-jobs";
import * as Quotes from "@/lib/stores/quotes";
import { parseTsv, planHistory, staleLiveCompletedRepairs, type JulyRetire, type ProjectPlan, type QuotePlan } from "./history";
import { companyId, contactId, projectId } from "./ids";
import {
  countLiveJulyProjects,
  isJulyRecord,
  isUntouched,
  julyLeadPlan,
  julyReferences,
  retireJunkCompanies,
  retireUntouchedJuly,
  scanJunkCompanies,
  type JunkKept,
} from "./july-cleanup";

export type PreviewRow = {
  id: string;
  kind: "project" | "repair" | "order" | "quote";
  name: string;
  company: string | null;
  candidates: string[];
  /** The Companies cell verbatim (#190) — shown next to the needs-a-pick
   *  picker so Jeff sees what Daylite actually held, not just the names
   *  matched out of it. */
  companiesRaw: string;
  stage: string;
  done: boolean;
  value: number | null;
  already: boolean;
  flags: string[];
};

/** A July record the import leaves alone — edited in Quartzite, or still used by another record. */
export type JulyEditedRow = { id: string; name: string; reason: string };

export type Preview = {
  counts: Record<string, number>;
  rows: PreviewRow[];
  needsPick: PreviewRow[];
  live: PreviewRow[];
  /** Task 12b — "Edited in Quartzite — left as is" (each with its reason). */
  julyEdited: JulyEditedRow[];
  stats: { valueConflicts: number; unmappedOppStages: Record<string, number> };
};

const IMPORT_ACTOR = "Daylite import";

/* ---------------------------------------------------------------------------
 * Context — everything loaded ONCE per preview/commit
 * ------------------------------------------------------------------------- */

type CompanyInfo = { id: string; name: string; type: string };

/** `quoteId`: set when a won quote already links this July record. */
type JulyInfo = { untouched: boolean; name: string; quoteId: string | null };

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
  /** Live July-script projects (P-dl-*, no daylite source marker), by id. */
  july: Map<string, JulyInfo>;
  /** Won quotes' project ids — the project phase never retires a July record
   *  there; the quote phase replaces it with the sold project instead. */
  soldTargets: Set<string>;
  /** Project/order plan rows by id. */
  planById: Map<string, ProjectPlan>;
  /** July ids a skipped Projects row retires (plan.julyRetire). */
  retireIds: Set<string>;
  /** Untouched July records another live record still points at → kept, with the reason. */
  julyRefs: Map<string, string>;
  /** The first work item that owns each July id — the one that counts it as kept. */
  firstOwner: Map<string, number>;
  /** The work-list slice this call processes — floored and clamped ONCE, so
   *  the reference scan and the commit slice always cover the same items. */
  range: { start: number; end: number };
};

/** Floor + clamp a requested range to [0, total]; no range = the whole list. */
function normRange(range: { start: number; end: number } | undefined, total: number): { start: number; end: number } {
  if (!range) return { start: 0, end: total };
  const start = Math.min(total, Math.max(0, Math.floor(Number(range.start)) || 0));
  const end = Math.min(total, Math.max(start, Math.floor(Number(range.end)) || 0));
  return { start, end };
}

/**
 * `range` limits the July reference scan to the retire candidates of that
 * slice of the work list (a commit chunk); the preview scans them all.
 */
async function loadContext(projectsTsv: string, oppsTsv: string, range?: { start: number; end: number }): Promise<Ctx> {
  const [companyRows, contactRows, users, pipes, projAll, repAll, quoteAll] = await Promise.all([
    allCompanies(),
    allContacts(),
    activeUsers(),
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
  const liveProjectDocs = await listDocs("projects");
  const liveProjectIds = new Set(liveProjectDocs.map((d) => d.id));
  const july = new Map<string, JulyInfo>();
  for (const d of liveProjectDocs)
    if (isJulyRecord("P-dl-", d))
      july.set(d.id, { untouched: isUntouched(d), name: String(d.name ?? ""), quoteId: typeof d.quoteId === "string" && d.quoteId ? d.quoteId : null });

  const plan = planHistory({
    projects: projectsTsv ? parseTsv(projectsTsv) : [],
    opportunities: oppsTsv ? parseTsv(oppsTsv) : [],
    knownCompany: (name) => companies.has(companyId(name)),
  });

  const ctx: Ctx = {
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
    july,
    soldTargets: new Set(plan.quotes.filter((q) => q.status === "won").map(soldProjectId)),
    planById: new Map(plan.projects.filter((p) => p.kind !== "repair").map((p) => [p.id, p])),
    retireIds: new Set(plan.julyRetire.map((r) => r.julyId)),
    julyRefs: new Map(),
    firstOwner: new Map(),
    range: normRange(range, plan.projects.length + plan.julyRetire.length + plan.quotes.length),
  };

  // Which work item owns each July id first (projects, then retire rows).
  const own = (i: number, id: string) => {
    if (!ctx.firstOwner.has(id)) ctx.firstOwner.set(id, i);
  };
  plan.projects.forEach((p, i) => ownedJulyIds(ctx, p).forEach((id) => own(i, id)));
  plan.julyRetire.forEach((r, j) => own(plan.projects.length + j, r.julyId));

  // The untouched July records this run (or chunk) could retire: what else
  // still points at them? One batched scan (./july-cleanup julyReferences).
  const { start: lo, end: hi } = ctx.range;
  const candidates = new Set<string>();
  plan.projects.forEach((p, i) => {
    if (i < lo || i >= hi) return;
    for (const id of ownedJulyIds(ctx, p)) if (retiresId(ctx, p, id)) candidates.add(id);
  });
  plan.julyRetire.forEach((r, j) => {
    const i = plan.projects.length + j;
    if (i >= lo && i < hi && !ctx.soldTargets.has(r.julyId)) candidates.add(r.julyId);
  });
  ctx.julyRefs = await julyReferences([...candidates].filter((id) => ctx.july.get(id)?.untouched));
  return ctx;
}

/** A private copy of the mutable state, for the preview's dry run. */
function cloneCtx(ctx: Ctx): Ctx {
  return {
    ...ctx,
    taken: { projects: new Set(ctx.taken.projects), repairs: new Set(ctx.taken.repairs), quotes: new Set(ctx.taken.quotes) },
    liveProjects: new Set(ctx.liveProjects),
    july: new Map(ctx.july),
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

type SoldMode = "linked" | "new" | "replacesJuly" | "blocked";

/* ---------------------------------------------------------------------------
 * July supersede decisions (Task 12b) — one function each, used by the
 * preview's dry run (on a cloned state) and by commit (on the live state), so
 * both give the same answer. Each reads only the plan and the state of the
 * row's own ids.
 * ------------------------------------------------------------------------- */

type JulyState = "none" | "untouched" | "edited";

function julyStateOf(ctx: Ctx, id: string): JulyState {
  const j = ctx.july.get(id);
  return j ? (j.untouched ? "untouched" : "edited") : "none";
}

/**
 * The July ids a Projects row answers for. A service call's July record is the
 * project the July script made for it (its own RP-dl- id never is). An id that
 * ANOTHER install/order row has as its own id belongs to that row — it
 * overwrites the record in place — so this row neither retires nor keeps it
 * (e.g. a Service Call and an Install with the same name and company, which
 * the July script collapsed into one project).
 */
function ownedJulyIds(ctx: Ctx, p: ProjectPlan): string[] {
  if (p.kind === "repair") return ctx.planById.has(p.julyId) ? [] : [p.julyId];
  if (p.julyId !== p.id && ctx.planById.has(p.julyId)) return [p.id];
  return [...new Set([p.id, p.julyId])];
}

/** Would this row soft-delete `id` (rather than overwrite it, or leave it to a won quote)? */
function retiresId(ctx: Ctx, p: ProjectPlan, id: string): boolean {
  return (p.kind === "repair" || id !== p.id) && !ctx.soldTargets.has(id);
}

/** Why a July record must stay as it is, or null. Overwriting in place keeps references valid. */
function keptReason(ctx: Ctx, id: string, retiring: boolean): string | null {
  const st = julyStateOf(ctx, id);
  if (st === "edited") return "edited in Quartzite";
  if (st !== "untouched" || !retiring) return null;
  const q = ctx.july.get(id)?.quoteId;
  if (q) return `linked to quote ${q}`;
  return ctx.julyRefs.get(id) ?? null;
}

type RowDecision = {
  /** July records this row owns that must stay (edited, or still referenced) — the row writes and retires nothing. */
  kept: Array<{ id: string; reason: string }>;
  /** Write the new record at the plan id (create, or overwrite an untouched July record). */
  write: boolean;
  /** The plan id holds an untouched July record the write replaces in place. */
  overwritesJuly: boolean;
  /** Untouched July records to soft-delete after the write. */
  retire: string[];
};

function decideProjectRow(ctx: Ctx, p: ProjectPlan): RowDecision {
  const own = ownedJulyIds(ctx, p);
  const kept = own
    .map((id) => ({ id, reason: keptReason(ctx, id, retiresId(ctx, p, id)) }))
    .filter((k): k is { id: string; reason: string } => k.reason !== null);
  if (kept.length) return { kept, write: false, overwritesJuly: false, retire: [] };
  const overwritesJuly = p.kind !== "repair" && julyStateOf(ctx, p.id) === "untouched";
  const write = overwritesJuly || !takenFor(ctx, p);
  const retire = own.filter((id) => retiresId(ctx, p, id) && julyStateOf(ctx, id) === "untouched");
  return { kept: [], write, overwritesJuly, retire };
}

/** State after a row's write / retirements (commit and the dry run alike). */
function noteWritten(ctx: Ctx, p: ProjectPlan): void {
  if (p.kind === "repair") {
    ctx.taken.repairs.add(p.id);
    return;
  }
  ctx.taken.projects.add(p.id);
  ctx.liveProjects.add(p.id);
  ctx.july.delete(p.id);
}
function noteRetired(ctx: Ctx, id: string): void {
  ctx.july.delete(id);
  ctx.liveProjects.delete(id);
}

function decideRetireRow(ctx: Ctx, r: JulyRetire): { kind: "retire" } | { kind: "kept"; reason: string } | { kind: "none" } {
  if (ctx.soldTargets.has(r.julyId)) return { kind: "none" }; // a won quote replaces it
  const reason = keptReason(ctx, r.julyId, true);
  if (reason) return { kind: "kept", reason };
  return julyStateOf(ctx, r.julyId) === "untouched" ? { kind: "retire" } : { kind: "none" };
}

/**
 * The project a won quote belongs to. Normally soldProjectId(q); but when the
 * Projects row for that job was kept as an EDITED July record under its raw-
 * cell id (so the row wrote nothing at its new id), the quote links that
 * record instead of creating a second project for the same job.
 */
function soldTargetOf(ctx: Ctx, q: QuotePlan): string {
  const target = soldProjectId(q);
  const row = ctx.planById.get(target);
  if (row && row.julyId !== target && !ctx.taken.projects.has(target) && julyStateOf(ctx, row.julyId) === "edited") return row.julyId;
  return target;
}

function soldMode(ctx: Ctx, q: QuotePlan): SoldMode {
  const target = soldTargetOf(ctx, q);
  // A soft-deleted project holds the id — checked FIRST, so a planned row that
  // commit will skip as already imported can't read as a link target here
  // (commit refuses it the same way: re-creating would resurrect that record).
  if (ctx.taken.projects.has(target) && !ctx.liveProjects.has(target)) return "blocked";
  // Only a July record this upload itself would retire (its Projects row is
  // Cancelled/Abandoned/Deferred/duplicate) is replaced by the sold project.
  // Anything else — an Opportunities-only import, a July job missing from the
  // Projects export — links as Task 11 did, so a finished job stays finished.
  if (julyStateOf(ctx, target) === "untouched" && ctx.retireIds.has(target)) return "replacesJuly";
  if (ctx.liveProjects.has(target)) return "linked";
  return "new";
}

function projectPreviewRow(ctx: Ctx, p: ProjectPlan, picks: Record<string, string>): PreviewRow {
  const r = resolveCommon(ctx, p, picks);
  const d = decideProjectRow(ctx, p);
  const already = !d.kept.length && !d.write;
  const flags = [...r.flags];
  if (p.value == null) flags.push("UKN value");
  for (const k of d.kept) flags.push(`July record kept — ${k.reason}`);
  if (!d.kept.length && (d.overwritesJuly || d.retire.length)) flags.push("replaces July import");
  if (already) flags.push("already imported");
  return {
    id: p.id,
    kind: p.kind,
    name: p.name,
    company: r.company?.name ?? null,
    candidates: p.companyCandidates,
    companiesRaw: p.companiesCellRaw,
    stage: p.stage,
    done: p.done,
    value: p.value,
    already,
    flags,
  };
}

function quotePreviewRow(
  ctx: Ctx,
  q: QuotePlan,
  picks: Record<string, string>,
  sold: Map<string, { mode: SoldMode; target: string }>
): PreviewRow {
  const r = resolveCommon(ctx, q, picks);
  const already = ctx.taken.quotes.has(q.id);
  const flags = [...r.flags];
  const s = sold.get(q.id);
  if (q.status === "won" && s) {
    const { mode, target } = s;
    if (mode === "linked" && julyStateOf(ctx, target) === "edited") flags.push("Edited July record — linked to its sold quote");
    else if (mode === "linked") flags.push(`sold → links ${target}`);
    else if (mode === "new") flags.push(`sold → new project at ${q.projectStage}`);
    else if (mode === "replacesJuly") flags.push(`sold → new project at ${q.projectStage}, replacing July record ${target}`);
    else flags.push(`sold → project ${target} was deleted; not imported`);
  }
  if (already) flags.push("already imported");
  return {
    id: q.id,
    kind: "quote",
    name: q.name,
    company: r.company?.name ?? null,
    candidates: q.companyCandidates,
    companiesRaw: q.companiesCellRaw,
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

/**
 * The July-supersede dry run: walk the same work list commit walks (projects
 * → July retire rows → quotes) on a private copy of the state, with the same
 * decision functions, and count what commit will do.
 */
function dryRunJuly(ctx: Ctx): {
  counts: Record<string, number>;
  keptIds: number;
  edited: JulyEditedRow[];
  sold: Map<string, { mode: SoldMode; target: string }>;
  superseded: Set<string>;
} {
  const sim = cloneCtx(ctx);
  const counts = { julyReplaced: 0, julyMovedToRepairs: 0, julyRetiredSkipped: 0 };
  const linked: JulyEditedRow[] = [];
  const edited = new Map<string, JulyEditedRow>();
  const superseded = new Set<string>();
  const sold = new Map<string, { mode: SoldMode; target: string }>();
  const keep = (id: string, reason: string) => {
    if (!edited.has(id)) edited.set(id, { id, name: ctx.july.get(id)?.name ?? id, reason });
  };

  for (const p of ctx.plan.projects) {
    const d = decideProjectRow(sim, p);
    if (d.kept.length) {
      d.kept.forEach((k) => keep(k.id, k.reason));
      continue;
    }
    if (d.overwritesJuly) {
      counts.julyReplaced++;
      superseded.add(p.id);
    }
    if (d.write) noteWritten(sim, p);
    for (const id of d.retire) {
      counts[p.kind === "repair" ? "julyMovedToRepairs" : "julyReplaced"]++;
      superseded.add(id);
      noteRetired(sim, id);
    }
  }
  for (const r of ctx.plan.julyRetire) {
    const d = decideRetireRow(sim, r);
    if (d.kind === "kept") keep(r.julyId, d.reason);
    else if (d.kind === "retire") {
      counts.julyRetiredSkipped++;
      superseded.add(r.julyId);
      noteRetired(sim, r.julyId);
    }
  }
  for (const q of ctx.plan.quotes) {
    if (q.status !== "won") continue;
    const mode = soldMode(sim, q);
    const target = soldTargetOf(sim, q);
    sold.set(q.id, { mode, target });
    if (mode === "linked" && julyStateOf(sim, target) === "edited") {
      // Listed too — its only change is the quote link (quoteId).
      const e = edited.get(target);
      if (e) e.reason += "; linked to its sold quote";
      else linked.push({ id: target, name: ctx.july.get(target)?.name ?? target, reason: "Edited July record — linked to its sold quote" });
    }
    if (mode === "replacesJuly") {
      counts.julyReplaced++;
      superseded.add(target);
    }
    if (mode === "new" || mode === "replacesJuly") {
      sim.taken.projects.add(target);
      sim.liveProjects.add(target);
      sim.july.delete(target);
    }
  }
  // julyEditedKept counts the records rows keep (unique ids, as commit
  // does); a quote-linked edited record no row owns is listed after them.
  return { counts, keptIds: edited.size, edited: [...edited.values(), ...linked], sold, superseded };
}

/** Live July projects no row of this upload touches — reported, never removed. */
function julyUnmatched(ctx: Ctx): number {
  const matched = new Set<string>(ctx.soldTargets);
  for (const p of ctx.plan.projects) {
    matched.add(p.julyId);
    if (p.kind !== "repair") matched.add(p.id);
  }
  for (const r of ctx.plan.julyRetire) matched.add(r.julyId);
  let n = 0;
  for (const id of ctx.july.keys()) if (!matched.has(id)) n++;
  return n;
}

export async function previewHistory(projectsTsv: string, oppsTsv: string): Promise<Preview> {
  const ctx = await loadContext(projectsTsv, oppsTsv);
  const { plan } = ctx;
  const july = dryRunJuly(ctx);
  const oppsIncluded = !!oppsTsv.trim();
  const leads = oppsIncluded ? await julyLeadPlan() : { retire: [], edited: [], referenced: [] };
  // The combined-name estimate: references from July records this import
  // replaces or retires don't count (they will be gone by finalize).
  const exclude: Partial<Record<CollectionName, ReadonlySet<string>>> = {
    projects: july.superseded,
    leads: new Set(leads.retire),
  };
  const junk = await scanJunkCompanies(exclude);

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
    staleLiveCompletedRepairs: staleLiveCompletedRepairs(plan.projects, Date.now()),
    workItems: plan.projects.length + plan.julyRetire.length + plan.quotes.length,
    ...july.counts,
    julyEditedKept: july.keptIds,
    julyUnmatchedKept: julyUnmatched(ctx),
    julyLeadsToRetire: leads.retire.length,
    julyLeadsEditedKept: leads.edited.length + leads.referenced.length,
    junkCompaniesToRetire: junk.retire.length,
    junkCompaniesKept: junk.kept.length,
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
    const s = july.sold.get(q.id);
    if (s?.mode === "linked") counts.soldLinked++;
    else if (s?.mode === "new" || s?.mode === "replacesJuly") counts.soldNewProject++;
    rows.push(quotePreviewRow(ctx, q, {}, july.sold));
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
    julyEdited: july.edited,
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
  const rec = buildProject(p.id, {
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
    // The End Date fallback is for done rows only — a live job with no Due
    // Date has no target (never "42 days from now").
    targetDate: p.done ? p.dueAt ?? p.endedAt ?? null : p.dueAt ?? null,
    source: { system: "daylite", importedAt },
    stageHistory: history,
    notes: contactNote(r, by, importedAt),
    // Overwriting a July record a won quote already links: the link survives
    // (else syncProjectsFromQuotes would spawn a second project for that quote).
    ...(ctx.july.get(p.id)?.quoteId ? { quoteId: ctx.july.get(p.id)!.quoteId, projectType: "system" as const } : {}),
  }, ctx.pipes, importedAt);
  // The Projects list's "Closed <date>" chip reads updatedAt (board-lib
  // dueChipLabel ← fmtDate(p.updatedAt)), so a done record carries its End
  // Date there. Built with the store's own builder and written ONCE — a
  // create-then-patch could leave a half-written record a re-run would skip.
  if (closedAt != null) rec.updatedAt = closedAt;
  await upsertDoc<ProjectRecord>("projects", rec);
}

async function writeRepair(p: ProjectPlan, r: Resolved, importedAt: number): Promise<void> {
  const stage = p.stage as Repairs.RepairStageKey;
  const completedAt = stage === "completed" ? p.endedAt ?? p.startedAt ?? null : null;
  const rec = Repairs.buildRepairJob(p.id, {
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
    source: Repairs.dayliteImportSource(p.done),
  }, importedAt);
  // Historical repairs sort by their completion, not by import day. One write.
  if (p.done && completedAt != null) rec.updatedAt = completedAt;
  await upsertDoc<Repairs.RepairJobRecord>("repair_jobs", rec);
}

/**
 * A won quote's project: link the matching project (moving it forward to the
 * mapped stage when that is later and it isn't done — a direct patch with a
 * history entry, never setProjectStage), or create it with `quoteId` set. An
 * untouched July record at that id is replaced by the created project (one
 * upsert over it) — never linked, which would keep the July record's crude data.
 */
async function linkOrCreateSoldProject(
  ctx: Ctx,
  q: QuotePlan,
  r: Resolved,
  by: string,
  importedAt: number
): Promise<"linked" | "new" | "replacesJuly"> {
  const mode = soldMode(ctx, q);
  const targetId = soldTargetOf(ctx, q);
  if (mode === "blocked") throw new Error(`project ${targetId} was deleted — not re-created`);
  const existing = mode === "linked" ? await getDoc<ProjectRecord>("projects", targetId) : null;
  if (mode === "linked" && !existing) throw new Error(`project ${targetId} was deleted — not re-created`);
  if (existing) {
    if (existing.quoteId && existing.quoteId !== q.id)
      throw new Error(`project ${targetId} is already linked to quote ${existing.quoteId}`);
    if (julyStateOf(ctx, targetId) === "edited") {
      // An edited July record: the link is ALL this import changes on it — no
      // normalize, no stage move, no value fill (controller decision, 12b fix).
      await patchDoc<ProjectRecord>("projects", targetId, (doc) => {
        doc.quoteId = q.id;
        return doc;
      });
      return "linked";
    }
    await patchDoc<ProjectRecord>("projects", targetId, (doc) => {
      normalizeProject(doc, ctx.pipes);
      doc.quoteId = q.id;
      // An untouched July record stays a July record (no marker): a later
      // Projects import still replaces it with full data, and the link rides
      // on writeProject's quoteId carry-forward; a July record with a quoteId
      // is never retired (keptReason + the SQL guard). 12b fix 3.
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
    const j = ctx.july.get(targetId);
    if (j) j.quoteId = q.id;
    return "linked";
  }
  const pl = projectPipelineFor(ctx.pipes, { kind: "project" });
  const stage = resolveProjectStage(pl, "project", q.projectStage || firstStage(pl).id);
  const known = !!q.value && q.value > 0;
  const rec = buildProject(targetId, {
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
  }, ctx.pipes, importedAt);
  await upsertDoc<ProjectRecord>("projects", rec);
  ctx.taken.projects.add(targetId);
  ctx.liveProjects.add(targetId);
  ctx.july.delete(targetId);
  return mode;
}

/**
 * One write: the doc create() would build (same builder), overlaid with the
 * imported state, then upserted once. Never create()-then-update() — a failure
 * between the two would leave a draft owned by Jeff that re-runs skip as
 * "already imported". Never setStatus, which would mint the "Install sold"
 * assignment and spawn.
 */
async function writeQuote(ctx: Ctx, q: QuotePlan, r: Resolved, importedAt: number): Promise<void> {
  const pl = quotePipelineFor(ctx.pipes, { pipelineId: q.pipelineId });
  const doc: Quotes.Quote = {
    ...Quotes.buildQuote(
      q.id,
      {
        name: q.name,
        customer: r.company?.name ?? q.companyRaw ?? "",
        customerId: r.company?.id ?? null,
        contactName: r.contactName ?? "",
        quoteType: "system",
      },
      "system",
      pl,
      importedAt
    ),
    // Overlaid AFTER the builder so its defaults (draft, first stage, and an
    // empty owner → Jeff) can't apply. `source: "daylite"` is the import
    // marker — nothing goes in quoteNote, which prints on the customer's header.
    status: q.status,
    pipelineId: pl.id,
    stage: q.stage,
    value: Math.round(q.value ?? 0),
    owner: r.owner,
    preparedBy: r.owner,
    ...(r.legacyOwner ? { legacyOwner: r.legacyOwner } : {}),
    history: [{ at: importedAt, to: q.status }],
    source: "daylite",
  };
  await upsertDoc<Quotes.Quote>("quotes", doc);
}

export type CommitResult = {
  /**
   * Records written per kind, plus the July-supersede tallies (Task 12b):
   * julyReplaced (July projects overwritten in place or retired for a new
   * record), julyMovedToRepairs, julyRetiredSkipped, julyEditedKept.
   */
  created: Record<string, number>;
  skippedExisting: number;
  errors: string[];
  /** Length of the whole work list (projects, July retire rows, quotes), whatever the range. */
  total: number;
};

/**
 * Write the plan. `range` (Task 12) processes only that slice of the work
 * list — the plan's projects/repairs/orders in order, then the July records of
 * skipped rows to retire (Task 12b), then its quotes — so the Import hub can
 * commit in chunks that each fit a serverless function's time limit. The list
 * is rebuilt deterministically from the same inputs on every call, and it is
 * ordered projects → retire rows → quotes, so any split still writes every
 * project before the won quotes that link it, and a kept row supersedes its
 * own July record before any retire row could. Every id is deterministic, a
 * taken id is skipped and a superseded July record is no longer a July record,
 * so a failed chunk is simply retried.
 */
export async function commitHistory(
  projectsTsv: string,
  oppsTsv: string,
  picks: Record<string, string>,
  by: string,
  range?: { start: number; end: number }
): Promise<CommitResult> {
  const ctx = await loadContext(projectsTsv, oppsTsv, range);
  const { projects, julyRetire, quotes } = ctx.plan;
  const total = projects.length + julyRetire.length + quotes.length;
  const { start, end } = ctx.range;
  const slice = <T,>(list: T[], from: number): T[] => list.slice(Math.max(0, start - from), Math.max(0, end - from));
  /** Work-list index of each item in this slice (for the kept-once count). */
  const indexed = <T,>(list: T[], from: number): Array<[number, T]> =>
    slice(list, from).map((item, k) => [from + Math.max(0, start - from) + k, item]);
  const countKept = (i: number, id: string) => {
    // Counted once, by the first work item that owns the id, whatever the chunking.
    if (ctx.firstOwner.get(id) === i) created.julyEditedKept++;
  };
  const importedAt = Date.now();
  const created: Record<string, number> = {
    projects: 0,
    orders: 0,
    repairs: 0,
    quotes: 0,
    soldLinked: 0,
    soldNewProject: 0,
    julyReplaced: 0,
    julyMovedToRepairs: 0,
    julyRetiredSkipped: 0,
    julyEditedKept: 0,
    julyChangedSinceKept: 0,
  };
  let skippedExisting = 0;
  const errors: string[] = [];
  const fail = (id: string, name: string, e: unknown) =>
    errors.push(`${id} ${name}: ${e instanceof Error ? e.message : String(e)}`);

  // Projects/repairs/orders first, so a won quote below can link a project
  // written in this same run.
  for (const [i, p] of indexed(projects, 0)) {
    const d = decideProjectRow(ctx, p);
    if (d.kept.length) {
      // Someone edited the July record in Quartzite, or another record still
      // points at it: leave it, and don't add a second record for the same
      // job next to it.
      for (const k of d.kept) countKept(i, k.id);
      continue;
    }
    if (!d.write && !d.retire.length) {
      skippedExisting++;
      continue;
    }
    try {
      if (d.write) {
        const r = resolveCommon(ctx, p, picks);
        if (p.kind === "repair") {
          await writeRepair(p, r, importedAt);
          created.repairs++;
        } else {
          // Over an untouched July record this is the one upsert that
          // replaces it in place — the same single-write builder path.
          await writeProject(ctx, p, r, by, importedAt);
          created[p.kind === "order" ? "orders" : "projects"]++;
          if (d.overwritesJuly) created.julyReplaced++;
        }
        noteWritten(ctx, p);
      } else {
        skippedExisting++;
      }
      // Retire the July record only once the new one exists, so a failure
      // never leaves the job with neither; a re-run finds the new record
      // taken and the July record still untouched, and just retires it.
      for (const id of d.retire) {
        // The UPDATE re-checks live + no marker + untouched (time of check).
        if (!(await retireUntouchedJuly("projects", [id])).length) {
          created.julyChangedSinceKept++; // changed since the decision → kept
          continue;
        }
        noteRetired(ctx, id);
        created[p.kind === "repair" ? "julyMovedToRepairs" : "julyReplaced"]++;
      }
    } catch (e) {
      fail(p.id, p.name, e);
    }
  }

  // Skipped rows (Cancelled/Abandoned/Deferred/duplicate): retire their
  // untouched July record.
  for (const [i, r] of indexed(julyRetire, projects.length)) {
    const d = decideRetireRow(ctx, r);
    if (d.kind === "kept") countKept(i, r.julyId);
    if (d.kind !== "retire") continue;
    try {
      if (!(await retireUntouchedJuly("projects", [r.julyId])).length) {
        created.julyChangedSinceKept++;
        continue;
      }
      noteRetired(ctx, r.julyId);
      created.julyRetiredSkipped++;
    } catch (e) {
      fail(r.julyId, r.name, e);
    }
  }

  for (const q of slice(quotes, projects.length + julyRetire.length)) {
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
        if (mode === "replacesJuly") created.julyReplaced++;
      }
      await writeQuote(ctx, q, r, importedAt);
      ctx.taken.quotes.add(q.id);
      created.quotes++;
    } catch (e) {
      fail(q.id, q.name, e);
    }
  }

  return { created, skippedExisting, errors, total };
}

/* ---------------------------------------------------------------------------
 * Finalize (Task 12b) — once, after the last chunk
 * ------------------------------------------------------------------------- */

export type FinalizeResult = {
  julyLeadsRetired: number;
  /** Edited July leads plus those another record still points at. */
  julyLeadsEditedKept: number;
  /** The July leads kept because another record points at them, with the reason. */
  julyLeadsReferenced: Array<{ id: string; reason: string }>;
  junkCompaniesRetired: number;
  /** Combined-name stubs something still references — kept, with the reason. */
  junkCompaniesKept: JunkKept[];
  /** Live July projects left in the data (edited ones, and any no row matched). */
  julyProjectsRemaining: number;
  /** Leads/companies the scan chose to retire but whose guarded UPDATE matched
   *  nothing — changed since the check, so kept. */
  julyChangedSinceKept: number;
};

/**
 * Retire the July leads (only when the Opportunities file was part of the
 * import — they are the July version of those opportunities), then the
 * combined-name company stubs nothing references any more. Soft deletes only;
 * idempotent — a second call finds nothing left to retire. `by` is the admin
 * who ran it (soft deletes carry no actor field today; kept for the seam).
 */
export async function finalizeHistory(oppsIncluded: boolean, by: string): Promise<FinalizeResult> {
  void by;
  let julyLeadsRetired = 0;
  let julyLeadsEditedKept = 0;
  let julyLeadsReferenced: Array<{ id: string; reason: string }> = [];
  let changedSince = 0;
  if (oppsIncluded) {
    const leads = await julyLeadPlan();
    // Guarded UPDATE: a lead edited since the scan is not retired.
    julyLeadsRetired = (await retireUntouchedJuly("leads", leads.retire)).length;
    changedSince += leads.retire.length - julyLeadsRetired;
    julyLeadsEditedKept = leads.edited.length + leads.referenced.length;
    julyLeadsReferenced = leads.referenced;
  }
  // Runs last: a lead retired above no longer holds its stub company.
  const junk = await scanJunkCompanies();
  const junkRetired = await retireJunkCompanies(junk.retire);
  changedSince += junk.retire.length - junkRetired.length;
  return {
    julyLeadsRetired,
    julyLeadsEditedKept,
    julyLeadsReferenced,
    junkCompaniesRetired: junkRetired.length,
    junkCompaniesKept: junk.kept,
    julyProjectsRemaining: await countLiveJulyProjects(),
    julyChangedSinceKept: changedSince,
  };
}
