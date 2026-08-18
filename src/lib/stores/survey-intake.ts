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

import type { MeasureField } from "./surveys";
import type { VenueClass } from "./venue-classes";

/* ---- Tier 1: the kill questions ----
 * Venue name, contact name/email/phone, stage width, stage depth.
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
}

export interface Tier1Item {
  key: string;
  label: string;
  done: boolean;
  /** editor section to jump to when missing */
  section: "cust" | "mQuick";
}

export function tier1Items(s: Tier1Slice): Tier1Item[] {
  const m = s.measurements || {};
  const has = (keys: string[]) => keys.some((k) => String(m[k] ?? "").trim() !== "");
  return [
    { key: "venue", label: "Venue name", done: !!(s.venue || "").trim() || !!(s.customer || "").trim(), section: "cust" },
    { key: "contact", label: "Contact name", done: !!(s.contact || "").trim(), section: "cust" },
    { key: "contactEmail", label: "Contact email", done: !!(s.contactEmail || "").trim(), section: "cust" },
    { key: "contactPhone", label: "Contact phone", done: !!(s.contactPhone || "").trim(), section: "cust" },
    { key: "stageWidth", label: "Stage width", done: has(TIER1_WIDTH_KEYS), section: "mQuick" },
    { key: "stageDepth", label: "Stage depth", done: has(TIER1_DEPTH_KEYS), section: "mQuick" },
  ];
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

export type DisciplineKey = "rigging" | "curtain" | "lighting" | "av";

/** One discipline's captured data: field values + a scope-of-interest list. */
export type DisciplineData = Record<string, string | boolean | string[]>;

export interface SystemField extends MeasureField {
  visibleFor?: VenueClass[];
}

export interface DisciplineGroup {
  key: DisciplineKey;
  title: string;
  subtitle: string;
  fields: SystemField[]; // reuses the editor's field renderer shapes
  presentOptions: string[];
  presentOptionsByClass: Partial<Record<VenueClass, string[]>>;
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
    presentOptions: ["Grid", "Dead-hung pipe", "Counterweight", "Motorized hoists", "None"],
    presentOptionsByClass: {},
    fields: [
      { key: "gridPresent", label: "Existing grid", type: "check" },
      { key: "gridType", label: "Grid construction & spacing" },
      { key: "gridHeight", label: "Grid height" },
      { key: "loadPoints", label: "Load-bearing points (SR / SL / center)" },
      { key: "counterweight", label: "Counterweight system", type: "check" },
      { key: "counterweightNotes", label: "Rail condition, capacity, age" },
      { key: "chainHoists", label: "Chain hoists (brand, capacity, age)" },
      { key: "deckLoad", label: "Deck load capacity (lbs/sqft)" },
      { key: "battenCount", label: "Batten count" },
      { key: "flyType", label: "Fly system type", visibleFor: ["auditorium"] },
      { key: "linesetCount", label: "Lineset count", visibleFor: ["auditorium"] },
      { key: "battenLength", label: "Batten length", visibleFor: ["auditorium"] },
      { key: "arborCapacity", label: "Arbor / motor capacity", visibleFor: ["auditorium"] },
      { key: "gridBlockCondition", label: "Grid block condition", visibleFor: ["auditorium"] },
      { key: "hempLineCondition", label: "Hemp line condition", visibleFor: ["auditorium"] },
      { key: "motorControl", label: "Motor control", visibleFor: ["auditorium"] },
      { key: "loadingGalleryNotes", label: "Loading gallery notes", visibleFor: ["auditorium"] },
      { key: "fireCurtainPresent", label: "Fire curtain present", visibleFor: ["auditorium"] },
      { key: "fireCurtainRating", label: "Fire curtain rating", visibleFor: ["auditorium"] },
      { key: "releaseMechanism", label: "Release mechanism", visibleFor: ["auditorium"] },
      { key: "fireCurtainLastInspection", label: "Fire curtain last inspection", visibleFor: ["auditorium"] },
    ],
    scopeLabel: "Rigging scope of interest",
    scopeOptions: ["New grid", "Grid refurbish", "Add hoists", "Capacity upgrade", "Inspection only"],
    inventories: [],
  },
  {
    key: "curtain",
    title: "Curtain intake",
    subtitle: "Drapery, masking, flame-test & replacement planning",
    presentOptions: ["Divider curtain", "Track — straight", "Track — curved", "Fixed pipe", "Wall bracket", "Cyc / backdrop", "None"],
    presentOptionsByClass: { auditorium: ["Main / act curtain", "Grand drape", "Traveler", "Teaser / tormentors", "Legs", "Borders", "Cyc / scrim", "None"] },
    fields: [
      { key: "maskingNeeds", label: "Masking needed (legs, borders, cyc, traveler)" },
      { key: "mainCondition", label: "Main curtain (type, material, age, condition)" },
      { key: "legsBorders", label: "Legs & borders (count, condition, color)" },
      { key: "prosHeightToGrid", label: "Proscenium height to grid" },
      {
        key: "travelerCondition",
        label: "Traveler rod condition",
        type: "select",
        options: ["Good", "Fair", "Needs replacement"],
      },
      { key: "lastFlameTest", label: "Last flame test (date, if known)" },
      { key: "fabricColor", label: "Fabric / colour" }, { key: "fabricWeight", label: "Weight (oz)" },
      { key: "finishedWH", label: "Finished W × H" }, { key: "softGoodsCondition", label: "Condition" },
      { key: "trackSeries", label: "Track series" }, { key: "trackOperation", label: "Track operation" },
      { key: "fixedPipeQty", label: "Fixed pipe quantity" }, { key: "pipeDia", label: "Pipe diameter" },
      { key: "mounting", label: "Mounting" }, { key: "heightAboveFloor", label: "Height above floor" },
      { key: "loadCapacity", label: "Load capacity per position" },
      {
        key: "replaceVsReuse",
        label: "Replace vs. reuse",
        type: "select",
        options: ["Replace", "Reuse", "Mixed", "TBD"],
      },
    ],
    scopeLabel: "Curtain scope of interest",
    scopeOptions: ["New main", "New legs / borders", "Traveler replacement", "Flame test", "Full masking upgrade"],
    inventories: [],
  },
  {
    key: "lighting",
    title: "Lighting intake",
    subtitle: "Rig assessment, circuits, console — with fixture inventory",
    presentOptions: ["Console", "Dimmers / relays", "Fixtures", "House lighting", "None"],
    presentOptionsByClass: {},
    fields: [
      {
        key: "controlProtocol",
        label: "Control protocol",
        type: "select",
        options: ["DMX", "Networked (sACN / Art-Net)", "Analog", "Mixed", "Unknown"],
      },
      { key: "electricalService", label: "Electrical service (amperage, spare circuits)" },
      { key: "console", label: "Control console (brand, model, age)" },
      {
        key: "circuitAccess",
        label: "Circuit accessibility",
        type: "select",
        options: ["Good", "Fair", "Poor"],
      },
      { key: "consoleMfr", label: "Console mfr / model" }, { key: "consoleLocation", label: "Console location" },
      { key: "fixtureQty", label: "Fixture quantity (est.)" }, { key: "installYear", label: "Install year" },
      { key: "fixtureTypes", label: "Fixture types" }, { key: "positions", label: "Positions" }, { key: "controls", label: "Controls" },
      { key: "dimmerRack", label: "Dimmer / relay rack location + capacity", visibleFor: ["auditorium"] },
      { key: "dmxUniverses", label: "DMX universes / protocol", visibleFor: ["auditorium"] },
      { key: "fohPositions", label: "FOH positions", visibleFor: ["auditorium"] },
      { key: "followSpotBooth", label: "Follow-spot booth", visibleFor: ["auditorium"] },
    ],
    scopeLabel: "Lighting scope of interest",
    scopeOptions: ["New rig", "Dimmer upgrade", "Fixture replacement", "Console upgrade", "Full system audit"],
    inventories: [
      { category: "lighting.fixture", label: "Fixtures" },
      { category: "lighting.infrastructure", label: "Infrastructure" },
    ],
  },
  {
    key: "av",
    title: "AV intake",
    subtitle: "Audio focus in v1 — with device inventory",
    presentOptions: ["PA / sound", "Paging", "Network / Wi-Fi", "Electrical service", "None"],
    presentOptionsByClass: {},
    fields: [
      { key: "controlInfra", label: "How lights / curtains / AV are controlled today" },
      { key: "networkWifi", label: "Network / wifi quality (stage area)" },
      { key: "broadcast", label: "Broadcast / recording needs" },
      { key: "soundMfr", label: "PA / sound mfr" }, { key: "speakerLocations", label: "Speaker locations / quantity" },
      { key: "micPagingInputs", label: "Mic / paging inputs" }, { key: "avCondition", label: "Condition" },
      { key: "panelLocation", label: "Electrical panel location" }, { key: "spareBreakerCapacity", label: "Spare breaker capacity" },
      { key: "companySwitch", label: "Company switch / generator tie-in" }, { key: "networkCoverage", label: "Network / Wi-Fi coverage" },
    ],
    scopeLabel: "AV scope of interest",
    scopeOptions: [
      "New projector",
      "New screen",
      "Speaker upgrade",
      "Unified control",
      "Streaming capability",
      "Acoustic treatment",
    ],
    inventories: [
      { category: "audio.device", label: "Audio devices" },
      { category: "audio.infrastructure", label: "Audio infrastructure" },
    ],
  },
];

export function presentOptionsFor(key: DisciplineKey, cls: VenueClass): string[] {
  const group = DISCIPLINE_GROUPS.find((entry) => entry.key === key);
  return group?.presentOptionsByClass[cls] || group?.presentOptions || [];
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
    Array.isArray(v) ? v.length > 0 : typeof v === "boolean" ? v : String(v ?? "").trim() !== ""
  );
}

export function intakeStatus(s: IntakeSlice): IntakeStatus {
  if (!tier1Complete(s)) return "draft";
  const inv = s.inventory || [];
  const added = DISCIPLINE_GROUPS.some((g) => disciplineHasData(s.disciplines?.[g.key], inv, g.key));
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
