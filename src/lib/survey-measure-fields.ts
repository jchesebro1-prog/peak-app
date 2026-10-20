/* Venue Assessment notes (#344) — the measurement field definitions, as a pure module. They used to live in
   stores/surveys.ts (which imports the DB); the plain-text readers (survey-findings.ts) need them client-safe.
   surveys.ts re-exports everything here, so existing imports keep working. */

export const BEAM_TYPES: string[] = [
  "I-beam",
  "Bar joist",
  "Wood truss",
  "Wood beam",
  "Concrete tee",
  "Unknown",
];
export const BEAM_DIRECTIONS: string[] = [
  "Runs SL–SR (cross-stage)",
  "Runs US–DS (up/down-stage)",
  "Mixed / bidirectional",
];
export const DRAW_SIDES: string[] = ["Stage right", "Stage left", "Both", "Center split"];

export interface MeasureField {
  key: string;
  label: string;
  type?: "select" | "check";
  options?: string[];
}

export interface MeasureGroup {
  id: string;
  title: string;
  subtitle: string;
  fields: MeasureField[];
}

export const LAYOUT_FIELDS: MeasureField[] = [
  { key: "proW", label: "Proscenium width" },
  { key: "proH", label: "Proscenium height" },
  { key: "stageDepth", label: "Stage depth (plaster→back)" },
  { key: "apron", label: "Apron depth (plaster→edge)" },
  { key: "wingSR", label: "Stage-right wing width" },
  { key: "wingSL", label: "Stage-left wing width" },
  { key: "houseR", label: "House-right width" },
  { key: "houseL", label: "House-left width" },
];
export const SECTION_FIELDS: MeasureField[] = [
  { key: "steelH", label: "Steel height (u/s of steel)" },
  { key: "roofH", label: "Roof height" },
  { key: "gridH", label: "Grid height" },
  { key: "pitDepth", label: "Orchestra pit depth" },
  { key: "stageH", label: "Stage height (above house floor)" },
  { key: "houseH", label: "House ceiling height" },
  { key: "deckLevel", label: "Deck / datum level" },
  { key: "upperLevel", label: "Upper / raised level" },
];
export const BEAM_FIELDS: MeasureField[] = [
  // #344 B2: the drawings on file come first (B5 gates them); the old hhSheet / brickDrawing checks fold in on read.
  { key: "structuralDrawingOnFile", label: "Structural drawing on file", type: "check" },
  { key: "brickDrawingOnFile", label: "Brick drawing on file", type: "check" },
  { key: "cwElevationOnFile", label: "CW Elevation sheet on file", type: "check" },
  { key: "beam1SRDist", label: "1st beam — distance from SR wall" },
  { key: "beamSpacing", label: "Beam spacing (on center)" },
  { key: "beamDirection", label: "Beam direction", type: "select", options: BEAM_DIRECTIONS },
  { key: "beamType", label: "Beam type", type: "select", options: BEAM_TYPES },
  { key: "drawSide", label: "Draw side", type: "select", options: DRAW_SIDES },
  { key: "loadingBridge", label: "Loading bridge present", type: "check" },
  { key: "midrail", label: "Midrail height" },
];
export const FOH_FIELDS: MeasureField[] = [
  { key: "foh1Dist", label: "1st FOH — distance from plaster" },
  { key: "foh1Trim", label: "1st FOH — height / trim" },
  { key: "foh1Len", label: "1st FOH — position length" },
  { key: "foh2Dist", label: "2nd FOH — distance from plaster" },
  { key: "foh2Trim", label: "2nd FOH — height / trim" },
  { key: "foh2Len", label: "2nd FOH — position length" },
  { key: "foh3Dist", label: "3rd FOH — distance from plaster" },
  { key: "foh3Trim", label: "3rd FOH — height / trim" },
  { key: "foh3Len", label: "3rd FOH — position length" },
  { key: "tormDist", label: "Tormentor — distance from center" },
  { key: "tormTrim", label: "Tormentor — height / trim" },
  { key: "tormLen", label: "Tormentor — position length" },
];
// ---- house / room rough measurements (IDEAS #49 — capture now so surveys
// feed the future auto-built 3D venue model; ceiling height stays houseH in
// the section group per the shared-key rule) ----
export const BOOTH_LOCATIONS: string[] = [
  "Rear of house — center",
  "Rear of house — left",
  "Rear of house — right",
  "Balcony",
  "Floor / portable",
  "None",
];
export const HOUSE_FIELDS: MeasureField[] = [
  { key: "houseWidth", label: "House width (overall)" },
  { key: "houseDepth", label: "House depth (plaster→back wall)" },
  { key: "centerAisleW", label: "Center aisle width" },
  { key: "doorCount", label: "House doors — count" },
  { key: "doorMainWH", label: "Main door size (W × H)" },
  { key: "catwalkCount", label: "Catwalks — count" },
  { key: "catwalkH", label: "Catwalk height (above house floor)" },
  { key: "catwalk1Dist", label: "1st catwalk — distance from plaster" },
  { key: "boothLoc", label: "Booth location", type: "select", options: BOOTH_LOCATIONS },
  { key: "boothWD", label: "Booth size (W × D)" },
  { key: "boothDist", label: "Booth — distance from plaster" },
];
export const MEASURE_GROUPS: MeasureGroup[] = [
  { id: "mLayout", title: "Stage layout", subtitle: "Plan-view widths & depths", fields: LAYOUT_FIELDS },
  { id: "mSection", title: "Stage section", subtitle: "Heights & vertical trims", fields: SECTION_FIELDS },
  { id: "mBeams", title: "Beams & rigging", subtitle: "Structure, draw & existing rig", fields: BEAM_FIELDS },
  { id: "mFOH", title: "FOH positions", subtitle: "Front-of-house lighting positions", fields: FOH_FIELDS },
  { id: "mHouse", title: "House & room", subtitle: "Auditorium shell — doors, catwalks, booth & aisles", fields: HOUSE_FIELDS },
];
