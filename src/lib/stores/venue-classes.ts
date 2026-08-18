/**
 * Venue classification for Venue Assessments (D132, 2026-08-18).
 *
 * The five paper site-visit sheets — Theatre (Rev. 3.0), Auditorium, Church
 * (Rev. 2.1), Convention Center (Rev. 2.1), Gym (Rev. 5.1) — are each
 * organized around a venue class, and each carries its own "<VENUE> TYPE"
 * checkbox row. This module is the app's port of that structure: the class
 * drives which measurement set and which systems fields appear; the subtype
 * is that class's own checkbox options, verbatim off the sheet.
 *
 * Pure module — no DB imports, safe for both the server store and the client
 * editor (same contract as survey-intake.ts).
 *
 * Migration: the module previously keyed off a flat seven-value `venueType`.
 * Those values map forward here and are applied on read in surveys.ts
 * normalize(), never as a stored rewrite.
 */

import type { MeasureField } from "./surveys";

export type VenueClass =
  | "theatre" | "auditorium" | "church" | "gym" | "convention" | "other";

export const VENUE_CLASSES: Array<{ key: VenueClass; label: string; blurb: string }> = [
  { key: "theatre", label: "Theatre", blurb: "Dead-hung / fixed-pipe, no fly system" },
  { key: "auditorium", label: "Auditorium", blurb: "Fly system present or to be confirmed on site" },
  { key: "church", label: "Church", blurb: "Worship space" },
  { key: "gym", label: "Gym", blurb: "Small venue class" },
  { key: "convention", label: "Convention Center", blurb: "Open, flexible space — no fixed stage" },
  { key: "other", label: "Other", blurb: "Outdoor, arena, or anything without a sheet" },
];

/** Each class's own "<VENUE> TYPE" checkbox row, verbatim off the sheet. */
export const SUBTYPES: Record<VenueClass, string[]> = {
  theatre: [
    "Single proscenium", "Black box / flexible", "Thrust / arena",
    "Studio theatre", "Multi-purpose (has fly system)", "Other",
  ],
  auditorium: [
    "Single proscenium", "Thrust / arena", "Multi-purpose (cafetorium)",
    "Black box / flexible", "Other",
  ],
  church: [
    "Sanctuary — traditional", "Sanctuary — contemporary",
    "Multi-purpose / fellowship hall", "Chapel", "Divisible worship space", "Other",
  ],
  gym: [
    "Single court", "Divisible — 2 court", "Divisible — 3 court",
    "Practice / aux gym", "Wrestling room", "Multi-purpose (has stage)", "Other",
  ],
  convention: [
    "Meeting room", "Ballroom / multi-purpose", "Divisible space",
    "Courtroom / assembly room", "Exhibit / flex hall", "Other",
  ],
  other: [],
};

/** PURPOSE OF VISIT, from the sheets. Replaces the app's VISIT_TYPES. */
export const VISIT_PURPOSES: string[] = [
  "New system design", "Bid walk", "Repair / service",
  "Annual inspection", "Punch list", "Other",
];

/* ---- migration maps (spec §Migration strategy) ---- */

const CLASS_BY_VENUE_TYPE: Record<string, VenueClass> = {
  "Proscenium theater": "theatre",
  "Black box": "theatre",
  "Worship / sanctuary": "church",
  "Gymnasium / gym stage": "gym",
  Arena: "theatre",
  "Multipurpose room": "convention",
  "Outdoor / amphitheater": "other",
};

const SUBTYPE_BY_VENUE_TYPE: Record<string, string> = {
  "Proscenium theater": "Single proscenium",
  "Black box": "Black box / flexible",
  "Worship / sanctuary": "Sanctuary — traditional",
  "Gymnasium / gym stage": "Multi-purpose (has stage)",
  Arena: "Thrust / arena",
  "Multipurpose room": "Ballroom / multi-purpose",
  "Outdoor / amphitheater": "",
};

const PURPOSE_BY_VISIT_TYPE: Record<string, string> = {
  "Initial site survey": "New system design",
  "Budgetary walk-through": "Bid walk",
  "Design verification": "New system design",
  "Punch / follow-up": "Punch list",
  "Service call": "Repair / service",
};

/** Unknown and empty both fall back to theatre — the app's original default
 *  venue type was "Proscenium theater", the first VENUE_TYPES entry. */
export function venueClassFor(venueType: string | undefined): VenueClass {
  return CLASS_BY_VENUE_TYPE[venueType || ""] || "theatre";
}

export function venueSubtypeFor(venueType: string | undefined): string {
  const hit = SUBTYPE_BY_VENUE_TYPE[venueType || ""];
  return hit === undefined ? "" : hit;
}

export function visitPurposeFor(visitType: string | undefined): string {
  if (!visitType) return "";
  return PURPOSE_BY_VISIT_TYPE[visitType] || "";
}

/** Local copy of surveys.ts BOOTH_LOCATIONS — value-imported from surveys.ts
 *  would cycle, since surveys.ts imports this module. Keep the two in sync. */
const BOOTH_LOCATIONS_REF: string[] = [
  "Rear of house — center", "Rear of house — left", "Rear of house — right",
  "Balcony", "Floor / portable", "None",
];

/* ---- per-class measurement field sets ----
 * Labels are the sheets' labels. Keys reuse the existing module's keys
 * wherever the dimension is the same — see the plan's Global Constraints. */

const THEATRE_FIELDS: MeasureField[] = [
  { key: "proW", label: "Proscenium width" },
  { key: "proH", label: "Proscenium height" },
  { key: "stageDepth", label: "Stage depth (plaster line–back wall)" },
  { key: "wingSL", label: "Wing space — SL" },
  { key: "wingSR", label: "Wing space — SR" },
  { key: "gridH", label: "Grid / ceiling height over stage" },
  { key: "apron", label: "Apron / forestage depth" },
  { key: "structure", label: "Structure at grid (steel/joist/deck)" },
  { key: "clearSpan", label: "Clear span or columns?" },
  { key: "floorCondition", label: "Floor type & condition" },
  { key: "houseH", label: "House ceiling height" },
  { key: "obstructions", label: "Obstructions (house curtain, HVAC, catwalks)" },
];

const AUDITORIUM_FIELDS: MeasureField[] = [
  { key: "proW", label: "Proscenium width" },
  { key: "proH", label: "Proscenium height" },
  { key: "stageDepth", label: "Stage depth (plaster line–back wall)" },
  { key: "wingSL", label: "Wing space — SL" },
  { key: "wingSR", label: "Wing space — SR" },
  { key: "gridH", label: "Grid height over stage (to loft blocks)" },
  { key: "trimHigh", label: "High trim" },
  { key: "trimLow", label: "Low trim" },
  { key: "apron", label: "Apron / forestage depth" },
  { key: "loadingGallery", label: "Loading gallery — location / height" },
  { key: "structure", label: "Structure at grid (steel/joist/deck)" },
  { key: "clearSpan", label: "Clear span or columns?" },
  { key: "floorCondition", label: "Floor type & condition" },
  { key: "houseH", label: "House ceiling height" },
  { key: "pinRail", label: "Pin rail / locking rail location" },
  { key: "obstructions", label: "Obstructions (house curtain, HVAC, catwalks)" },
  { key: "seating", label: "Seating capacity" },
  { key: "seatingConfig", label: "Seating config / rake" },
  { key: "pitDesc", label: "Orchestra pit? — type / size / lift" },
  { key: "boothLoc", label: "Booth location", type: "select", options: BOOTH_LOCATIONS_REF },
  { key: "boothWD", label: "Booth size (W × D)" },
];

const CHURCH_FIELDS: MeasureField[] = [
  { key: "sanctuaryLength", label: "Sanctuary length (rear wall–platform)" },
  { key: "sanctuaryWidth", label: "Sanctuary width (wall–wall)" },
  { key: "ceilingCenter", label: "Ceiling ht. — center" },
  { key: "ceilingPlatform", label: "Ceiling ht. — over platform" },
  { key: "platformWidth", label: "Platform width" },
  { key: "platformDepth", label: "Platform depth" },
  { key: "centerAisleW", label: "Center aisle width" },
  { key: "structure", label: "Structure at ceiling (steel/joist/deck)" },
  { key: "clearSpan", label: "Clear span or columns?" },
  { key: "floorCondition", label: "Floor type & condition" },
  { key: "seating", label: "Seating capacity (approx.)" },
  { key: "obstructions", label: "Obstructions (sound booth, HVAC, beams)" },
];

const GYM_FIELDS: MeasureField[] = [
  { key: "courtLength", label: "Court length (baseline–baseline)" },
  { key: "courtWidth", label: "Court width (sideline–sideline)" },
  { key: "ceilingCenter", label: "Ceiling ht. — center" },
  { key: "ceilingSidewall", label: "Ceiling ht. — sidewall" },
  { key: "wallToWall", label: "Wall-to-wall (room)" },
  { key: "dividerSpan", label: "Divider curtain span" },
  { key: "structure", label: "Structure at ceiling (steel/joist/deck)" },
  { key: "clearSpan", label: "Clear span or columns?" },
  { key: "floorCondition", label: "Floor type & condition" },
  { key: "bleacherType", label: "Bleacher type (fixed/telescoping)" },
  { key: "obstructions", label: "Obstructions (hoops, banners, HVAC)" },
];

const CONVENTION_FIELDS: MeasureField[] = [
  { key: "roomDepth", label: "Room length" },
  { key: "roomWidth", label: "Room width" },
  { key: "ceilingCenter", label: "Ceiling ht. — center" },
  { key: "ceilingPerimeter", label: "Ceiling ht. — perimeter" },
  { key: "columnSpacing", label: "Column spacing / clear span" },
  { key: "divisibleWallSpan", label: "Divisible wall span (if applicable)" },
  { key: "structure", label: "Structure at ceiling (steel/joist/deck)" },
  { key: "floorCondition", label: "Floor type & condition" },
  { key: "rigPointCapacity", label: "Rigging point capacity (lb), if any" },
  { key: "roomCapacity", label: "Room capacity (approx.)" },
  { key: "obstructions", label: "Obstructions (columns, sprinklers, HVAC)" },
];

const OTHER_FIELDS: MeasureField[] = [
  { key: "roomWidth", label: "Room / floor width" },
  { key: "roomDepth", label: "Room / floor depth" },
  { key: "ceilingCenter", label: "Ceiling / steel height" },
  { key: "structure", label: "Structure overhead (steel/joist/deck)" },
  { key: "clearSpan", label: "Clear span or columns?" },
  { key: "floorCondition", label: "Floor type & condition" },
  { key: "seating", label: "Capacity (approx.)" },
  { key: "obstructions", label: "Obstructions" },
];

const FIELDS_BY_CLASS: Record<VenueClass, MeasureField[]> = {
  theatre: THEATRE_FIELDS,
  auditorium: AUDITORIUM_FIELDS,
  church: CHURCH_FIELDS,
  gym: GYM_FIELDS,
  convention: CONVENTION_FIELDS,
  other: OTHER_FIELDS,
};

export function classMeasureFields(cls: VenueClass): MeasureField[] {
  return FIELDS_BY_CLASS[cls] || OTHER_FIELDS;
}

/** Tier-1 gate keys per class (spec §"Tier 1 survives; its key lists grow").
 *  Hard invariant: each value MUST appear in that class's own field set. */
export const TIER1_WIDTH_BY_CLASS: Record<VenueClass, string> = {
  theatre: "proW", auditorium: "proW", church: "sanctuaryWidth",
  gym: "courtWidth", convention: "roomWidth", other: "roomWidth",
};

export const TIER1_DEPTH_BY_CLASS: Record<VenueClass, string> = {
  theatre: "stageDepth", auditorium: "stageDepth", church: "sanctuaryLength",
  gym: "courtLength", convention: "roomDepth", other: "roomDepth",
};
