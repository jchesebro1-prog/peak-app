/* ============================================================
 * Shared editor types. Lives outside controls.tsx so the section
 * components can import them without cycling back through the editor.
 * ============================================================ */

import type {
  MeasureGroup,
  SurveyPhoto,
  SurveyStage,
  SurveyStageMeta,
} from "@/lib/stores/surveys";
import type { VenueClass } from "@/lib/stores/venue-classes";
import type { DisciplineData, DisciplineKey, InventoryRow, SystemState } from "@/lib/stores/survey-intake";
import type { LinesetRow } from "@/lib/stores/linesets";
import type { AssessmentData } from "@/lib/stores/assessment";
import type { InspectionRef } from "@/lib/stores/assessment";

/* ============================================================
 * Serializable props from the server. The store is DB-backed and cannot be
 * imported into a client bundle — its pure meta/option-lists are handed over
 * here, and the pure helpers below operate on them.
 * ============================================================ */

export type EditorCustomer = {
  id: string;
  name: string;
  type: string;
  location: string;
  locations: Array<{ id: string; label: string; primary: boolean; city: string; state: string }>;
  primaryContact: { name: string; email: string } | null;
};

export type EditorMeta = {
  floorTypes: string[];
  liftTypes: string[];
  liftSuppliers: string[];
  installTimeframes: string[];
  conditions: string[];
  stages: Array<{ key: SurveyStage; label: string }>;
  stageMeta: Record<SurveyStage, SurveyStageMeta>;
  measureGroups: MeasureGroup[];
  /** settings-merged site-intake type catalog, keyed by category */
  intakeCatalog: Record<string, string[]>;
  autoCerts?: Record<string, InspectionRef>;
};

/** Local draft — the editable slice of the record plus updatedAt for display. */
export type Draft = {
  customer: string;
  customerId: string | null;
  locationId: string | null;
  venue: string;
  /** derived from venueClass on save — no longer an input (D132) */
  venueType: string;
  venueClass: VenueClass;
  venueSubtype: string;
  address: string;
  contact: string;
  contactPhone: string;
  contactEmail: string;
  /** legacy — read by the migration, never written from the editor (D132) */
  visitType: string;
  visitPurpose: string;
  reason: string;
  travelTime: string;
  distance: string;
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
  // ---- site-visit sheet additions (D132) ----
  loadingDoorSize: string;
  liftHeight: string;
  pathToFloor: string;
  workingHours: string;
  blackoutDates: string;
  floorProtection: string;
  badgingRequired: string;
  firstImpressions: string;
  budget: string;
  fiscalYearSpendBy: string;
  whoDecides: string;
  targetInstallWindow: string;
  lifeSafety: { deluge: string; smokeVent: string; adaNotes: string; egressNotes: string };
  scopeOfWork: string;
  quoteLook: string;
  notes: string;
  stage: SurveyStage;
  assignedTo: string;
  scheduledDate: string;
  requestedBy: string;
  measurements: Record<string, string | boolean>;
  conditions: string[];
  photos: SurveyPhoto[];
  // Site Intake extension (IDEAS #45)
  auditoriumSize: string;
  yearBuilt: string;
  systemsState: Record<string, SystemState>;
  disciplines: Record<string, DisciplineData>;
  disciplinesActive: string[];
  inventory: InventoryRow[];
  intakeReady: boolean;
  linesetsEnabled: boolean;
  linesets: LinesetRow[];
  assessmentEnabled: boolean;
  assessment: AssessmentData;
  signoff: { repName: string; repSignedAt: string; contactName: string; contactSignedAt: string; reviewerName: string; reviewerRole: string; reviewerSignedAt: string };
  templateRev: string;
  updatedAt: number;
};

/* ---------- field / section model ---------- */

/** Draft keys holding a flat string sub-object, addressable by `kind: "sub"`. */
export type SubObjKey = "lifeSafety";
export type FieldDef =
  | { kind: "text"; key: string; label: string; full?: boolean; type?: string; inputMode?: string; placeholder?: string }
  | { kind: "select"; key: string; label: string; options: string[]; full?: boolean; measure?: boolean }
  | { kind: "measure"; key: string; label: string; full?: boolean }
  | { kind: "toggle"; key: string; label: string; full?: boolean }
  | { kind: "textarea"; key: string; label: string; placeholder?: string }
  /** text input bound to a key inside a draft sub-object (e.g. lifeSafety) */
  | { kind: "sub"; obj: SubObjKey; key: string; label: string; full?: boolean; placeholder?: string }
  | { kind: "checkTop"; key: string; label: string }
  | { kind: "checkMeasure"; key: string; label: string };

export type SectionDef = {
  id: string;
  title: string;
  subtitle: string;
  group: "brief" | "field" | "intake";
  step: number;
  advanced?: boolean;
} & (
  | { kind: "custvenue" }
  | { kind: "fields"; fields: FieldDef[] }
  | { kind: "conditions" }
  | { kind: "photos" }
  | { kind: "viz3d" }
  | { kind: "tier1" }
  | { kind: "systems" }
  | { kind: "discipline"; disc: DisciplineKey }
  | { kind: "linesets" }
  | { kind: "assessment" }
  | { kind: "signoff" }
);
