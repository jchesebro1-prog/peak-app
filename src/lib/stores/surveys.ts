import {
  getDoc,
  insertWithPrefixedId,
  listDocs,
  patchDoc,
  softDeleteDoc,
  upsertDoc,
} from "@/db/doc-store";
import { eq, sql } from "drizzle-orm";
import { getDb, SURVEY_LOCK_NAMESPACE, withAdvisoryLock } from "@/db";
import { DOC_TABLES } from "@/db/doc-tables";
import { blobEnabled } from "@/lib/blob";
import {
  FILE_ID_RE,
  INLINE_CAPS,
  fileSlotOf,
  filePathMatches,
  foldFileSlot,
  inlineFileProblem,
  mergeSurveyFileRefs,
  sanitizeIncomingFileSlots,
  slotFinished,
  surveyInlineTotal,
  type FinishedSlot,
  type SketchRef,
  type SurveyPhotoRef,
} from "../field-files/files";
import {
  blankSystemsState,
  type DisciplineData,
  type InventoryRow,
  type SystemState,
} from "./survey-intake";
// Venue Assessments (D132) — pure model modules shared with the client editor.
// venue-classes.ts type-imports MeasureField from here; that import is
// type-only and erased, so there is no runtime cycle.
import {
  classMeasureFields,
  venueClassFor,
  venueSubtypeFor,
  visitPurposeFor,
  type VenueClass,
} from "./venue-classes";
import { blankAssessment, type AssessmentData } from "./assessment";
import type { LinesetRow } from "./linesets";
import { migrateSurvey, type LegacyNote } from "../survey-migrate";
import type { MeasureField } from "../survey-measure-fields";

// The measurement field definitions are a pure module (client-safe plain-text readers import it); re-exported here.
export {
  BEAM_TYPES, BEAM_DIRECTIONS, DRAW_SIDES, BOOTH_LOCATIONS,
  LAYOUT_FIELDS, SECTION_FIELDS, BEAM_FIELDS, FOH_FIELDS, HOUSE_FIELDS, MEASURE_GROUPS,
  type MeasureField, type MeasureGroup,
} from "../survey-measure-fields";

// Site Intake extension model (tiers, disciplines, inventory catalog) — pure
// module shared with the client editor; re-exported for server callers.
export * from "./survey-intake";

/**
 * SurveyStore — direct port of app/survey.js v3 (rss_surveys_v4).
 *
 * Field surveys: office request → schedule → field capture → done
 * (requested → scheduled → onsite → completed). The record carries the
 * office brief (visit info, contact, quote info, site access/logistics,
 * free-text scope) AND the field capture (venue-type quick measurement set,
 * optional full stage-rig groups, conditions, photos). Measurements are
 * free strings so the surveyor can enter feet+inches ("38'-6\"") or decimal
 * feet ("38.5"). Photos are downscaled data-URLs stored on the record.
 *
 * Field names, id format (FS-####, base 1053), lifecycle and option lists
 * are the prototype's spec — ported exactly. Differences:
 * - localStorage read/write/ensure → doc-store (Postgres JSONB).
 * - `window.Team.CURRENT` → explicit `me` parameter (fallback
 *   "Jeff Chesebro", the prototype's).
 * - update(): the prototype re-dirtied records to syncState:'pending' for
 *   the SyncEngine; a server write IS the cloud write, so mutations land
 *   syncState:'synced' with syncedAt stamped (rev still bumps).
 * - The ensure() stage backfill (records predating `stage` get
 *   'completed'/'onsite' from syncState) is applied on read instead of as
 *   a stored migration.
 * - remove() soft-deletes; SyncEngine registration, _setSync, initCloudSeed
 *   and resetToSeed are client sync plumbing — not ported.
 */

const DAY = 86400000;

/** Site-visit sheet template revision stamped on every record (D132). */
export const TEMPLATE_REV = "1.0";

function now(): number {
  return Date.now();
}

/* ---- option lists (used by the editor's dropdowns) ---- */

export const VENUE_TYPES: string[] = [
  "Proscenium theater",
  "Black box",
  "Worship / sanctuary",
  "Gymnasium / gym stage",
  "Arena",
  "Multipurpose room",
  "Outdoor / amphitheater",
];

export const VISIT_TYPES: string[] = [
  "Initial site survey",
  "Budgetary walk-through",
  "Design verification",
  "Punch / follow-up",
  "Service call",
];
export const FLOOR_TYPES: string[] = [
  "Concrete",
  "Wood / sprung",
  "Tile",
  "Carpet",
  "Turf",
  "Other",
];
export const LIFT_TYPES: string[] = [
  "None needed",
  "Scissor lift",
  "Articulating boom",
  "Personnel / Genie lift",
  "Scaffold",
  "Ladder only",
];
export const LIFT_SUPPLIERS: string[] = ["We supply", "Customer supplies", "Rented", "TBD"];
export const RIG_TYPES: string[] = [
  "Dead-hung",
  "Counterweight",
  "Motorized",
  "Hemp",
  "None existing",
];
export const INSTALL_TIMEFRAMES: string[] = [
  "ASAP",
  "Under 1 month",
  "1–3 months",
  "3–6 months",
  "6–12 months",
  "TBD",
];

/* ---- lifecycle stages: office request → schedule → field capture → done ---- */

export type SurveyStage = "requested" | "scheduled" | "onsite" | "completed";

export const STAGES: Array<{ key: SurveyStage; label: string }> = [
  { key: "requested", label: "Requested" },
  { key: "scheduled", label: "Scheduled" },
  { key: "onsite", label: "On-site" },
  { key: "completed", label: "Completed" },
];

export interface SurveyStageMeta {
  label: string;
  ink: string;
  soft: string;
  bd: string;
}

export const STAGE_META: Record<SurveyStage, SurveyStageMeta> = {
  requested: { label: "Requested", ink: "#8a6d1f", soft: "#fbf3dd", bd: "#f0e2bd" },
  scheduled: { label: "Scheduled", ink: "#3155a8", soft: "#e9eefb", bd: "#d4ddf3" },
  onsite: { label: "On-site", ink: "#7b3f8a", soft: "#f3eaf5", bd: "#e6d3ea" },
  completed: { label: "Completed", ink: "#1f7a52", soft: "#eaf6ef", bd: "#cce9da" },
};

export function stageMeta(k: string): SurveyStageMeta {
  return (
    STAGE_META[k as SurveyStage] || {
      label: k || "Requested",
      ink: "#8c919c",
      soft: "#f1f2f5",
      bd: "#e4e7ec",
    }
  );
}

export function stageIndex(k: string): number {
  const i = STAGES.findIndex((s) => s.key === k);
  return i < 0 ? 0 : i;
}

/* ---- measurement field definitions ---- */


// The venue-class "quick" measurement set (ft), from the printed site-visit
// sheets. Keys are shared with the full groups below where they represent the
// same dimension, so a value entered in the quick set and in an expanded group
// is the same field (no dupes) — see venue-classes.ts.
export function measureFieldsForClass(cls: VenueClass): MeasureField[] {
  return classMeasureFields(cls);
}

/** @deprecated use measureFieldsForClass — kept until the editor moves in Task 8. */
export function measureFields(venueType: string | undefined): MeasureField[] {
  return classMeasureFields(venueClassFor(venueType));
}

// ---- full stage-rig measurement groups (optional, expandable) ----
// plain names, no diagram letters. All values are free strings (ft-in or ft).

export const CONDITIONS: string[] = [
  "Existing rigging — counterweight",
  "Existing rigging — hemp",
  "Motorized hoists present",
  "Asbestos / hazmat unknown",
  "Limited load-in access",
  "Active venue (work around events)",
  "Power / electrical upgrade needed",
  "Low grid clearance",
  "Historic / preservation constraints",
  "Volunteer install crew available",
];

/* ---- record shape ---- */

export type SyncState = "synced" | "pending" | "syncing" | "error";

/** Photo entry captured on-device (Survey.dc.html) — downscaled data URL. */
export interface SurveyPhoto {
  id: string;
  name: string;
  dataUrl: string;
}

/** The blank() shape — the office brief + field capture fields. */
export interface SurveyDraft {
  [key: string]: unknown; // doc-store JSONB compatibility
  customer: string;
  customerId: string | null;
  locationId: string | null;
  venue: string;
  venueType: string;
  address: string;
  contact: string;
  contactPhone: string;
  contactEmail: string;
  visitType: string;
  reason: string;
  travelTime: string;
  distance: string;
  /** #344 B-final — set once the editor filled Travel time / Distance from the drive suggestion; never refilled after */
  travelAutoFilled?: true;
  hasBOM: boolean;
  hasDrawings: boolean;
  hasPhotos: boolean;
  quoteNeededBy: string;
  budgetary: boolean;
  projectCompletion: string;
  installTimeframe: string;
  loadingDock: string;
  elevatorSize: string;
  floorType: string;
  accessDoorSize: string;
  liftNeeded: string;
  liftSupplier: string;
  scopeOfWork: string;
  quoteLook: string;
  notes: string;
  stage: SurveyStage;
  assignedTo: string;
  scheduledDate: string;
  requestedBy: string;
  requestedAt: number;
  measurements: Record<string, string>;
  conditions: string[];
  photos: SurveyPhoto[];
  // ---- Site Intake extension (IDEAS #45 — see survey-intake.ts) ----
  auditoriumSize: string; // Tier 2 — small/medium/large by seats
  yearBuilt: string; // Tier 2
  systemsState: Record<string, SystemState>; // Tier 3 — installed systems yes/no + describe
  disciplines: Record<string, DisciplineData>; // discipline branch forms
  disciplinesActive: string[]; // which branches the rep opened
  inventory: InventoryRow[]; // structured type+qty rows (Lighting/AV)
  intakeReady: boolean; // explicit "ready for quote" flag
  // ---- Venue Assessments (D132) — site-visit layer ----
  venueClass: VenueClass;
  venueSubtype: string;
  visitPurpose: string;
  templateRev: string;
  // access & site conditions, from the sheets
  loadingDoorSize: string;
  liftHeight: string;
  // #344 B2 — access, replacing loadingDoorSize / liftNeeded / liftHeight (old keys kept; migrated on read)
  loadingDoorType: string;
  loadingDoorLocation: string;
  loadingDoorWH: string;
  liftRequired: "" | "yes" | "no";
  liftType: string;
  liftWorkingHeight: string;
  pathToFloor: string;
  workingHours: string;
  blackoutDates: string;
  floorProtection: string;
  badgingRequired: string;
  firstImpressions: string;
  // quote questions, from the sheets
  budget: string;
  fiscalYearSpendBy: string;
  whoDecides: string;
  targetInstallWindow: string;
  // life safety (auditorium sheet p.5, offered on any class)
  lifeSafety: { deluge: string; smokeVent: string; adaNotes: string; egressNotes: string };
  // lineset schedule
  linesetsEnabled: boolean;
  linesets: LinesetRow[];
  /** #344 B2 — how many line sets; drives the schedule's row count (unset until answered or migrated) */
  linesetQty?: number;
  // close-out
  signoff: {
    repName: string; repSignedAt: string;
    contactName: string; contactSignedAt: string;
    reviewerName: string; reviewerRole: string; reviewerSignedAt: string;
  };
  // ---- assessment layer ----
  assessmentEnabled: boolean;
  assessment: AssessmentData;
  // ---- Lead thread (#34): the visit request that spawned this survey ----
  leadId: string | null;
  visitId: string | null;
  // ---- #344 Venue Assessment notes ----
  /** the scope kill question — DisciplineKey[]; absent/empty = unanswered (filters nothing) */
  scope?: string[];
  /** Final thoughts — internal tag ids (settings.surveyInternalTags); never printed for the customer */
  internalTags?: string[];
  /** derived on every read by migrateSurvey — never stored */
  legacyNotes?: LegacyNote[];
  /** #344 C4 — per-section photos; each file slot is filled by the device photo queue (cap 200) */
  photoRefs?: SurveyPhotoRef[];
  /** #344 C4 — sketch pads by key; a re-draw gets a new `s_` id */
  sketches?: Record<string, SketchRef>;
}

export interface SurveyRecord extends SurveyDraft {
  id: string; // FS-#### (base 1053)
  owner: string;
  createdAt: number;
  updatedAt: number;
  syncState: SyncState;
  syncedAt: number | null;
  rev: number;
}

/** Default blank record — the single source of the record shape (prototype blank()). */
export function blank(partial: Partial<SurveyDraft> = {}): SurveyDraft {
  const def: SurveyDraft = {
    customer: "",
    customerId: null,
    locationId: null,
    venue: "",
    venueType: VENUE_TYPES[0],
    address: "",
    contact: "",
    contactPhone: "",
    contactEmail: "",
    visitType: "",
    reason: "",
    travelTime: "",
    distance: "",
    hasBOM: false,
    hasDrawings: false,
    hasPhotos: false,
    quoteNeededBy: "",
    budgetary: false,
    projectCompletion: "",
    installTimeframe: "",
    loadingDock: "",
    elevatorSize: "",
    floorType: "",
    accessDoorSize: "",
    liftNeeded: "",
    liftSupplier: "",
    scopeOfWork: "",
    quoteLook: "",
    notes: "",
    stage: "requested",
    assignedTo: "",
    scheduledDate: "",
    requestedBy: "",
    requestedAt: 0,
    measurements: {},
    conditions: [],
    photos: [],
    auditoriumSize: "",
    yearBuilt: "",
    systemsState: blankSystemsState(),
    disciplines: {},
    disciplinesActive: [],
    inventory: [],
    intakeReady: false,
    venueClass: "theatre",
    venueSubtype: "",
    visitPurpose: "",
    templateRev: TEMPLATE_REV,
    loadingDoorSize: "",
    liftHeight: "",
    loadingDoorType: "",
    loadingDoorLocation: "",
    loadingDoorWH: "",
    liftRequired: "",
    liftType: "",
    liftWorkingHeight: "",
    pathToFloor: "",
    workingHours: "",
    blackoutDates: "",
    floorProtection: "",
    badgingRequired: "",
    firstImpressions: "",
    budget: "",
    fiscalYearSpendBy: "",
    whoDecides: "",
    targetInstallWindow: "",
    lifeSafety: { deluge: "", smokeVent: "", adaNotes: "", egressNotes: "" },
    linesetsEnabled: false,
    linesets: [],
    signoff: {
      repName: "",
      repSignedAt: "",
      contactName: "",
      contactSignedAt: "",
      reviewerName: "",
      reviewerRole: "",
      reviewerSignedAt: "",
    },
    assessmentEnabled: false,
    assessment: blankAssessment(),
    leadId: null,
    visitId: null,
  };
  const rec: Record<string, unknown> = {};
  Object.keys(def).forEach((k) => {
    const v = (partial as Record<string, unknown>)[k];
    rec[k] = v !== undefined && v !== null ? v : def[k];
  });
  return rec as SurveyDraft;
}

/** Prototype meName() fallback — callers should pass the session user's name. */
const DEFAULT_ME = "Jeff Chesebro";

/**
 * Read-time migration — the module's single migration point.
 *
 * Stage backfill from syncState (prototype ensure() migration): records
 * predating `stage` read as completed when synced, else onsite.
 *
 * Venue Assessments (D132) then folds the old flat `venueType`/`visitType`
 * forward into the class model and defaults every new sub-object. Idempotent
 * by construction: nothing here overwrites a value that is already present,
 * and no result is ever written back to the doc-store.
 *
 * #344: the rig-system copy-up, the systemsState fold and the scope seed run in
 * src/lib/survey-migrate.ts (migrateSurvey).
 */
function normalize(s: SurveyRecord): SurveyRecord {
  if (!s.stage) s.stage = s.syncState === "synced" ? "completed" : "onsite";
  // ---- Venue Assessments read-time migration (D132) ----
  if (!s.venueClass) s.venueClass = venueClassFor(s.venueType);
  if (!s.venueSubtype) s.venueSubtype = venueSubtypeFor(s.venueType);
  if (!s.visitPurpose) s.visitPurpose = visitPurposeFor(s.visitType);
  if (!s.templateRev) s.templateRev = TEMPLATE_REV;
  if (!Array.isArray(s.linesets)) s.linesets = [];
  if (typeof s.linesetsEnabled !== "boolean") {
    s.linesetsEnabled = s.venueClass === "theatre" || s.venueClass === "auditorium";
  }
  if (!s.lifeSafety) s.lifeSafety = { deluge: "", smokeVent: "", adaNotes: "", egressNotes: "" };
  if (!s.signoff) {
    s.signoff = {
      repName: "",
      repSignedAt: "",
      contactName: "",
      contactSignedAt: "",
      reviewerName: "",
      reviewerRole: "",
      reviewerSignedAt: "",
    };
  }
  if (typeof s.assessmentEnabled !== "boolean") s.assessmentEnabled = false;
  if (!s.assessment || !s.assessment.conditions) s.assessment = blankAssessment();
  migrateSurvey(s);
  return s;
}

/* ---- reads ---- */

export async function getAll(): Promise<SurveyRecord[]> {
  const list = await listDocs<SurveyRecord>("surveys");
  return list.map(normalize).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
}

export async function get(id: string): Promise<SurveyRecord | null> {
  const s = await getDoc<SurveyRecord>("surveys", id);
  return s ? normalize(s) : null;
}

export async function pending(): Promise<SurveyRecord[]> {
  const list = await listDocs<SurveyRecord>("surveys");
  return list
    .map(normalize)
    .filter((s) => s.syncState === "pending" || s.syncState === "syncing");
}

/** Surveys linked to a lead (#34) — newest first (getAll is updatedAt-desc). */
export async function surveysForLead(leadId: string): Promise<SurveyRecord[]> {
  return (await getAll()).filter((s) => (s.leadId ?? null) === leadId);
}

/* ---- mutations ---- */

export async function create(
  partial: Partial<SurveyDraft> & { id?: string; owner?: string } = {},
  me: string = DEFAULT_ME
): Promise<SurveyRecord> {
  const t = now();
  const build = (id: string): SurveyRecord => ({
    ...blank(partial),
    id,
    owner: partial.owner || me,
    requestedBy: partial.requestedBy || me,
    requestedAt: partial.requestedAt || t,
    createdAt: t,
    updatedAt: t,
    // server write is the cloud write (prototype: 'pending' until pushed)
    syncState: "synced",
    syncedAt: t,
    rev: 1,
  });
  if (partial.id) {
    const rec = build(partial.id);
    await upsertDoc("surveys", rec);
    return rec;
  }
  return insertWithPrefixedId<SurveyRecord>("surveys", "FS", 1053, build);
}

/* ---- #344 C4: one lock per survey; every write path merges file refs inside it ---- */

const surveyLockKey = (id: string) => `survey:${id}`;

/** Run `fn` holding this survey's advisory lock. Locked public functions never call each other (each has an unlocked
 *  inner helper), so no path waits on a lock its own transaction already holds. */
function withSurveyLock<T>(id: string, fn: () => Promise<T>): Promise<T> {
  return withAdvisoryLock(SURVEY_LOCK_NAMESPACE, surveyLockKey(id), fn);
}

/** The stored doc (read inside the lock) + the patch, stamped, its file slots sanitized (a client never mints a
 *  finished slot) and `mergeSurveyFileRefs` applied (a stored finished slot is never replaced). `legacyNotes` is
 *  derived on read — never stored. */
async function updateUnlocked(id: string, patch: Partial<SurveyRecord>): Promise<SurveyRecord | null> {
  return patchDoc<SurveyRecord>("surveys", id, (s) => {
    const stored = { ...s } as Record<string, unknown>;
    const t = now();
    const next = Object.assign(s, patch, {
      updatedAt: t,
      syncState: "synced" as SyncState,
      syncedAt: t,
      rev: (s.rev || 1) + 1,
    }) as Record<string, unknown>;
    delete next.legacyNotes;
    return mergeSurveyFileRefs(stored, sanitizeIncomingFileSlots(next, id, { blobEnabled: blobEnabled() })) as SurveyRecord;
  });
}

/** Content update — bumps updatedAt + rev (prototype re-dirty). Under the survey lock, merging file refs (#344 C4). */
export async function update(
  id: string,
  patch: Partial<SurveyRecord>
): Promise<SurveyRecord | null> {
  return withSurveyLock(id, () => updateUnlocked(id, patch));
}

export type SurveyFileErr = { ok: false; error: string; terminal?: true };
const fileErr = (error: string, terminal?: boolean): SurveyFileErr => (terminal ? { ok: false, error, terminal: true } : { ok: false, error });

/**
 * A survey file is uploaded (#344 C4): set its slot to `{ blobPath }` or (local dev without Blob) `{ inline }`,
 * dropping `pending` — under the survey lock, reading the stored row inside it. The rev is NOT bumped (row or doc):
 * a device's offline edit saved before the upload finished must still push cleanly (a bumped rev would make it a
 * `conflict` and the sync engine would drop the capture); the merge rule keeps the finished slot through that push,
 * and the row's `seq` (re-drawn by the 0012 BEFORE UPDATE trigger) still moves so pull carries the file. The owning
 * ref: `p_` → that photo's `file`; `m_` → the photo whose `markup.id` is that id → `markup.image`; `k_` → the
 * strokes of the markup with that hex, else of the sketch with that hex; `s_` → that sketch's `image`.
 *
 * - An already-finished slot is never replaced: `{ ok, already: true }` with the stored slot and current rev.
 * - No ref owns the file yet → retryable (the capture save may not have synced). A superseded markup's files land
 *   here too (its id owns nothing any more); the queue's 7-day limit ends them.
 * - Survey missing / deleted, a bad id, a path outside the file's own name, an inline file on a Blob deployment, a bad
 *   inline file or one past INLINE_CAPS (each, or the survey's 1.5 MB total) → `terminal`.
 */
export async function applyFinalizedSurveyFile(
  id: string,
  fileId: string,
  slot: { blobPath?: string | null; inline?: string | null },
  user: { id: string },
): Promise<{ ok: true; ref: FinishedSlot; rev: number; already?: true } | SurveyFileErr> {
  if (typeof user?.id !== "string" || !user.id) return fileErr("Unknown user");
  if (typeof id !== "string" || !/^FS-\d+$/.test(id)) return fileErr("Survey not found", true);
  if (typeof fileId !== "string" || !FILE_ID_RE.test(fileId)) return fileErr("That file isn't valid", true);
  const blobPath = typeof slot?.blobPath === "string" && slot.blobPath ? slot.blobPath : undefined;
  const inline = typeof slot?.inline === "string" && slot.inline ? slot.inline : undefined;
  return withSurveyLock(id, async () => {
    const db = await getDb();
    const t = DOC_TABLES.surveys;
    const row = (await db.select().from(t).where(eq(t.id, id)).limit(1))[0];
    if (!row || row.deleted) return fileErr("Survey not found", true);
    const s = { ...(row.doc as SurveyRecord), id };
    const rev = row.rev;
    const cur = fileSlotOf(s, fileId);
    if (cur && slotFinished(cur)) {
      return { ok: true as const, ref: cur.blobPath ? { blobPath: cur.blobPath } : { inline: cur.inline! }, rev, already: true as const };
    }
    if (!!blobPath === !!inline) return fileErr("A file needs a stored path or an inline copy, not both", true);
    if (blobPath && !filePathMatches(blobPath, id, fileId)) return fileErr("The file path isn't this file's own path in this survey", true);
    if (inline) {
      if (blobEnabled()) return fileErr("Files upload to file storage on this deployment.", true);
      const bad = inlineFileProblem(fileId, inline);
      if (bad) return fileErr(bad, true);
      if (surveyInlineTotal(s) + inline.length > INLINE_CAPS.totalPerSurvey) {
        return fileErr(`This survey already holds ${INLINE_CAPS.totalPerSurvey.toLocaleString("en-US")} characters of inline files (local dev without file storage)`, true);
      }
    }
    const folded = foldFileSlot(s, fileId, blobPath ? { blobPath } : { inline: inline! });
    if (folded.status === "missing") return fileErr("That file isn't on this survey yet");
    if (folded.status === "already") return { ok: true as const, ref: folded.slot, rev, already: true as const };
    const at = now();
    const next = { ...folded.doc, updatedAt: at, syncState: "synced" as SyncState, syncedAt: at } as SurveyRecord; // doc.rev untouched
    delete next.legacyNotes;
    // A direct write: no rev bump (patchDoc would add one). seq moves by the trigger.
    await db.update(t).set({ doc: next, updatedAt: at, receivedAt: at }).where(eq(t.id, id));
    return { ok: true as const, ref: blobPath ? { blobPath } : { inline: inline! }, rev };
  });
}

export type SurveyPushResult = {
  id: string;
  status: "ok" | "conflict" | "error" | "retry";
  rev?: number;
  server?: Record<string, unknown>;
  error?: string;
};

/**
 * /api/sync/push branch for `surveys` (#344 C4) — the generic whole-document upsert, now under the survey lock with
 * the file-ref merge: the pushed copy's file slots are sanitized first (`sanitizeIncomingFileSlots` — a finished slot
 * that isn't its own file's path in this survey, or an inline one on a Blob deployment, becomes pending); an unknown
 * id is inserted; a stale rev is a `conflict` with the server copy; otherwise the pushed doc replaces the stored one
 * EXCEPT that a stored finished file slot is never replaced (`mergeSurveyFileRefs`). `legacyNotes` is never stored. Anything thrown (a lock timeout, a database
 * error) replies `retry` so the device keeps the capture.
 */
export async function pushSurvey(rec: { id: string; rev?: number; doc: Record<string, unknown> }): Promise<SurveyPushResult> {
  const id = rec.id;
  try {
    return await withSurveyLock(id, async (): Promise<SurveyPushResult> => {
      const db = await getDb();
      const t = DOC_TABLES.surveys;
      const existing = await db.select().from(t).where(eq(t.id, id)).limit(1);
      const at = Date.now();
      // A pushed copy never mints a finished slot (only the finalize does); then a stored finished slot always wins.
      const doc: Record<string, unknown> = sanitizeIncomingFileSlots({ ...rec.doc, id }, id, { blobEnabled: blobEnabled() });
      delete doc.legacyNotes;
      if (!existing.length) {
        await db.insert(t).values({ id, doc, rev: rec.rev ?? 1, updatedAt: at, receivedAt: at, review: { state: "new" }, deleted: false });
        return { id, status: "ok", rev: rec.rev ?? 1 };
      }
      if (typeof rec.rev === "number" && rec.rev < existing[0].rev) {
        return { id, status: "conflict", rev: existing[0].rev, server: { ...(existing[0].doc as object), id } };
      }
      const merged = mergeSurveyFileRefs(existing[0].doc as Record<string, unknown>, doc);
      await db
        .update(t)
        .set({
          doc: merged,
          rev: typeof rec.rev === "number" ? sql`GREATEST(${t.rev}, ${rec.rev})` : sql`${t.rev} + 1`,
          updatedAt: at,
          receivedAt: at,
          deleted: false,
          // review deliberately untouched — server-owned
        })
        .where(eq(t.id, id));
      return { id, status: "ok", rev: rec.rev };
    });
  } catch (e) {
    console.error("[surveys] push failed; the device will retry", id, e);
    return { id, status: "retry", error: "The server couldn't save it just now; it will try again" };
  }
}

export async function setStage(
  id: string,
  stage: SurveyStage
): Promise<SurveyRecord | null> {
  return update(id, { stage });
}

export async function assign(
  id: string,
  assignedTo?: string,
  scheduledDate?: string
): Promise<SurveyRecord | null> {
  return update(id, {
    assignedTo: assignedTo || "",
    scheduledDate: scheduledDate || "",
    stage: "scheduled",
  });
}

export async function remove(id: string): Promise<void> {
  await softDeleteDoc("surveys", id);
}

/* ---- time helpers ---- */

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
