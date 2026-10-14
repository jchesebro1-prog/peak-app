/* Venue Assessments (#344, slice B) — fixed pick lists and small parsers shared by the survey editor, the field
   sheet, the read-time migration and the Assessments engine (R4: both forms use the same lists). Pure. Jeff chose
   fixed-in-code lists (Oct 14); changing one is a code change. */

export const LIFT_TYPES: readonly string[] = ["Ladder >12ft", "Scaffolding", "Single Man Lift", "Scissor >20ft", "Scissor >40ft", "Scissor >50ft"];
export const LOADING_DOOR_TYPES: readonly string[] = ["Roll-up / overhead", "Double doors", "Single door", "Dock door", "Other"];
export const TRACK_SERIES: readonly string[] = ["N/A", "None", "Lightweight", "Standard", "Curved"];
export const TRACK_OPERATIONS: readonly string[] = ["SL", "SR"];
export const PLUG_TYPES: readonly string[] = ["Stage-pin", "Edison", "Twist-lock", "Other", "Mixed"];
export const LIGHTING_POSITIONS: readonly string[] = [
  "Electric 1", "Electric 2", "Electric 3", "Electric 4", "Electric 5", "FOH 1", "FOH 2", "FOH 3", "Torms", "Balcony", "Other",
];
export const FIXTURE_POSITIONS: readonly string[] = ["Front", "Down", "Side", "Back", "Cyc", "Movers"];
export const CONSOLE_LOCATIONS: readonly string[] = ["Booth", "Stage", "Other"];

/** Bad → New, stored as 0–4. */
export const CONDITION_STEPS: readonly string[] = ["Bad", "Poor", "Fair", "Good", "New"];
export type ConditionLevel = 0 | 1 | 2 | 3 | 4;

export function isConditionLevel(v: unknown): v is ConditionLevel {
  return typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= 4;
}

export function conditionLabel(v: unknown): string {
  return isConditionLevel(v) ? CONDITION_STEPS[v] : "";
}

/** Old free-text or Good/Fair/Poor answers → a level, only on an exact word; anything else stays a note. */
export function conditionFromText(raw: unknown): ConditionLevel | null {
  const t = String(raw ?? "").trim().toLowerCase();
  const i = CONDITION_STEPS.findIndex((s) => s.toLowerCase() === t);
  return i >= 0 ? (i as ConditionLevel) : null;
}

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const ym = (y: number, m: number): string | null =>
  y >= 1900 && y <= 2100 && m >= 1 && m <= 12 ? `${y}-${String(m).padStart(2, "0")}` : null;

/** "3/2024", "03/2024", "3/17/2024", "2024-03", "2024-03-17", "March 2024", "Mar 2024" → "2024-03"; else null. */
export function parseMonthYear(raw: unknown): string | null {
  const t = String(raw ?? "").trim();
  if (!t) return null;
  let m = /^(\d{4})-(\d{1,2})(?:-\d{1,2})?$/.exec(t);
  if (m) return ym(+m[1], +m[2]);
  m = /^(\d{1,2})\/(?:\d{1,2}\/)?(\d{4})$/.exec(t);
  if (m) return ym(+m[2], +m[1]);
  m = /^([a-z]+)\.?\s+(\d{4})$/i.exec(t);
  if (m) {
    const i = MONTHS.indexOf(m[1].slice(0, 3).toLowerCase());
    return i >= 0 ? ym(+m[2], i + 1) : null;
  }
  return null;
}

/** Old free-text console location → Booth / Stage / Other (+ the text for Other). `exact` = nothing else was said. */
export function consoleLocationFrom(raw: unknown): { value: "" | "Booth" | "Stage" | "Other"; other: string; exact: boolean } {
  const t = String(raw ?? "").trim();
  if (!t) return { value: "", other: "", exact: true };
  const low = t.toLowerCase();
  if (low.includes("booth")) return { value: "Booth", other: "", exact: low === "booth" };
  if (low.includes("stage")) return { value: "Stage", other: "", exact: low === "stage" };
  return { value: "Other", other: t, exact: true };
}

export function travelTimeText(min: number): string {
  const m = Math.max(1, Math.round(min));
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const r = m % 60;
  return r ? `${h} h ${r} min` : `${h} h`;
}

export function distanceText(miles: number): string {
  return `${Math.max(1, Math.round(miles))} mi`;
}

/** #344 B5 — the Visit card's travel pre-fill takes only a real drive (a manual override or an OSRM route), never the
    straight-line "auto" guess or nothing; both numbers must be finite. */
export function acceptTravel(est: { source: string; minutes: number | null; miles: number | null }): { min: number; miles: number } | null {
  if (est.source !== "manual" && est.source !== "routed") return null;
  const { minutes, miles } = est;
  if (typeof minutes !== "number" || typeof miles !== "number" || !Number.isFinite(minutes) || !Number.isFinite(miles)) return null;
  return { min: minutes, miles };
}

/** Engine pick-list code for a label: "Ladder >12ft" → "ladder_12ft". */
export function listSlug(label: string): string {
  return label.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}
