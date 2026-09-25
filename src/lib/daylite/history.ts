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

import { projectId, repairId, quoteId } from "./ids";

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
  const raw = (cell || "").trim();
  if (!raw) return [];
  const pieces = raw.split(",").map((p) => p.trim()).filter(Boolean);
  const result: string[] = [];
  let i = 0;
  while (i < pieces.length) {
    let matched = false;
    for (let len = pieces.length - i; len >= 1; len--) {
      const candidate = pieces.slice(i, i + len).join(", ");
      if (known(candidate)) {
        result.push(candidate);
        i += len;
        matched = true;
        break;
      }
    }
    if (!matched) i += 1;
  }
  return result;
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

/** Stripped Open-opp stage label → pipeline + quote stage (spec §4.3). */
export const OPP_STAGE_MAP: Record<
  string,
  { pipelineId: "estimate-design" | "bid-spec"; stage: string; projectStage?: string }
> = {
  // Estimate/Design
  "": { pipelineId: "estimate-design", stage: "first-contact" },
  "first contact": { pipelineId: "estimate-design", stage: "first-contact" },
  "design": { pipelineId: "estimate-design", stage: "design" },
  "creation": { pipelineId: "estimate-design", stage: "design" },
  "presentation": { pipelineId: "estimate-design", stage: "presentation" },
  "delivery": { pipelineId: "estimate-design", stage: "presentation" },
  "presentation/delivery": { pipelineId: "estimate-design", stage: "presentation" },
  "acceptance": { pipelineId: "estimate-design", stage: "acceptance", projectStage: "deposit" },
  "down payment": { pipelineId: "estimate-design", stage: "acceptance", projectStage: "equipment-ordered" },
  "equipment ordered": { pipelineId: "estimate-design", stage: "acceptance", projectStage: "equipment-ordered" },

  // BID SPEC
  "collect information": { pipelineId: "bid-spec", stage: "collect-info" },
  "create bid": { pipelineId: "bid-spec", stage: "create-bid" },
  "bid sent": { pipelineId: "bid-spec", stage: "bid-sent" },
  "awarded": { pipelineId: "bid-spec", stage: "awarded", projectStage: "deposit" },
  "purchase order received": { pipelineId: "bid-spec", stage: "awarded", projectStage: "equipment-ordered" },
  "order product": { pipelineId: "bid-spec", stage: "awarded", projectStage: "equipment-ordered" },
  "install": { pipelineId: "bid-spec", stage: "awarded", projectStage: "installation" },
  "final invoice": { pipelineId: "bid-spec", stage: "awarded", projectStage: "invoice" },
};

const WON_OPP_STAGES = new Set(["acceptance", "awarded"]);
const SENT_OPP_STAGES = new Set(["presentation", "bid-sent"]);
const FIRST_OPP_STAGE: Record<"estimate-design" | "bid-spec", string> = {
  "estimate-design": "first-contact",
  "bid-spec": "collect-info",
};

function pipelineIdFromRaw(pipelineRaw: string): "estimate-design" | "bid-spec" {
  const p = (pipelineRaw || "").trim().toLowerCase();
  return p === "bid spec" ? "bid-spec" : "estimate-design"; // blank/unknown → estimate-design rules
}

function resolveOppStage(
  pipelineRaw: string,
  stageRaw: string
): { pipelineId: "estimate-design" | "bid-spec"; stage: string; status: "draft" | "sent" | "won"; projectStage?: string } {
  const key = stripStage(stageRaw);
  const mapped = OPP_STAGE_MAP[key];
  if (mapped) {
    const status: "draft" | "sent" | "won" = WON_OPP_STAGES.has(mapped.stage)
      ? "won"
      : SENT_OPP_STAGES.has(mapped.stage)
        ? "sent"
        : "draft";
    return mapped.projectStage
      ? { pipelineId: mapped.pipelineId, stage: mapped.stage, status, projectStage: mapped.projectStage }
      : { pipelineId: mapped.pipelineId, stage: mapped.stage, status };
  }
  // Unknown stage → the pipeline's first stage, draft.
  const pid = pipelineIdFromRaw(pipelineRaw);
  return { pipelineId: pid, stage: FIRST_OPP_STAGE[pid], status: "draft" };
}

// ---------------------------------------------------------------------------
// Plan types
// ---------------------------------------------------------------------------

export type ProjectPlan = {
  kind: "project" | "repair" | "order";
  id: string;
  name: string;
  companyCandidates: string[];
  companyRaw?: string; // only set when companyCandidates is empty — the raw cell, for the preview
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
  name: string;
  companyCandidates: string[];
  companyRaw?: string;
  people: string[];
  owner: string;
  pipelineId: string;
  stage: string;
  status: "draft" | "sent" | "won";
  value: number | null;
  projectStage?: string;
};

// ---------------------------------------------------------------------------
// planHistory
// ---------------------------------------------------------------------------

function splitPeople(cell: string): string[] {
  return (cell || "").split(", ").map((p) => p.trim()).filter(Boolean);
}

function companyFields(cell: string, knownCompany: (name: string) => boolean): { candidates: string[]; raw?: string } {
  const candidates = splitCompanies(cell, knownCompany);
  return candidates.length === 0 ? { candidates, raw: (cell || "").trim() } : { candidates };
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
  stats: { valueConflicts: number };
} {
  const { projects, opportunities, knownCompany } = input;
  const skippedProjects: Record<string, number> = {};
  const skippedOpportunities: Record<string, number> = {};
  const bumpProject = (k: string) => { skippedProjects[k] = (skippedProjects[k] || 0) + 1; };
  const bumpOpportunity = (k: string) => { skippedOpportunities[k] = (skippedOpportunities[k] || 0) + 1; };
  const seenProjectIds = new Set<string>();
  const seenQuoteIds = new Set<string>();

  // ---- Opportunities: Won → value index (loose key); Open → quotes; else → skipped ----
  const wonValuesByKey = new Map<string, number[]>();
  const quotes: QuotePlan[] = [];

  for (const o of opportunities) {
    const state = (o["State"] || "").trim();
    const stateLc = state.toLowerCase();
    const name = (o["Name"] || "").trim();
    const { candidates, raw } = companyFields(o["Companies"] || "", knownCompany);
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
    const plan: QuotePlan = {
      id,
      name,
      companyCandidates: candidates,
      ...(raw !== undefined ? { companyRaw: raw } : {}),
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

  for (const r of projects) {
    const { bucket, reason } = classifyProject(r);
    if (bucket === "skip") { bumpProject(reason || "Unknown"); continue; }

    const status = (r["Status"] || "").trim();
    const done = status.toLowerCase() === "done";
    const name = (r["Name"] || "").trim();
    const { candidates, raw } = companyFields(r["Companies"] || "", knownCompany);
    const companyForId = candidates[0] || raw || "";

    const kind: ProjectPlan["kind"] = bucket === "service" ? "repair" : bucket === "order" ? "order" : "project";
    const id = kind === "repair" ? repairId(name, companyForId) : projectId(name, companyForId);
    if (seenProjectIds.has(id)) { bumpProject("duplicate"); continue; }
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
      name,
      companyCandidates: candidates,
      ...(raw !== undefined ? { companyRaw: raw } : {}),
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

  return {
    projects: projectPlans,
    quotes,
    skipped: { projects: skippedProjects, opportunities: skippedOpportunities },
    stats: { valueConflicts },
  };
}
