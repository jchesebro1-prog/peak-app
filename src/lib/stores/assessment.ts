/**
 * Condition & Needs Assessment layer for Venue Assessments (D132, 2026-08-18).
 *
 * Source: Jeff's "Condition & Needs Assessment" brief, folded into the site
 * visit record as a second, toggleable layer rather than a separate document
 * (spec §Data model → Assessment layer). The brief's own vocabularies are
 * ported verbatim: how the room is used, who operates it, where it is going,
 * and a Good / Monitor / Replace read on ten equipment categories.
 *
 * Two deliberate omissions, both from the brief:
 * - Electrical is captured as notes only and carries NO condition rating —
 *   it is outside Peak's lane.
 * - Findings are advisory. Budget tiers are a planning range, not a quote,
 *   so nothing here spawns a quote, a repair job, or a task.
 *
 * Pure module — no DB imports, safe for both the server store and the client
 * editor (same contract as survey-intake.ts).
 */

/* ---- condition categories & ratings ---- */

export type ConditionCategory =
  | "rigging"
  | "curtains"
  | "motors"
  | "lighting.console"
  | "lighting.dimming"
  | "lighting.fixtures"
  | "av.console"
  | "av.speakers"
  | "av.mics"
  | "av.video";

export type ConditionRating = "" | "good" | "monitor" | "replace";

/** The brief's ten rated categories, in the brief's order. Electrical is
 *  deliberately absent — see the module docstring. */
export const CONDITION_CATEGORIES: Array<{ key: ConditionCategory; label: string }> = [
  { key: "rigging", label: "Rigging (hardware/mechanics)" },
  { key: "curtains", label: "Curtains / Soft Goods" },
  { key: "motors", label: "Motors" },
  { key: "lighting.console", label: "Lighting — console / control" },
  { key: "lighting.dimming", label: "Lighting — dimming" },
  { key: "lighting.fixtures", label: "Lighting — fixtures / instruments" },
  { key: "av.console", label: "Sound — console / mixing" },
  { key: "av.speakers", label: "Sound — speakers / amplification" },
  { key: "av.mics", label: "Sound — mics / inputs" },
  { key: "av.video", label: "Video / projection" },
];

export const CONDITION_RATINGS: Array<{ key: Exclude<ConditionRating, "">; label: string }> = [
  { key: "good", label: "Good" },
  { key: "monitor", label: "Monitor" },
  { key: "replace", label: "Replace" },
];

/* ---- usage vocabularies (brief §how the room is used) ---- */

export type EventFrequency = "" | "weekly" | "monthly" | "fewPerYear" | "rare";
export type StaffTier = "" | "trained" | "someTraining" | "students" | "none";

export const EVENT_TYPES: Array<{ key: string; label: string }> = [
  { key: "assemblies", label: "Assemblies" },
  { key: "theatrical", label: "Theatrical productions" },
  { key: "concerts", label: "Concerts / recitals" },
  { key: "sports", label: "Sports" },
  { key: "rentals", label: "Community rentals" },
  { key: "other", label: "Other" },
];

export const EVENT_FREQUENCIES: Array<{ key: Exclude<EventFrequency, "">; label: string }> = [
  { key: "weekly", label: "Weekly" },
  { key: "monthly", label: "Monthly" },
  { key: "fewPerYear", label: "A few times a year" },
  { key: "rare", label: "Rare" },
];

export const STAFF_TIERS: Array<{ key: Exclude<StaffTier, "">; label: string }> = [
  { key: "trained", label: "Trained theatrical / AV staff" },
  { key: "someTraining", label: "Teacher or staff with some training" },
  { key: "students", label: "Students only" },
  { key: "none", label: "No dedicated operator" },
];

/** Stored as labels — the record's growthGoals is a plain string[]. */
export const GROWTH_GOALS: string[] = [
  "Expand drama / music program",
  "More community rentals",
  "Multi-use conversion",
  "None planned",
  "Other",
];

/* ---- findings ---- */

export type FindingBucket = "" | "now" | "soon" | "later";
export type BudgetTier = "" | "u5k" | "5to25k" | "25to100k" | "over100k";

export const FINDING_BUCKETS: Array<{ key: Exclude<FindingBucket, "">; label: string }> = [
  { key: "now", label: "Now" },
  { key: "soon", label: "Soon" },
  { key: "later", label: "Later" },
];

/** Planning ranges, never a quote. */
export const BUDGET_TIERS: Array<{ key: Exclude<BudgetTier, "">; label: string }> = [
  { key: "u5k", label: "<$5k" },
  { key: "5to25k", label: "$5–25k" },
  { key: "25to100k", label: "$25–100k" },
  { key: "over100k", label: "$100k+" },
];

export interface Finding {
  id: string;
  /** more than one when the assessor merges categories into one line */
  categories: ConditionCategory[];
  bucket: FindingBucket;
  title: string;
  detail: string;
  budgetTier: BudgetTier;
  /** references SurveyPhoto ids on the record */
  photoIds: string[];
}

/** A flame cert or inspection reference — auto-resolved from the venue's own
 *  records, or entered by hand for third-party / pre-app documents. */
export interface InspectionRef {
  onFile: "" | "yes" | "no";
  type: string;
  date: string;
  source: "auto" | "manual";
  /** FT-#### or the inspection id when auto-resolved */
  recordId: string | null;
}

/* ---- the assessment document ---- */

export interface ConditionEntry {
  rating: ConditionRating;
  notes: string;
}

export interface AssessmentUsage {
  eventTypes: Array<{ key: string; frequency: EventFrequency }>;
  staffTier: StaffTier;
  trainingGaps: string;
  growthGoals: string[];
  growthNotes: string;
}

export interface AssessmentData {
  date: string;
  assessors: string[];
  technicalReviewer: { name: string; role: string };
  /** the customer's own words */
  statedConcern: string;
  usage: AssessmentUsage;
  conditions: Record<ConditionCategory, ConditionEntry>;
  /** contextual only — deliberately unrated */
  electricalNotes: string;
  inspectionRefs: Record<string, InspectionRef>;
  findings: Finding[];
}

export function blankAssessment(): AssessmentData {
  const conditions = {} as Record<ConditionCategory, ConditionEntry>;
  CONDITION_CATEGORIES.forEach((c) => {
    conditions[c.key] = { rating: "", notes: "" };
  });
  return {
    date: "",
    assessors: [],
    technicalReviewer: { name: "", role: "" },
    statedConcern: "",
    usage: {
      eventTypes: [],
      staffTier: "",
      trainingGaps: "",
      growthGoals: [],
      growthNotes: "",
    },
    conditions,
    electricalNotes: "",
    inspectionRefs: {},
    findings: [],
  };
}

let findingSeq = 0;
export function newFindingId(): string {
  findingSeq += 1;
  return "fnd" + Date.now().toString(36) + findingSeq.toString(36);
}

/**
 * Findings engine — pure, and called on every editor render, so it must
 * NEVER mutate the assessment it is handed.
 *
 * A category is *covered* when it appears in any finding's `categories`
 * array; that is what makes merging work — one finding listing both
 * lighting.console and lighting.dimming covers both.
 */
export function seedFindings(a: AssessmentData): {
  seeded: Finding[];
  unresolved: ConditionCategory[];
} {
  const covered = new Set<string>();
  a.findings.forEach((f) => f.categories.forEach((c) => covered.add(c)));
  const flagged = CONDITION_CATEGORIES.filter(
    (c) => a.conditions[c.key]?.rating === "monitor" || a.conditions[c.key]?.rating === "replace"
  );
  const missing = flagged.filter((c) => !covered.has(c.key));
  // With no findings recorded yet, the assessor has not started triaging —
  // seed a line per flagged category. Once findings exist, the assessor is
  // driving, so an uncovered category is a gap to surface, not a line to
  // silently re-add.
  if (a.findings.length === 0) {
    return {
      seeded: missing.map((c) => ({
        id: newFindingId(),
        categories: [c.key],
        bucket: "" as const,
        title: c.label,
        detail: a.conditions[c.key].notes,
        budgetTier: "" as const,
        photoIds: [],
      })),
      unresolved: [],
    };
  }
  return { seeded: [], unresolved: missing.map((c) => c.key) };
}
