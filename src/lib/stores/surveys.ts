import {
  getDoc,
  insertWithPrefixedId,
  listDocs,
  patchDoc,
  softDeleteDoc,
  upsertDoc,
} from "@/db/doc-store";
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

/** Content update — bumps updatedAt + rev (prototype re-dirty). */
export async function update(
  id: string,
  patch: Partial<SurveyRecord>
): Promise<SurveyRecord | null> {
  return patchDoc<SurveyRecord>("surveys", id, (s) => {
    Object.assign(s, patch, {
      updatedAt: now(),
      syncState: "synced" as SyncState,
      syncedAt: now(),
      rev: (s.rev || 1) + 1,
    });
  });
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
