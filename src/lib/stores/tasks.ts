import {
  listDocs, getDoc, upsertDoc, patchDoc, softDeleteDoc, insertDocIfAbsent, insertWithPrefixedId,
} from "@/db/doc-store";
import type { ProjectTask, ProjectStage, ProjectRecord } from "@/lib/stores/projects";

/* ============================================================
   Tasks (#17) — the app's first cross-record task collection,
   promoted from the embedded ProjectTask[] (decision A, 7/19).
   Parent pointers are nullable (projectId / quoteId); assignee
   is user-id + denormalized display name (decision C); status
   is the 4-state enum (decision D). Item-16 sold/completed
   follow-ups are auto-created rows guarded by coverageKey.
   ============================================================ */

const now = () => Date.now();

export const STATUSES = ["open", "in_progress", "done", "blocked"] as const;
export type TaskStatus = (typeof STATUSES)[number];

export const STATUS_META: Record<TaskStatus, { label: string; short: string }> = {
  open:        { label: "Open",        short: "Open" },
  in_progress: { label: "In progress", short: "Doing" },
  done:        { label: "Done",        short: "Done" },
  blocked:     { label: "Blocked",     short: "Blocked" },
};

export type TaskRecord = {
  id: string;                    // "T-####" (office-created), "tk-…" (field-created / migrated), or "T-auto-<slug>" (system-created via autoTaskId)
  title: string;
  section: string;               // Field Work grouping; "Install" default, "" for non-project tasks
  projectId: string | null;      // parent pointers — nullable, no FK (D85 convention)
  quoteId: string | null;
  coverageKey: string | null;    // stable template/auto key; null for manual tasks
  assigneeUserId: string | null; // users.id ("u1"); null = unassigned or legacy
  assigneeName: string;          // denormalized display name; "" = unassigned
  dueAt: number | null;          // epoch-ms
  status: TaskStatus;
  notes: string;
  createdBy: string;             // display name
  createdAt: number;
  updatedAt: number;
  doneAt: number | null;
};

export type TaskTemplateItem = { key: string; title: string; section?: string };

/** Per-stage standard checklists (#17 "template + manual").
    REVIEWED — punch #71. Drafted by Claude 2026-08-01 from codebase evidence,
    then WALKED THROUGH WITH JEFF the same day. He cut two items (the delivery
    damage inspection and the closeout margin reconciliation — see the inline
    REMOVED notes, and do not reintroduce either) and kept the rest, including
    the O&M documentation handoff and the safe-rigging/lockout training step,
    both of which were flagged to him as guesses. Sources are cited per item.
    Items marked SAFETY/COMPLIANCE encode a genuine life-safety or code step —
    keep them even if the wording changes. Still worth correcting in real use
    once tasks actually appear on a project, but this is no longer inference. */
export const TASK_TEMPLATE: Record<ProjectStage, TaskTemplateItem[]> = {
  // procurement ("Order materials"): ProcurementLine{sku,desc,vendor,qty,cost,
  // leadDays,status,po}, VENDORS (JR Clancy/Rose Brand/ETC/Wenger/In-stock),
  // criticalLineId()/orderByDate()/lineLate() risk flags, seed task
  // "Field-verify grid heights before fab" (db/seeds/projects.ts), and
  // DEFAULT_CONSULTING_ASSUMPTIONS' "Existing structure is assumed adequate
  // for the loads shown; structural engineering is by others" (consulting-stages.ts).
  procurement: [
    { key: "release-pos", title: "Release POs for every procurement line (rigging, soft goods, control/dimming, shell)", section: "Procurement" },
    { key: "confirm-critical-lead", title: "Confirm the order-by date for the longest lead-time line against the install target", section: "Procurement" },
    // SAFETY: existing structure adequacy for rigging loads is a standing consulting
    // assumption ("engineering is by others") — this is where Peak actually verifies it in the field.
    { key: "field-verify-structure", title: "Field-verify grid heights and existing structural attachment points before fabrication", section: "Procurement" },
    { key: "confirm-vendor-leads", title: "Confirm vendor lead times against the target date for every line", section: "Procurement" },
  ],
  // delivery ("Deliveries"): ProjectDelivery{label,vendor,eta,status:
  // scheduled/in_transit/received}, STAGING_BUFFER = 7 days before install
  // (projects.ts orderByDate), seed tasks "Confirm site access & dock" /
  // "Stage hardware to loading dock" (db/seeds/projects.ts, "Mobilize" section).
  delivery: [
    { key: "confirm-staging-buffer", title: "Confirm delivery ETAs land at least 7 days before install (staging buffer)", section: "Deliveries" },
    { key: "site-access", title: "Confirm site access, loading dock, and receiving hours with the facility", section: "Mobilize" },
    // REMOVED 2026-08-01 (Jeff): a formal receiving/damage inspection is not a step
    // Peak tracks here. Was a guess inferred from ProjectDelivery's in_transit ->
    // received transition; do not reintroduce it.
    { key: "stage-hardware", title: "Stage hardware and materials for the install crew", section: "Mobilize" },
  ],
  // scheduled ("Crew scheduled"): CrewAssignment{person,role,start,end,mobId},
  // riskFlags()'s "no-crew" flag, seed crew roles "Rigging lead"/"Installer"
  // (db/seeds/projects.ts), Mobilization{type,days,crew,discipline} carried
  // from the estimator (spec.mobs), MOB_TYPES = Site Visit/Install/Hang/
  // Commissioning/Training (estimator-data.ts), seed task "Confirm dark week
  // & house clearance" (db/seeds/projects.ts, "Mobilize" section).
  scheduled: [
    { key: "assign-crew", title: "Assign rigging lead and installers, and confirm start/end dates", section: "Scheduled" },
    { key: "confirm-dark-week", title: "Confirm dark week / house clearance with the venue", section: "Mobilize" },
    { key: "match-mobilization", title: "Match the crew assignment to the estimator's mobilization plan (site visit / install / hang / commissioning / training)", section: "Scheduled" },
    { key: "confirm-crew-count", title: "Confirm crew headcount matches the mobilization plan's crew size", section: "Scheduled" },
  ],
  // install ("Install"): TaskRecord.section defaults to "Install"; seed tasks
  // "Hang & level walkalong track", "Hang main drape & trim fullness",
  // "Dress pleats & weight chain", "Assemble towers & set ceiling",
  // "Operational test & punch walk" (db/seeds/projects.ts); TimeLog{person,
  // date,hours,note} and ProjectNote{photo} on the project record; the
  // rigging component rubric (loft blocks/wire rope/arbors/rope locks —
  // inspections.ts RUBRIC_TEMPLATE) describing what a rigging system
  // actually consists of; "Commissioning" as a distinct mob type (estimator-data.ts).
  install: [
    // SAFETY: rigging is a life-safety system (ANSI E1.4 counterweight rigging,
    // per the inspection report's basis-of-recommendation text in report-doc.tsx).
    { key: "rigging-install", title: "Complete rigging installation per line-set assignments", section: "Install" },
    { key: "hang-soft-goods", title: "Hang and trim soft goods (drapes, track, borders, valance)", section: "Install" },
    { key: "log-crew-hours", title: "Log daily crew hours against the job", section: "Install" },
    { key: "photo-progress", title: "Photo-document install progress for the job file", section: "Install" },
    // SAFETY: functional/commissioning test of installed systems before staff are
    // trained on them or the job proceeds to sign-off.
    { key: "operational-test", title: "Run the operational/commissioning test and punch walk before training", section: "Install" },
  ],
  // training ("Training"): trainingAt timestamp on the project record; seed
  // task "Train staff on move/store" (db/seeds/projects.ts, "Closeout"
  // section); MOB_TYPES includes "Training" as its own mobilization
  // (estimator-data.ts); ProjectSignoff{name,role} — sign-off records who was
  // trained, so capturing that name/role here feeds it forward.
  training: [
    { key: "train-operation", title: "Train venue staff on system operation (rigging, curtains, controls, as applicable)", section: "Training" },
    // SAFETY: rigging operation/lockout training — no direct codebase evidence of
    // Peak's exact training content, but this is standard practice for a system this
    // codebase treats as life-safety (ANSI E1.4 references elsewhere). Confirm wording with Jeff.
    { key: "train-safe-rigging", title: "Cover safe rigging operation and lockout procedure with the trained staff", section: "Training" },
    // GUESS: no direct evidence Peak hands over written O&M docs; common industry
    // practice, included for Jeff to confirm or cut.
    { key: "deliver-om-docs", title: "Deliver O&M documentation / owner's manual", section: "Training" },
    { key: "confirm-trained-contact", title: "Record the name and role of the staff member trained, for the sign-off record", section: "Training" },
  ],
  // signoff ("Customer sign-off"): ProjectSignoff{name,role,signedBy,signedAt,
  // note} (projects.ts setSignoff); seed task "Operational test & punch walk"
  // (db/seeds/projects.ts); NFPA 705 field-flame test for soft goods
  // (flame-tests/*); the inspection report's compliance basis — NFPA 80 & 101
  // life-safety codes, ANSI E1.4 counterweight rigging / E1.22 fire-safety
  // curtain (inspections/[id]/report/report-doc.tsx) — same systems Peak installs.
  signoff: [
    { key: "punch-walk", title: "Walk the completed install with the customer and capture punch items", section: "Signoff" },
    { key: "customer-acceptance", title: "Obtain signed customer acceptance (name, role, signature, date)", section: "Signoff" },
    // SAFETY/COMPLIANCE: flame-retardancy documentation for installed soft goods
    // (NFPA 701/705) — Peak already runs this as its own service line (flame-tests/*).
    { key: "flame-cert-docs", title: "Deliver flame-certification documentation for installed soft goods (NFPA 701/705), if applicable to this job", section: "Signoff" },
    // SAFETY: rigging load path / hardware vs. accepted design, before the customer signs.
    { key: "confirm-load-path", title: "Confirm rigging load path and hardware match the accepted design before sign-off", section: "Signoff" },
  ],
  // complete ("Complete"): ProjectRecord.value/margin fields; setProjectStage's
  // item-16 auto follow-up task already covers the salesperson's how-did-it-go
  // check-in (projects.ts:442-456), so it is intentionally NOT duplicated here.
  // ProcurementLine.po and ProjectNote.photo give the job-file artifacts to archive.
  complete: [
    { key: "verify-signoff-onfile", title: "Verify signed customer acceptance is on file before closing the job", section: "Closeout" },
    // REMOVED 2026-08-01 (Jeff): margin reconciliation is not a project-checklist
    // step — it belongs to accounting, not to the crew-facing closeout. Was a guess
    // inferred from ProjectRecord.value/margin existing; do not reintroduce it.
    { key: "archive-job-file", title: "Archive POs, packing slips, and install photos to the job file", section: "Closeout" },
  ],
};

/* ---------- pure helpers (covered by test:specs) ---------- */

export function isOverdue(t: Pick<TaskRecord, "dueAt" | "status">, nowMs: number): boolean {
  return !!t.dueAt && t.status !== "done" && t.dueAt < nowMs;
}

/** Map one embedded ProjectTask to a TaskRecord, preserving its id. */
export function taskFromLegacy(projectId: string, pt: ProjectTask, at: number): TaskRecord {
  return {
    id: pt.id, title: pt.title, section: pt.section || "Install",
    projectId, quoteId: null, coverageKey: null,
    assigneeUserId: null, assigneeName: pt.assignee || "",
    dueAt: null, status: pt.done ? "done" : "open", notes: "",
    createdBy: pt.assignee || "", createdAt: at, updatedAt: at,
    doneAt: pt.done ? (pt.doneAt ?? at) : null,
  };
}

/** blankRubric-style expansion with coverage-key de-dup (inspections.ts idiom):
    emit only template items whose key is not already present. `stage` must be
    record-scoped (e.g. "<projectId>:<stage>", not just "<stage>") — createAutoTask's
    dedup and autoTaskId are collection-global, so an unscoped stage string means
    only the first record to ever enter that stage gets the checklist; every
    later record silently gets none. */
export function expandTemplate(
  items: TaskTemplateItem[], stage: string, existingKeys: ReadonlySet<string>,
): { coverageKey: string; title: string; section: string }[] {
  const out: { coverageKey: string; title: string; section: string }[] = [];
  for (const it of items) {
    const coverageKey = stage + ":" + it.key;
    if (existingKeys.has(coverageKey)) continue;
    out.push({ coverageKey, title: it.title, section: it.section || "Install" });
  }
  return out;
}

/** Deterministic id for a system-created task: same coverageKey → same id,
    so concurrent auto-creation collapses onto one atomic insert. */
export function autoTaskId(coverageKey: string): string {
  return "T-auto-" + coverageKey.toLowerCase().replace(/[^a-z0-9]+/g, "-");
}

/** Bell rail (#17): open tasks assigned to me, plus anything overdue. */
export function taskBellItems(all: TaskRecord[], me: string, nowMs: number): TaskRecord[] {
  return all.filter(
    (t) => t.status !== "done" && (t.assigneeName === me || isOverdue(t, nowMs)),
  );
}

/* ---------- normalize + CRUD ---------- */

function normalizeTask(raw: Partial<TaskRecord> & { id: string }): TaskRecord {
  const at = raw.createdAt ?? now();
  return {
    id: raw.id, title: raw.title || "New task", section: raw.section ?? "Install",
    projectId: raw.projectId ?? null, quoteId: raw.quoteId ?? null,
    coverageKey: raw.coverageKey ?? null,
    assigneeUserId: raw.assigneeUserId ?? null, assigneeName: raw.assigneeName ?? "",
    dueAt: raw.dueAt ?? null,
    status: (STATUSES as readonly string[]).includes(raw.status as string) ? (raw.status as TaskStatus) : "open",
    notes: raw.notes ?? "", createdBy: raw.createdBy ?? "",
    createdAt: at, updatedAt: raw.updatedAt ?? at, doneAt: raw.doneAt ?? null,
  };
}

export async function allTasks(): Promise<TaskRecord[]> {
  const rows = await listDocs<TaskRecord>("tasks");
  return rows.map(normalizeTask).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
}

export async function tasksForProject(projectId: string): Promise<TaskRecord[]> {
  return (await allTasks()).filter((t) => t.projectId === projectId);
}

/** PUNCHLIST #17 remainder — the quote side of the same collection.
 *  `quoteId` has been written as `null` everywhere until now (no UI wrote
 *  it); this is the read half once one exists. */
export async function tasksForQuote(quoteId: string): Promise<TaskRecord[]> {
  return (await allTasks()).filter((t) => t.quoteId === quoteId);
}

export async function getTask(id: string): Promise<TaskRecord | null> {
  const doc = await getDoc<TaskRecord>("tasks", id);
  return doc ? normalizeTask(doc) : null;
}

export async function createTask(
  input: Partial<TaskRecord> & { title: string },
  me: { id: string; name: string },
): Promise<TaskRecord> {
  const at = now();
  if (input.id) {
    const t = normalizeTask({ ...input, id: input.id, createdBy: me.name, createdAt: at, updatedAt: at });
    await upsertDoc<TaskRecord>("tasks", t);
    return t;
  }
  return insertWithPrefixedId<TaskRecord>("tasks", "T", 6000, (id) =>
    normalizeTask({ ...input, id, createdBy: me.name, createdAt: at, updatedAt: at })
  );
}

/** Idempotent system-created task (templates, item 16): coverageKey is the
    dedup guard — both trigger paths are re-runnable by design (PUNCHLIST §16).
    The id is deterministic (autoTaskId), so concurrent callers for the same
    coverageKey race on the same row and insertDocIfAbsent lets exactly one
    win — the allTasks() scan below is only a cheap fast-path skip, not the
    correctness guard (coverageKey lives in jsonb, so no DB constraint can
    enforce it directly). */
export async function createAutoTask(
  input: Partial<TaskRecord> & { title: string; coverageKey: string },
): Promise<TaskRecord | null> {
  const existing = (await allTasks()).find((t) => t.coverageKey === input.coverageKey);
  if (existing) return null;
  const at = now();
  const id = autoTaskId(input.coverageKey);
  const t = normalizeTask({ ...input, id, createdBy: input.createdBy || "System", createdAt: at, updatedAt: at });
  const inserted = await insertDocIfAbsent<TaskRecord>("tasks", t);
  return inserted ? t : null;
}

export async function setTaskStatus(id: string, status: TaskStatus): Promise<TaskRecord | null> {
  if (!(STATUSES as readonly string[]).includes(status)) return null;
  return patchDoc<TaskRecord>("tasks", id, (t) => {
    t.status = status;
    t.doneAt = status === "done" ? now() : null;
    t.updatedAt = now();
    return t;
  });
}

export async function updateTask(
  id: string,
  patch: Partial<Pick<TaskRecord, "title" | "section" | "assigneeUserId" | "assigneeName" | "dueAt" | "notes">>,
): Promise<TaskRecord | null> {
  return patchDoc<TaskRecord>("tasks", id, (t) => {
    Object.assign(t, patch);
    t.updatedAt = now();
    return t;
  });
}

export async function removeTask(id: string): Promise<void> {
  await softDeleteDoc("tasks", id);
}

/** One-way, idempotent: copy any project's embedded tasks[] into the tasks
    collection (preserving tk- ids), then blank the embedded array. Runs on
    read from the pages that render tasks, so dev seeds, prod data, and field
    mirrors all migrate without a manual step. */
export async function ensureProjectTasksMigrated(projects: ProjectRecord[]): Promise<void> {
  for (const p of projects) {
    const legacy = Array.isArray(p.tasks) ? p.tasks : [];
    if (!legacy.length) continue;
    for (const pt of legacy) {
      const hit = await getDoc<TaskRecord>("tasks", pt.id);
      if (!hit) await upsertDoc("tasks", taskFromLegacy(p.id, pt, now()));
    }
    await patchDoc<ProjectRecord>("projects", p.id, (doc) => {
      doc.tasks = [];
      doc.updatedAt = now();
      return doc;
    });
  }
}
