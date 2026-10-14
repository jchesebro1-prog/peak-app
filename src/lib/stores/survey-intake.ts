/**
 * Site Intake extension of Field Surveys — pure model module (no DB imports,
 * safe for both the server store and the client editor).
 *
 * Source: Jeff's site-intake sketch + module spec (2026-07-11, "Path B"
 * conversation; logged as IDEAS #45): a tiered general venue intake —
 * Tier 1 "kill questions" gate the discipline branches — plus four
 * discipline-specific branch forms (Rigging / Curtain / Lighting / AV).
 * Lighting and AV(audio) get structured type+quantity inventories driven by
 * an editable type catalog; Rigging and Curtain stay free-text in v1.
 * Decisions applied: soft gate (record always saveable as a draft; discipline
 * sections just stay locked until Tier 1 is complete); no pricing here — the
 * structured types are the handoff to the quote side.
 */

import type { VenueClass } from "./venue-classes";
import { CONSOLE_LOCATIONS, FIXTURE_POSITIONS, PLUG_TYPES, TRACK_OPERATIONS, type ConditionLevel } from "../field-lists";

/* ---- Tier 1: the kill questions ----
 * Venue name, contact name/email, stage width/depth, scope, and the rigging system when Rigging is in scope (#344 — contact phone is no longer a kill question).
 * Width/depth live in `measurements` under venue-type-specific keys (the
 * quick set), so completeness accepts any of the equivalent keys. */

export const TIER1_WIDTH_KEYS = [
  "proW", "roomWidth", "platformWidth", "stageWidth", "floorWidth",
  // Venue Assessments (D132) — the new classes' primary width keys. Existing
  // entries stay: old records depend on them.
  "courtWidth", "sanctuaryWidth",
];
export const TIER1_DEPTH_KEYS = [
  "stageDepth", "roomDepth", "platformDepth", "floorDepth",
  "courtLength", "sanctuaryLength",
];

/** The slice of a survey record tier-1 completeness looks at. */
export interface Tier1Slice {
  venue?: string;
  customer?: string;
  contact?: string;
  contactEmail?: string;
  contactPhone?: string;
  measurements?: Record<string, string | boolean>;
  /** #344 — the scope kill question (DisciplineKey[]); unset / empty = unanswered */
  scope?: unknown;
  disciplines?: Record<string, DisciplineData>;
}

export interface Tier1Item {
  key: string;
  label: string;
  done: boolean;
  /** where it is answered: jump to Customer & venue / Measurements, or inline on the Kill questions card */
  section: "cust" | "mQuick" | "tier1";
}

const SCOPE_DISCIPLINES = ["rigging", "curtain", "lighting", "av"];

export function tier1Items(s: Tier1Slice): Tier1Item[] {
  const m = s.measurements || {};
  const has = (keys: string[]) => keys.some((k) => String(m[k] ?? "").trim() !== "");
  const scope = Array.isArray(s.scope) ? (s.scope as unknown[]).filter((k): k is string => typeof k === "string" && SCOPE_DISCIPLINES.includes(k)) : [];
  const rigPresent = s.disciplines?.rigging?.present;
  const items: Tier1Item[] = [
    { key: "venue", label: "Venue name", done: !!(s.venue || "").trim() || !!(s.customer || "").trim(), section: "cust" },
    { key: "contact", label: "Contact name", done: !!(s.contact || "").trim(), section: "cust" },
    { key: "contactEmail", label: "Contact email", done: !!(s.contactEmail || "").trim(), section: "cust" },
    { key: "stageWidth", label: "Stage width", done: has(TIER1_WIDTH_KEYS), section: "tier1" },
    { key: "stageDepth", label: "Stage depth", done: has(TIER1_DEPTH_KEYS), section: "tier1" },
    { key: "scope", label: "Scope", done: scope.length > 0, section: "tier1" },
  ];
  if (scope.includes("rigging")) {
    items.push({ key: "rigSystem", label: "Rigging system", done: Array.isArray(rigPresent) && rigPresent.length > 0, section: "tier1" });
  }
  return items;
}

export function tier1Complete(s: Tier1Slice): boolean {
  return tier1Items(s).every((i) => i.done);
}

/* ---- Tier 2 additions (venue details) ---- */

export const AUDITORIUM_SIZES: string[] = [
  "Small (under 500 seats)",
  "Medium (500–1,000 seats)",
  "Large (1,000+ seats)",
];

/* ---- Tier 3: current state of installed systems ---- */

export interface SystemState {
  installed: "" | "yes" | "no";
  desc: string;
}

export const SYSTEM_KEYS: Array<{ key: string; label: string; hint: string }> = [
  { key: "lighting", label: "Lighting system", hint: "grid type, dimmer count, console" },
  { key: "rigging", label: "Rigging", hint: "counterweight, chain hoist, grid spacing" },
  { key: "curtain", label: "Curtain system", hint: "traveler, main, legs, condition" },
  { key: "av", label: "AV system", hint: "projector, screen, speakers, control" },
];

export function blankSystemsState(): Record<string, SystemState> {
  const o: Record<string, SystemState> = {};
  SYSTEM_KEYS.forEach((s) => {
    o[s.key] = { installed: "", desc: "" };
  });
  return o;
}

/* ---- Discipline branch forms ---- */

/** #344 — the one rigging-system answer (Kill questions; stored at disciplines.rigging.present). "None" is
 *  exclusive. Old labels map on read in src/lib/survey-migrate.ts. */
export const RIG_SYSTEMS = ["Counterweight", "Dead-hung", "Motorized", "Hemp", "Fixed points", "None"] as const;

export type DisciplineKey = "rigging" | "curtain" | "lighting" | "av";

/** One stored discipline value. #344 B2 widened it: numbers (condition levels) and plain objects keyed by a
 *  label (curtain rows at `items`, lighting position rows at `positionRows`). */
export type DisciplineValue = string | boolean | number | null | string[] | Record<string, Record<string, unknown>>;

/** One discipline's captured data: field values + a scope-of-interest list. */
export type DisciplineData = Record<string, DisciplineValue>;

/** One discipline field. `textarea` / `month` / `condition` are #344 B2 types (B4 gives them their own controls).
 *  `bind` names a measurement key the field shares its value with (one fact, two places). */
export type SystemField = {
  key: string;
  label: string;
  type?: "text" | "select" | "check" | "textarea" | "month" | "condition";
  options?: readonly string[];
  visibleFor?: VenueClass[];
  bind?: string;
  placeholder?: string;
};

/** #344 B2 — one row per ticked curtain type, at `disciplines.curtain.items[<Present label>]`. */
export type CurtainItem = {
  qty?: string;
  fabric?: string;
  oz?: string;
  trackSeries?: string;
  w?: string;
  h?: string;
  /** `null` = the rep cleared it (kept, so a migration never re-seeds it); absent = never rated */
  condition?: ConditionLevel | null;
};

/** #344 B2 — one row per chosen lighting position, at `disciplines.lighting.positionRows[<position>]`;
 *  the chosen positions are `disciplines.lighting.positionList`. */
export type PositionRow = { circuits?: string; length?: string; trim?: string; notes?: string };

/** #344 B2 — the curtain Present option that replaced "Fixed pipe". */
export const PIPES_LABEL = "Additional general purpose / scenery pipes";
/** #344 B2 — every scope list ends with it; picking it asks for `scopeOther`. */
export const SCOPE_OTHER = "Other";
/** #344 B2 — Replace vs. reuse moved to Final questions; its options stay here. */
export const REPLACE_VS_REUSE_OPTIONS: readonly string[] = ["Replace", "Reuse", "Mixed", "TBD"];

export interface DisciplineGroup {
  key: DisciplineKey;
  title: string;
  subtitle: string;
  presentOptions: string[];
  presentOptionsByClass: Partial<Record<VenueClass, string[]>>;
  fields: SystemField[]; // reuses the editor's field renderer shapes
  scopeLabel: string;
  scopeOptions: string[];
  /** inventory sections captured for this discipline (Lighting/AV only in v1) */
  inventories: Array<{ category: string; label: string }>;
}

export const DISCIPLINE_GROUPS: DisciplineGroup[] = [
  {
    key: "rigging",
    title: "Rigging intake",
    subtitle: "Load calculations, grid analysis, hoist evaluation",
    presentOptions: [...RIG_SYSTEMS],
    presentOptionsByClass: {},
    fields: [
      { key: "gridPresent", label: "Existing grid", type: "check" },
      { key: "gridType", label: "Grid construction & spacing" },
      { key: "gridHeight", label: "Grid height", bind: "gridH" },
      { key: "loadPoints", label: "Load-bearing points (SR / SL / center)" },
      { key: "counterweightNotes", label: "Rail condition, capacity, age" },
      { key: "chainHoists", label: "Chain hoists (brand, capacity, age)" },
      { key: "deckLoad", label: "Deck load capacity (lbs/sqft)" },
      { key: "flyType", label: "Fly system type", visibleFor: ["auditorium"] },
      { key: "battenLength", label: "Batten length", visibleFor: ["auditorium"] },
      { key: "arborCapacity", label: "Arbor / motor capacity", visibleFor: ["auditorium"] },
      { key: "gridBlockCondition", label: "Grid / block condition", visibleFor: ["auditorium"] },
      { key: "hempLineCondition", label: "Hemp line condition", visibleFor: ["auditorium"] },
      { key: "motorControl", label: "Motor control", visibleFor: ["auditorium"] },
      { key: "loadingGalleryNotes", label: "Loading gallery notes", visibleFor: ["auditorium"], bind: "loadingGallery" },
      { key: "fireCurtainPresent", label: "Fire curtain present", type: "check", visibleFor: ["auditorium"] },
      { key: "fireCurtainRating", label: "Fire curtain rating", visibleFor: ["auditorium"] },
      { key: "releaseMechanism", label: "Release mechanism", visibleFor: ["auditorium"] },
      { key: "fireCurtainLastInspection", label: "Fire curtain last inspection", visibleFor: ["auditorium"] },
    ],
    scopeLabel: "Rigging scope of interest",
    scopeOptions: ["New grid", "System refurbish", "Add hoists", "Capacity upgrade", "Inspection only", SCOPE_OTHER],
    inventories: [],
  },
  {
    key: "curtain",
    title: "Curtain intake",
    subtitle: "Drapery, masking, flame-test & replacement planning",
    presentOptions: ["Divider curtain", "Track — straight", "Track — curved", PIPES_LABEL, "Wall bracket", "Cyc / backdrop", "None"],
    presentOptionsByClass: {
      auditorium: ["Main / act curtain", "Grand drape", "Traveler", "Teaser / tormentors", "Legs", "Borders", "Cyc / scrim", "None"],
    },
    /* #344 B2: removed defs (maskingNeeds, mainCondition, legsBorders, fabricColor, fabricWeightOz, finishedWH, condition,
       trackSeries, pipeDiameter, mounting, operation, legsQtyPairs, bordersQty, cycScrimFabric) keep their stored values —
       src/lib/survey-migrate.ts folds them into curtain rows or Older notes. replaceVsReuse moved to Final questions. */
    fields: [
      { key: "prosHeightToGrid", label: "Proscenium height to grid" },
      {
        key: "travelerCondition",
        label: "Traveler rod condition",
        type: "select",
        options: ["Good", "Fair", "Needs replacement"],
      },
      { key: "trackOperation", label: "Track operation", type: "select", options: TRACK_OPERATIONS },
      { key: "fixedPipeQty", label: "Additional general purpose / scenery pipes (qty)" },
      { key: "pipeTrackLengths", label: "Pipe / track lengths", type: "textarea" },
      { key: "heightAboveFloor", label: "Height above floor" },
      { key: "loadCapacity", label: "Load capacity per position" },
      { key: "curtainType", label: "Curtain type", visibleFor: ["auditorium"] },
      { key: "lastFlameTest", label: "Last flame test", type: "month" },
    ],
    scopeLabel: "Curtain scope of interest",
    scopeOptions: ["Single curtain replacement", "Single set replacement", "Flame test", "Full curtain replacement", SCOPE_OTHER],
    inventories: [],
  },
  {
    key: "lighting",
    title: "Lighting intake",
    subtitle: "Rig assessment, circuits, console — with fixture inventory",
    presentOptions: ["Theatrical lighting", "House lighting", "Work lights", "Portable fixtures", "None"],
    presentOptionsByClass: {},
    fields: [
      { key: "consoleMfr", label: "Console manufacturer / model" },
      { key: "consoleLocation", label: "Console location", type: "select", options: CONSOLE_LOCATIONS },
      { key: "installYear", label: "Install year" },
      { key: "controls", label: "Architectural control — manufacturer / model" },
      {
        key: "controlProtocol",
        label: "Control protocol",
        type: "select",
        options: ["DMX", "Networked (sACN / Art-Net)", "Analog", "Mixed", "Unknown"],
      },
      { key: "dimmerRack", label: "Dimmer / relay rack location + capacity", visibleFor: ["auditorium"] },
      { key: "dmxUniverses", label: "DMX universes / protocol", visibleFor: ["auditorium"] },
      { key: "followSpotBooth", label: "Follow-spot booth", visibleFor: ["auditorium"] },
      { key: "electricalService", label: "Panel power feeds & locations" },
      { key: "plugType", label: "Plug type", type: "select", options: PLUG_TYPES },
      /* #344 B2: removed defs fixtureQty, fixtureTypes, positions, fohPositions, console, circuitAccess keep their stored
         values as Older notes. consoleLocationOther, positionList and positionRows have dedicated UI, not defs. */
    ],
    scopeLabel: "Lighting scope of interest",
    scopeOptions: ["New rig", "Controls upgrade", "Fixture replacement", "Console upgrade", "Full system audit", SCOPE_OTHER],
    inventories: [
      { category: "lighting.fixture", label: "Fixtures" },
      { category: "lighting.infrastructure", label: "Infrastructure" },
    ],
  },
  {
    key: "av",
    title: "AV intake",
    subtitle: "Audio focus in v1 — with device inventory",
    presentOptions: ["Sound reinforcement", "Paging", "Projection / video", "Recording / streaming", "None"],
    presentOptionsByClass: {},
    fields: [
      { key: "soundMfr", label: "PA / sound manufacturer" },
      { key: "speakerLocationsQty", label: "Speaker locations / quantity" },
      { key: "micPagingInputs", label: "Microphone / paging inputs" },
      { key: "conditionLevel", label: "Condition", type: "condition" },
      { key: "electricalPanelLocation", label: "Electrical panel location" },
      { key: "spareBreakerCapacity", label: "Spare breaker capacity" },
      { key: "companySwitch", label: "Company switch / generator tie-in" },
      { key: "networkCoverage", label: "Network / wifi coverage" },
      { key: "controlInfra", label: "How lights / curtains / AV are controlled today" },
      { key: "networkWifi", label: "Network / wifi quality (stage area)" },
      { key: "broadcast", label: "Broadcast / recording needs" },
    ],
    scopeLabel: "AV scope of interest",
    scopeOptions: [
      "New projector",
      "New screen",
      "Speaker upgrade",
      "Unified control",
      "Streaming capability",
      "Acoustic treatment",
      SCOPE_OTHER,
    ],
    inventories: [
      { category: "audio.device", label: "Audio devices" },
      { category: "audio.infrastructure", label: "Audio infrastructure" },
    ],
  },
];

export function presentOptionsFor(key: DisciplineKey, cls: VenueClass): string[] {
  const group = DISCIPLINE_GROUPS.find((item) => item.key === key);
  if (!group) return [];
  return group.presentOptionsByClass[cls] || group.presentOptions;
}

export function visibleFields(group: DisciplineGroup, cls: VenueClass): SystemField[] {
  return group.fields.filter((field) => !field.visibleFor || field.visibleFor.includes(cls));
}

/* ---- Structured inventory (type + quantity + flag rows) ---- */

export interface InventoryRow {
  id: string;
  discipline: DisciplineKey;
  /** catalog section, e.g. "lighting.fixture" */
  category: string;
  type: string;
  quantity: string; // free string — "12", "~20"
  flag: boolean; // rep flag — needs attention / replace / verify
  notes: string;
  /** #344 B2 — lighting fixture position (FIXTURE_POSITIONS) */
  position?: string;
}

/** #344 B4 — a fixture row's quantity when it is a plain number ("12", " 3 ", "2.5"); "~20" / "" are not. */
function countableQty(q: string): number | null {
  const t = String(q ?? "").trim();
  return /^\d+(?:\.\d+)?$/.test(t) ? Number(t) : null;
}

/** #344 B4 — fixture totals per position (pass the `lighting.fixture` rows): numeric quantities summed, listed
 *  positions in FIXTURE_POSITIONS order, then any other stored position in first-seen order. Rows without a
 *  position or a numeric qty are left out (see fixtureTotalsExcluded). */
export function fixtureTotals(rows: InventoryRow[]): Array<{ position: string; qty: number }> {
  const sums = new Map<string, number>();
  for (const row of rows) {
    const pos = String(row.position ?? "").trim();
    const qty = countableQty(row.quantity);
    if (!pos || qty == null) continue;
    sums.set(pos, (sums.get(pos) ?? 0) + qty);
  }
  const listed = FIXTURE_POSITIONS.filter((p) => sums.has(p));
  const other = [...sums.keys()].filter((p) => !FIXTURE_POSITIONS.includes(p));
  return [...listed, ...other].map((position) => ({ position, qty: sums.get(position) as number }));
}

/** #344 B4 — rows with a quantity that fixtureTotals could not count (no position, or not a plain number). */
export function fixtureTotalsExcluded(rows: InventoryRow[]): number {
  return rows.filter((row) => String(row.quantity ?? "").trim() !== "" && (!String(row.position ?? "").trim() || countableQty(row.quantity) == null)).length;
}

/** Default type catalog (spec's Fixture Type Catalog). Editable in Settings —
 * stored settings override per category; "Other" always allowed. These
 * standardized types are the join key to the quote side. */
export const DEFAULT_INTAKE_CATALOG: Record<string, string[]> = {
  "lighting.fixture": [
    "Ellipsoidal",
    "PAR",
    "Fresnel",
    "Moving light",
    "Downlight",
    "Strip light",
    "Cyc light",
    "Other",
  ],
  "lighting.infrastructure": [
    "Dimmer",
    "Console",
    "Gobos",
    "Color filters",
    "Cables",
    "Rigging hardware",
    "Other",
  ],
  "audio.device": [
    "Speaker",
    "Microphone",
    "Subwoofer",
    "Amplifier",
    "Mixer",
    "Wireless receiver",
    "Monitor wedge",
    "Other",
  ],
  "audio.infrastructure": [
    "Cables",
    "Networking",
    "Control console",
    "Wireless system",
    "Distribution amp",
    "Other",
  ],
};

export function mergedCatalog(stored?: Record<string, string[]> | null): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  Object.keys(DEFAULT_INTAKE_CATALOG).forEach((k) => {
    const s = stored?.[k];
    out[k] = Array.isArray(s) && s.length ? s : DEFAULT_INTAKE_CATALOG[k];
  });
  return out;
}

/* ---- Intake status (spec lifecycle, derived from the data) ----
 * draft → general-complete → discipline-added → ready-for-quote.
 * The first three derive from completeness; ready-for-quote is an explicit
 * flag the user sets once a discipline is captured. */

export type IntakeStatus = "draft" | "general-complete" | "discipline-added" | "ready-for-quote";

export interface IntakeSlice extends Tier1Slice {
  disciplines?: Record<string, DisciplineData>;
  disciplinesActive?: string[];
  inventory?: InventoryRow[];
  intakeReady?: boolean;
}

export function disciplineHasData(d: DisciplineData | undefined, inv: InventoryRow[], key: string): boolean {
  if (inv.some((r) => r.discipline === key)) return true;
  if (!d) return false;
  return Object.values(d).some((v) =>
    Array.isArray(v)
      ? v.length > 0
      : typeof v === "boolean"
        ? v
        : typeof v === "number"
          ? Number.isFinite(v)
          : v && typeof v === "object"
            ? Object.keys(v).length > 0
            : String(v ?? "").trim() !== ""
  );
}

export function intakeStatus(s: IntakeSlice): IntakeStatus {
  if (!tier1Complete(s)) return "draft";
  const inv = s.inventory || [];
  // #344: Rigging's `present` is the Kill questions' rigging-system answer now, not intake data.
  const added = DISCIPLINE_GROUPS.some((g) => {
    let d = s.disciplines?.[g.key];
    if (g.key === "rigging" && d) {
      d = { ...d };
      delete d.present;
    }
    return disciplineHasData(d, inv, g.key);
  });
  if (!added) return "general-complete";
  return s.intakeReady ? "ready-for-quote" : "discipline-added";
}

export const INTAKE_STATUS_META: Record<IntakeStatus, { label: string; ink: string; soft: string; bd: string }> = {
  draft: { label: "Intake: draft", ink: "#8c919c", soft: "#f1f2f5", bd: "#e4e7ec" },
  "general-complete": { label: "Intake: general complete", ink: "#3155a8", soft: "#e9eefb", bd: "#d4ddf3" },
  "discipline-added": { label: "Intake: discipline added", ink: "#7b3f8a", soft: "#f3eaf5", bd: "#e6d3ea" },
  "ready-for-quote": { label: "Ready for quote", ink: "#1f7a52", soft: "#eaf6ef", bd: "#cce9da" },
};

let invSeq = 0;
export function newInventoryId(): string {
  invSeq += 1;
  return "inv" + Date.now().toString(36) + invSeq.toString(36);
}
