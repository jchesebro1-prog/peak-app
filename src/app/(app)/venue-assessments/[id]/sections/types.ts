/* ============================================================
 * Shared editor types. Lives outside controls.tsx so the section
 * components can import them without cycling back through the editor.
 * ============================================================ */

import type {
  MeasureField,
  MeasureGroup,
  SurveyPhoto,
  SurveyStage,
  SurveyStageMeta,
} from "@/lib/stores/surveys";
import type { DisciplineData, DisciplineKey, InventoryRow, SystemState } from "@/lib/stores/survey-intake";

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
  venueTypes: string[];
  visitTypes: string[];
  floorTypes: string[];
  liftTypes: string[];
  liftSuppliers: string[];
  installTimeframes: string[];
  conditions: string[];
  stages: Array<{ key: SurveyStage; label: string }>;
  stageMeta: Record<SurveyStage, SurveyStageMeta>;
  measureGroups: MeasureGroup[];
  measureFieldsByType: Record<string, MeasureField[]>;
  defaultMeasureFields: MeasureField[];
  /** settings-merged site-intake type catalog, keyed by category */
  intakeCatalog: Record<string, string[]>;
};

/** Local draft — the editable slice of the record plus updatedAt for display. */
export type Draft = {
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
  updatedAt: number;
};

/* ---------- field / section model ---------- */
export type FieldDef =
  | { kind: "text"; key: string; label: string; full?: boolean; type?: string; inputMode?: string; placeholder?: string }
  | { kind: "select"; key: string; label: string; options: string[]; full?: boolean; measure?: boolean }
  | { kind: "measure"; key: string; label: string; full?: boolean }
  | { kind: "toggle"; key: string; label: string; full?: boolean }
  | { kind: "textarea"; key: string; label: string; placeholder?: string }
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
);
