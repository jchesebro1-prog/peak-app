/**
 * Pure Daylite history classifier — Task 10.
 *
 * Turns Jeff's Daylite CRM exports (Projects.tsv + Opportunities.tsv) into an
 * import plan: buckets each Projects row (skip / install / service / order),
 * maps its stage label — across both the current and the retired Daylite
 * pipelines — onto the app's own stage ids, splits multi-company cells
 * against the known book, and derives deterministic ids so a re-run is
 * idempotent (duplicate name+company rows collapse to one plan, counted).
 *
 * No DB access. Task 11 resolves this plan against the database and writes
 * records; Task 12 builds the upload UI. Because this module is pure it is
 * exercised directly by the spec harness (scripts/test-review-and-spec.ts)
 * and by the eventual server-side dry run with the same code path.
 *
 * Design spec: docs/superpowers/specs/2026-09-24-daylite-pipelines-and-history-import-design.md
 * §4.2 (Projects file), §4.3 (Opportunities file), §4.4 (Matching).
 */

import { projectId, repairId, quoteId, leadId } from "./ids";
import { DEFAULT_QUOTE_PIPELINES, statusForQuoteStage, firstStage, type QuotePipeline } from "@/lib/pipelines";

// ---------------------------------------------------------------------------
// TSV parsing
// ---------------------------------------------------------------------------

export type TsvRow = Record<string, string>;

/**
 * RFC-4180-style parser adapted for tab as the field delimiter: a quoted
 * field may contain the delimiter, commas, and a doubled quote as an escaped
 * literal quote. Strips a leading BOM. Daylite exports a leading and a
 * trailing blank header column; those blank header cells are dropped from
 * every row instead of colliding under the key "".
 */
export function parseTsv(text: string): TsvRow[] {
  let s = text || "";
  if (s.charCodeAt(0) === 0xfeff) s = s.slice(1);

  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;

  const pushField = () => { row.push(field); field = ""; };
  const pushRow = () => { pushField(); rows.push(row); row = []; };

  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inQuotes) {
      if (c === '"') {
        if (s[i + 1] === '"') { field += '"'; i++; } else { inQuotes = false; }
      } else {
        field += c;
      }
      continue;
    }
    if (c === '"' && field === "") { inQuotes = true; continue; }
    if (c === "\t") { pushField(); continue; }
    if (c === "\r") { continue; }
    if (c === "\n") { pushRow(); continue; }
    field += c;
  }
  if (field !== "" || row.length > 0) pushRow();

  // Drop stray fully-blank lines (e.g. a trailing newline's empty row).
  const dataRows = rows.filter((r) => r.some((f) => f !== ""));
  if (dataRows.length === 0) return [];
  const header = dataRows[0];
  return dataRows.slice(1).map((r) => {
    const rec: TsvRow = {};
    header.forEach((h, idx) => {
      if (!h) return; // blank header cells ignored
      rec[h] = r[idx] ?? "";
    });
    return rec;
  });
}

// ---------------------------------------------------------------------------
// Stage label normalization
// ---------------------------------------------------------------------------

/**
 * "8 • Final Payment Received" → "final payment received". Lowercases,
 * normalizes en-dash/em-dash to a plain hyphen everywhere in the string
 * (Daylite exports the leading-number separator as either "•" or a dash,
 * and some labels carry an internal en-dash, e.g. "Complete – Satisfaction
 * Survey Sent"), then strips a leading "N", "N/M", or "N • "/"N - " prefix.
 */
export function stripStage(s: string): string {
  let t = (s || "").trim();
  t = t.replace(/[–—]/g, "-");
  t = t.toLowerCase();
  t = t.replace(/^\d+(?:\/\d+)?\s*[•-]?\s*/, "");
  t = t.replace(/\s+/g, " ").trim();
  return t;
}

// ---------------------------------------------------------------------------
// Dates / money
// ---------------------------------------------------------------------------

/** "10/21/11" → local-midnight epoch ms (2-digit years → 20xx); invalid → null. */
export function toMs(mdY: string): number | null {
  const s = (mdY || "").trim();
  if (!s) return null;
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/);
  if (!m) return null;
  const month = Number(m[1]);
  const day = Number(m[2]);
  let year = Number(m[3]);
  if (m[3].length === 2) year += 2000;
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const d = new Date(year, month - 1, day, 0, 0, 0, 0);
  if (d.getFullYear() !== year || d.getMonth() !== month - 1 || d.getDate() !== day) return null;
  return d.getTime();
}

/** "$84,500.00" → 84500. Blank / unparseable → 0. */
function parseMoney(raw: string): number {
  const cleaned = (raw || "").replace(/[^0-9.-]/g, "");
  if (!cleaned) return 0;
  const n = Number(cleaned);
  return Number.isFinite(n) ? Math.round(n) : 0;
}

// ---------------------------------------------------------------------------
// Company splitting
// ---------------------------------------------------------------------------

/**
 * Greedy longest-run split of a comma-joined Companies cell against the
 * known book: "Camosy Construction, Deerfield School District" → both known
 * individually → 2 candidates. "Sound Devices, LLC" → the whole cell is one
 * known company (a comma inside a single name) → 1 candidate. Unknown
 * leftover pieces are dropped, never added as unknown candidates; if
 * NOTHING in the cell is known, this returns [] (the caller keeps the raw
 * cell as `companyRaw` for the preview).
 */
export function splitCompanies(cell: string, known: (name: string) => boolean): string[] {
  return splitCompaniesDetailed(cell, known).matched;
}

/**
 * Same greedy longest-run algorithm as `splitCompanies`, but also returns the
 * leftover pieces that matched nothing — so a partially-known cell can keep
 * its unknown remainder on the plan (`companyUnmatched`) for the preview,
 * instead of silently dropping it the way `splitCompanies`'s public
 * candidates-only return does.
 *
 * Task 12b §1 — real companies beat combined-name stubs. The July script
 * stubbed a company for every raw multi-company cell ("C.D. Smith
 * Construction, Muermann Engineering"), so the whole cell is now "known".
 * At each position the longest known run still wins UNLESS that run itself
 * decomposes fully (no leftover piece) into ≥2 known shorter runs — then the
 * decomposition is taken. "Sound Devices, LLC" stays one company because
 * "LLC" is not a company.
 */
function splitCompaniesDetailed(cell: string, known: (name: string) => boolean): { matched: string[]; unmatched: string[] } {
  const raw = (cell || "").trim();
  if (!raw) return { matched: [], unmatched: [] };
  const pieces = raw.split(",").map((p) => p.trim()).filter(Boolean);
  return splitPieces(pieces, known);
}

function splitPieces(pieces: string[], known: (name: string) => boolean): { matched: string[]; unmatched: string[] } {
  const matched: string[] = [];
  const unmatched: string[] = [];
  let i = 0;
  while (i < pieces.length) {
    let ok = false;
    for (let len = pieces.length - i; len >= 1; len--) {
      const run = pieces.slice(i, i + len);
      const candidate = run.join(", ");
      if (known(candidate)) {
        const parts = len > 1 ? decomposeRun(run, candidate, known) : null;
        if (parts) matched.push(...parts);
        else matched.push(candidate);
        i += len;
        ok = true;
        break;
      }
    }
    if (!ok) { unmatched.push(pieces[i]); i += 1; }
  }
  return { matched, unmatched };
}

/** A known multi-piece run → its ≥2 known shorter runs, or null when any piece is left over. */
function decomposeRun(run: string[], whole: string, known: (name: string) => boolean): string[] | null {
  const wholeKey = whole.trim().toLowerCase();
  const inner = splitPieces(run, (n) => n.trim().toLowerCase() !== wholeKey && known(n));
  return inner.unmatched.length === 0 && inner.matched.length >= 2 ? inner.matched : null;
}

/**
 * Task 12b §4 — is this company NAME a combined-name stub? Its comma pieces
 * must decompose fully into ≥2 real companies (`known` must answer for the
 * OTHER companies in the book only — never this one). Returns the parts, or
 * null when the name is a single real company ("Sound Devices, LLC") or has
 * no comma at all.
 */
export function junkCompanyParts(name: string, known: (name: string) => boolean): string[] | null {
  const pieces = (name || "").split(",").map((p) => p.trim()).filter(Boolean);
  if (pieces.length < 2) return null;
  const { matched, unmatched } = splitPieces(pieces, known);
  return unmatched.length === 0 && matched.length >= 2 ? matched : null;
}

// ---------------------------------------------------------------------------
// Projects: classification + stage maps
// ---------------------------------------------------------------------------

export type Bucket = "skip" | "install" | "service" | "order";

const SKIP_STATUSES = new Set(["cancelled", "abandoned", "deferred"]);
const SERVICE_PIPELINES = new Set(["service call", "repair"]);
const SERVICE_CATEGORIES = new Set(["service", "component repair"]);

/** spec §4.2 classification order: skip → service → order → install. */
export function classifyProject(r: TsvRow): { bucket: Bucket; reason?: string } {
  const status = (r["Status"] || "").trim();
  if (SKIP_STATUSES.has(status.toLowerCase())) return { bucket: "skip", reason: status };

  const pipeline = (r["Pipeline"] || "").trim();
  const pipelineLc = pipeline.toLowerCase();
  const category = (r["Category"] || "").trim().toLowerCase();
  if (SERVICE_PIPELINES.has(pipelineLc) || (pipeline === "" && SERVICE_CATEGORIES.has(category))) {
    return { bucket: "service" };
  }
  if (pipelineLc === "custom cables") return { bucket: "order" };
  return { bucket: "install" };
}

/**
 * Stripped Daylite stage label → install stage id (spec §4.2 table),
 * covering the current pipeline and the retired ones the historical data
 * still carries.
 */
export const PROJECT_STAGE_MAP: Record<string, string> = {
  "": "initial-contact",
  "initial contact": "initial-contact",
  "acceptance": "initial-contact",
  "assigned": "initial-contact",
  "discussions/walk-thru with ec": "initial-contact",
  "walk-thru with ec": "initial-contact",

  "scheduled": "scheduled",
  "scheduled/installation": "scheduled",

  "installation": "installation",
  "punch list": "installation",
  "punchlist/consultant sign-off": "installation",

  "invoice": "invoice",
  "user training": "invoice",
  "user training / documentation": "invoice",
  "client training": "invoice",
  "documentation": "invoice",
  "documentation delivered": "invoice",
  "documentation delivery": "invoice",
  "complete - satisfaction survey sent": "invoice",
  "final invoice": "invoice",
  "final payment received": "invoice",
};

/** Stripped Daylite service-pipeline stage label → repair stage key. */
export const SERVICE_STAGE_MAP: Record<string, "approved" | "scheduled" | "completed"> = {
  "initial contact complete": "approved",
  "service scheduled": "scheduled",
  "service completed": "completed",
  "invoice sent": "completed",
};

// ---------------------------------------------------------------------------
// Opportunities: stage map
// ---------------------------------------------------------------------------

/**
 * Stripped Open-opp stage label → quote stage, keyed per pipeline (spec §4.3).
 * The pipeline itself is decided from the row's own Pipeline column, never
 * from which pipeline's map a label happens to live in — see
 * `pipelineIdFromRaw`/`resolveOppStage` below.
 */
export const OPP_STAGE_MAP: Record<"estimate-design" | "bid-spec", Record<string, { stage: string; projectStage?: string }>> = {
  "estimate-design": {
    "": { stage: "first-contact" },
    "first contact": { stage: "first-contact" },
    "design": { stage: "design" },
    "creation": { stage: "design" },
    "presentation": { stage: "presentation" },
    "delivery": { stage: "presentation" },
    "presentation/delivery": { stage: "presentation" },
    "acceptance": { stage: "acceptance", projectStage: "deposit" },
    "down payment": { stage: "acceptance", projectStage: "equipment-ordered" },
    "equipment ordered": { stage: "acceptance", projectStage: "equipment-ordered" },
  },
  "bid-spec": {
    "collect information": { stage: "collect-info" },
    "create bid": { stage: "create-bid" },
    "bid sent": { stage: "bid-sent" },
    "awarded": { stage: "awarded", projectStage: "deposit" },
    "purchase order received": { stage: "awarded", projectStage: "equipment-ordered" },
    "order product": { stage: "awarded", projectStage: "equipment-ordered" },
    "install": { stage: "awarded", projectStage: "installation" },
    "final invoice": { stage: "awarded", projectStage: "invoice" },
  },
};

const QUOTE_PIPELINE_BY_ID: Record<"estimate-design" | "bid-spec", QuotePipeline> = {
  "estimate-design": DEFAULT_QUOTE_PIPELINES.find((p) => p.id === "estimate-design")!,
  "bid-spec": DEFAULT_QUOTE_PIPELINES.find((p) => p.id === "bid-spec")!,
};

/** spec §4.3: Estimate/Design → estimate-design, BID SPEC → bid-spec, blank/unknown → estimate-design. */
function pipelineIdFromRaw(pipelineRaw: string): "estimate-design" | "bid-spec" {
  const p = (pipelineRaw || "").trim().toLowerCase();
  return p === "bid spec" ? "bid-spec" : "estimate-design";
}

/**
 * Resolves the row's pipeline FIRST from its own Pipeline column, then looks
 * the stripped stage label up in THAT pipeline's map only — a label that
 * belongs to the other pipeline (e.g. "Acceptance" on a BID SPEC row) is
 * unmapped, not silently reassigned to the pipeline it happens to name.
 * Status is derived from the resolved stage's own tag in the seeded quote
 * pipeline (src/lib/pipelines.ts), the single source of truth for which
 * stages count as sent/won — not a second, hand-kept set here.
 */
function resolveOppStage(
  pipelineRaw: string,
  stageRaw: string
): { pipelineId: "estimate-design" | "bid-spec"; stage: string; status: "draft" | "sent" | "won"; projectStage?: string; unmappedLabel?: string } {
  const pid = pipelineIdFromRaw(pipelineRaw);
  const pl = QUOTE_PIPELINE_BY_ID[pid];
  const key = stripStage(stageRaw);
  const mapped = OPP_STAGE_MAP[pid][key];
  if (mapped) {
    const status = (statusForQuoteStage(pl, mapped.stage) ?? "draft") as "draft" | "sent" | "won";
    return mapped.projectStage
      ? { pipelineId: pid, stage: mapped.stage, status, projectStage: mapped.projectStage }
      : { pipelineId: pid, stage: mapped.stage, status };
  }
  // Unknown stage (or a label that belongs to the other pipeline) → this
  // pipeline's first stage, draft, counted in stats.unmappedOppStages.
  return { pipelineId: pid, stage: firstStage(pl).id, status: "draft", unmappedLabel: key };
}

// ---------------------------------------------------------------------------
// Plan types
// ---------------------------------------------------------------------------

export type ProjectPlan = {
  kind: "project" | "repair" | "order";
  id: string;
  /** Task 12b — the id the July script (scripts/import-daylite.ts) gave this
   *  row: projectId(Name, RAW Companies cell). Equals `id` for a one-company
   *  install; differs on multi-company rows and for every service call. */
  julyId: string;
  name: string;
  companyCandidates: string[];
  companyRaw?: string; // only set when companyCandidates is empty — the raw cell, for the preview
  companyUnmatched?: string[]; // set when SOME pieces matched and some didn't — the leftover, for the preview
  people: string[];
  owner: string;
  done: boolean;
  stage: string; // install stage id | repair stage key
  startedAt: number | null;
  endedAt: number | null;
  dueAt: number | null;
  value: number | null; // null = UKN
};

export type QuotePlan = {
  id: string;
  /** Task 12b — the July lead id for the same opp: leadId(Name, RAW Companies cell). */
  julyId: string;
  name: string;
  companyCandidates: string[];
  companyRaw?: string;
  companyUnmatched?: string[];
  people: string[];
  owner: string;
  pipelineId: string;
  stage: string;
  status: "draft" | "sent" | "won";
  value: number | null;
  projectStage?: string;
};

export type JulyRetire = { julyId: string; name: string; reason: string };

// ---------------------------------------------------------------------------
// planHistory
// ---------------------------------------------------------------------------

function splitPeople(cell: string): string[] {
  return (cell || "").split(", ").map((p) => p.trim()).filter(Boolean);
}

function companyFields(
  cell: string,
  knownCompany: (name: string) => boolean
): { candidates: string[]; raw?: string; unmatched?: string[] } {
  const { matched, unmatched } = splitCompaniesDetailed(cell, knownCompany);
  if (matched.length === 0) return { candidates: matched, raw: (cell || "").trim() };
  return unmatched.length > 0 ? { candidates: matched, unmatched } : { candidates: matched };
}

/**
 * Punctuation-blind key for Won-opp → project VALUE matching only. Ids stay
 * on the strict `norm` from ./ids (unchanged) — this loose key exists
 * because the same job's name is often re-typed with different apostrophes,
 * dashes, and spacing between the Opportunities and Projects exports (e.g.
 * "St. John's Luth – Montello" vs "ST JOHNS LUTH  MONTELLO").
 */
const looseKey = (s: string): string => (s || "").toLowerCase().replace(/[^a-z0-9]/g, "");

export function planHistory(input: {
  projects: TsvRow[];
  opportunities: TsvRow[];
  knownCompany: (name: string) => boolean;
}): {
  projects: ProjectPlan[];
  quotes: QuotePlan[];
  skipped: { projects: Record<string, number>; opportunities: Record<string, number> };
  /**
   * Task 12b — skipped Projects rows (Cancelled/Abandoned/Deferred/duplicate)
   * whose July record should be retired: one entry per July id, first row
   * wins, and never an id a KEPT row owns (as its id or its julyId) — that
   * row supersedes the record itself, and retiring it first could strand it.
   */
  julyRetire: JulyRetire[];
  stats: { valueConflicts: number; unmappedOppStages: Record<string, number> };
} {
  const { projects, opportunities, knownCompany } = input;
  const skippedProjects: Record<string, number> = {};
  const skippedOpportunities: Record<string, number> = {};
  const bumpProject = (k: string) => { skippedProjects[k] = (skippedProjects[k] || 0) + 1; };
  const bumpOpportunity = (k: string) => { skippedOpportunities[k] = (skippedOpportunities[k] || 0) + 1; };
  const unmappedOppStages: Record<string, number> = {};
  const bumpUnmappedOpp = (label: string) => { unmappedOppStages[label] = (unmappedOppStages[label] || 0) + 1; };
  const seenProjectIds = new Set<string>();
  const seenQuoteIds = new Set<string>();

  // ---- Opportunities: Won → value index (loose key); Open → quotes; else → skipped ----
  const wonValuesByKey = new Map<string, number[]>();
  const quotes: QuotePlan[] = [];

  for (const o of opportunities) {
    const state = (o["State"] || "").trim();
    const stateLc = state.toLowerCase();
    const name = (o["Name"] || "").trim();
    const { candidates, raw, unmatched } = companyFields(o["Companies"] || "", knownCompany);
    const companyForId = candidates[0] || raw || "";
    const value = parseMoney(o["Value"] || "");

    if (stateLc === "won") {
      if (value > 0) {
        const key = `${looseKey(name)}|${looseKey(companyForId)}`;
        const arr = wonValuesByKey.get(key);
        if (arr) arr.push(value); else wonValuesByKey.set(key, [value]);
      }
      continue; // value source only, never a quote
    }
    if (stateLc !== "open") {
      bumpOpportunity(state || "Unknown");
      continue;
    }

    const id = quoteId(name, companyForId);
    if (seenQuoteIds.has(id)) { bumpOpportunity("duplicate"); continue; }
    seenQuoteIds.add(id);

    const resolved = resolveOppStage(o["Pipeline"] || "", o["Stage"] || "");
    if (resolved.unmappedLabel !== undefined) bumpUnmappedOpp(resolved.unmappedLabel);
    const plan: QuotePlan = {
      id,
      julyId: leadId(name, o["Companies"] || ""),
      name,
      companyCandidates: candidates,
      ...(raw !== undefined ? { companyRaw: raw } : {}),
      ...(unmatched && unmatched.length > 0 ? { companyUnmatched: unmatched } : {}),
      people: splitPeople(o["People"] || ""),
      owner: o["Owner"] || "",
      pipelineId: resolved.pipelineId,
      stage: resolved.stage,
      status: resolved.status,
      value,
      ...(resolved.projectStage ? { projectStage: resolved.projectStage } : {}),
    };
    quotes.push(plan);
  }

  // Resolve the loose-keyed Won values: several opps sharing one loose key
  // (re-quoted / re-typed over time) take the largest value, counted once
  // per conflicting key.
  let valueConflicts = 0;
  const wonValueIndex = new Map<string, number>();
  for (const [key, values] of wonValuesByKey) {
    if (new Set(values).size > 1) valueConflicts++;
    wonValueIndex.set(key, Math.max(...values));
  }

  // ---- Projects ----
  const projectPlans: ProjectPlan[] = [];
  const skippedJuly: JulyRetire[] = [];

  for (const r of projects) {
    const name = (r["Name"] || "").trim();
    const julyId = projectId(name, r["Companies"] || "");
    const { bucket, reason } = classifyProject(r);
    if (bucket === "skip") {
      bumpProject(reason || "Unknown");
      skippedJuly.push({ julyId, name, reason: reason || "Unknown" });
      continue;
    }

    const status = (r["Status"] || "").trim();
    const done = status.toLowerCase() === "done";
    const { candidates, raw, unmatched } = companyFields(r["Companies"] || "", knownCompany);
    const companyForId = candidates[0] || raw || "";

    const kind: ProjectPlan["kind"] = bucket === "service" ? "repair" : bucket === "order" ? "order" : "project";
    const id = kind === "repair" ? repairId(name, companyForId) : projectId(name, companyForId);
    if (seenProjectIds.has(id)) {
      bumpProject("duplicate");
      skippedJuly.push({ julyId, name, reason: "duplicate" });
      continue;
    }
    seenProjectIds.add(id);

    const startRaw = toMs(r["Start Date"] || "");
    const endRaw = toMs(r["End Date"] || "");
    const dueRaw = toMs(r["Due Date"] || "");
    const startedAt = done ? startRaw ?? endRaw : startRaw;
    const endedAt = endRaw;
    const dueAt = done ? dueRaw ?? endRaw : dueRaw;

    let stage: string;
    if (done) {
      stage = kind === "repair" ? "completed" : "complete";
    } else if (kind === "repair") {
      stage = SERVICE_STAGE_MAP[stripStage(r["Stage"] || "")] ?? "approved";
    } else {
      stage = PROJECT_STAGE_MAP[stripStage(r["Stage"] || "")] ?? "initial-contact";
    }

    // wonValueIndex only ever holds values > 0 (see the Won-opp loop above).
    const value = wonValueIndex.get(`${looseKey(name)}|${looseKey(companyForId)}`) ?? null;

    projectPlans.push({
      kind,
      id,
      julyId,
      name,
      companyCandidates: candidates,
      ...(raw !== undefined ? { companyRaw: raw } : {}),
      ...(unmatched && unmatched.length > 0 ? { companyUnmatched: unmatched } : {}),
      people: splitPeople(r["People"] || ""),
      owner: r["Owner"] || "",
      done,
      stage,
      startedAt,
      endedAt,
      dueAt,
      value,
    });
  }

  // July ids a kept row owns are superseded by that row, never retired here.
  const owned = new Set<string>();
  for (const p of projectPlans) {
    owned.add(p.julyId);
    if (p.kind !== "repair") owned.add(p.id);
  }
  const julyRetire: JulyRetire[] = [];
  for (const s of skippedJuly) {
    if (owned.has(s.julyId)) continue;
    owned.add(s.julyId);
    julyRetire.push(s);
  }

  return {
    projects: projectPlans,
    quotes,
    skipped: { projects: skippedProjects, opportunities: skippedOpportunities },
    julyRetire,
    stats: { valueConflicts, unmappedOppStages },
  };
}

// ---------------------------------------------------------------------------
// Preview warnings
// ---------------------------------------------------------------------------

/**
 * Live service calls that Daylite still has open at a completed stage
 * ("Service Completed" / "Invoice Sent") with an End Date more than 12 months
 * before `now`. Commit imports them as completed repairs whose completedAt is
 * the End Date (falling back to the Start Date, same as commit), and because
 * they are live rather than done they stay in the warranty follow-ups — as
 * lapsed warranties. The preview warns with this count so Jeff can close them
 * in Daylite first. The cutoff is the same calendar day a year back, local
 * time: an End Date exactly a year ago is not yet "more than" 12 months.
 */
export function staleLiveCompletedRepairs(plans: ProjectPlan[], now: number): number {
  const cutoff = new Date(now);
  cutoff.setHours(0, 0, 0, 0);
  cutoff.setFullYear(cutoff.getFullYear() - 1);
  const limit = cutoff.getTime();
  let n = 0;
  for (const p of plans) {
    if (p.kind !== "repair" || p.done || p.stage !== "completed") continue;
    const at = p.endedAt ?? p.startedAt;
    if (at != null && at < limit) n++;
  }
  return n;
}
