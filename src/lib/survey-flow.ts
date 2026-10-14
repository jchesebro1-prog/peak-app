/* Venue Assessments flow (#342, slice A) — the editor's section order, wizard steps and groups, the scope filter
   (Kill questions → which sections show), the one rigging-system answer, the quote-visit rule and the customer
   recap. Pure and client-safe: the editor, the field sheet, the findings text and the tests read it. */
import { goalsFromSurvey } from "./estimate-output/goals";
import { DISCIPLINE_GROUPS, RIG_SYSTEMS, type DisciplineData, type DisciplineKey } from "./stores/survey-intake";

export { RIG_SYSTEMS };

export type FlowGroup = "brief" | "field" | "intake" | "assessment" | "wrapup";

/** Every editor section id, in display order. Sections that don't exist for a survey are skipped. */
export const SECTION_ORDER: readonly string[] = [
  "cust", "visit", "tier1",
  "site", "lifeSafety",
  "mQuick", "mLayout", "mSection", "mBeams", "mFOH", "mHouse", "m3d",
  "dRigging", "dCurtain", "dLighting", "dAv", "linesets",
  "assessmentToggle", "assessmentUsage", "assessmentCondition", "assessmentFindings",
  "photos", "notes", "project", "recap", "finalThoughts", "assign",
];

export const STEP_LABELS: readonly string[] = ["Brief", "Site & access", "Measurements", "Site intake", "Assessment", "Wrap-up"];

const IDS_BY_STEP: string[][] = [
  ["cust", "visit", "tier1"],
  ["site", "lifeSafety"],
  ["mQuick", "mLayout", "mSection", "mBeams", "mFOH", "mHouse", "m3d"],
  ["dRigging", "dCurtain", "dLighting", "dAv", "linesets"],
  ["assessmentToggle", "assessmentUsage", "assessmentCondition", "assessmentFindings"],
  ["photos", "notes", "project", "recap", "finalThoughts", "assign"],
];
const GROUP_BY_STEP: FlowGroup[] = ["brief", "field", "field", "intake", "assessment", "wrapup"];

export const STEP_BY_ID: Record<string, number> = Object.fromEntries(IDS_BY_STEP.flatMap((ids, step) => ids.map((id) => [id, step])));
export const GROUP_BY_ID: Record<string, FlowGroup> = Object.fromEntries(IDS_BY_STEP.flatMap((ids, step) => ids.map((id) => [id, GROUP_BY_STEP[step]])));

export const GROUP_META: Record<FlowGroup, { label: string; blurb: string }> = {
  brief: { label: "Office brief", blurb: "Who, why, and the kill questions" },
  field: { label: "Field capture", blurb: "Filled on-site by the surveyor" },
  intake: { label: "Site intake", blurb: "One branch per discipline in scope" },
  assessment: { label: "Condition & needs", blurb: "Advisory condition and planning profile" },
  wrapup: { label: "Wrap-up", blurb: "Last questions, the read-back, and internal notes" },
};

export const SCOPE_KEYS: readonly DisciplineKey[] = ["rigging", "curtain", "lighting", "av"];
export const SCOPE_LABEL: Record<DisciplineKey, string> = { rigging: "Rigging", curtain: "Curtains", lighting: "Lighting", av: "AV" };

/** The slice of a survey these rules read. */
export type FlowSlice = {
  visitPurpose?: string;
  scope?: unknown;
  disciplines?: Record<string, DisciplineData>;
  linesets?: unknown[];
};

/** Purposes that show the quote / budget half of Existing materials & quote (Jeff, Oct 14: New system design only). */
export const QUOTE_PURPOSES: readonly string[] = ["New system design"];

export function isQuoteVisit(s: Pick<FlowSlice, "visitPurpose">): boolean {
  return QUOTE_PURPOSES.includes(String(s.visitPurpose ?? "").trim());
}

/** The survey's scope in canonical order, or null while it is unanswered (null filters nothing). */
export function scopeSet(s: FlowSlice): DisciplineKey[] | null {
  if (!Array.isArray(s.scope)) return null;
  const raw = s.scope as unknown[];
  const keys = SCOPE_KEYS.filter((k) => raw.includes(k));
  return keys.length ? keys : null;
}

export function inScope(s: FlowSlice, k: DisciplineKey): boolean {
  const set = scopeSet(s);
  return !set || set.includes(k);
}

export function rigSystems(s: FlowSlice): string[] {
  const p = s.disciplines?.rigging?.present;
  return Array.isArray(p) ? p.filter((x): x is string => typeof x === "string") : [];
}

const LINESET_SYSTEMS = new Set(["Counterweight", "Dead-hung", "Motorized", "Hemp"]);
export const hasCounterweight = (s: FlowSlice): boolean => rigSystems(s).includes("Counterweight");
export const hasLinesets = (s: FlowSlice): boolean => rigSystems(s).some((x) => LINESET_SYSTEMS.has(x));

/** Sections that belong to one discipline's scope. */
const SECTION_SCOPE: Record<string, DisciplineKey> = {
  dRigging: "rigging", mBeams: "rigging", linesets: "rigging",
  dCurtain: "curtain",
  dLighting: "lighting", mFOH: "lighting",
  dAv: "av",
};

/** Whether a section shows for this survey. Hidden sections keep their stored answers. */
export function sectionVisible(s: FlowSlice, id: string): boolean {
  const k = SECTION_SCOPE[id];
  if (k && !inScope(s, k)) return false;
  if (id === "linesets") {
    if (Array.isArray(s.linesets) && s.linesets.length > 0) return true;
    return rigSystems(s).length === 0 || hasLinesets(s);
  }
  return true;
}

const BULLET = /^\s*(?:[-•*]|\d+[.)])\s+/;

/** One goal per line: a stored string splits on newlines with leading bullets dropped; an array is trimmed. */
export function splitGoalLines(v: unknown): string[] {
  if (Array.isArray(v)) return v.map((x) => String(x ?? "").trim()).filter(Boolean);
  if (typeof v !== "string") return [];
  return v.split(/\r?\n/).map((line) => line.replace(BULLET, "").trim()).filter(Boolean);
}

export type RecapEntry = { disc: DisciplineKey; label: string; scopes: string[]; other: string; goals: string[] };

/** The end-of-visit read-back: per discipline in scope (or, with scope unset, per discipline with scopes or goals),
 *  its scopes of interest, the "Other" explanation and its client goals. */
export function recapFor(s: FlowSlice): RecapEntry[] {
  const set = scopeSet(s);
  const out: RecapEntry[] = [];
  const cleanGoals = goalsFromSurvey(s) as Record<string, string | undefined>;
  for (const g of DISCIPLINE_GROUPS) {
    const d: DisciplineData = s.disciplines?.[g.key] || {};
    const scopes = Array.isArray(d.scope) ? d.scope.map((x) => String(x)).filter(Boolean) : [];
    const other = typeof d.scopeOther === "string" ? d.scopeOther.trim() : "";
    const goals = splitGoalLines(cleanGoals[g.key]);
    const listed = set ? set.includes(g.key) : scopes.length > 0 || goals.length > 0 || other !== "";
    if (listed) out.push({ disc: g.key, label: SCOPE_LABEL[g.key], scopes, other, goals });
  }
  return out;
}

/** "New grid, Add hoists, Other: …" — the scopes line for the sheet and the findings text. */
export function recapScopeText(e: RecapEntry): string {
  return [...e.scopes.filter((x) => x !== "Other"), e.other ? `Other: ${e.other}` : ""].filter(Boolean).join(", ");
}
