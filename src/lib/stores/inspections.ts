import {
  getDoc,
  insertWithPrefixedId,
  listDocs,
  patchDoc,
  softDeleteDoc,
  upsertDoc,
} from "@/db/doc-store";
import { get as getCustomerDoc } from "./customers";
import {
  fieldValue,
  renderTemplate,
  type TemplateOverrides,
} from "@/lib/templates";

/**
 * InspectionStore — server port of app/inspect.js (rss_inspections_v1).
 *
 * An inspection is a container of "rigging logs" (issues). Each log has a
 * severity (urgent / necessary / basic) and a ticket status (open / closed),
 * a written problem / explanation / solution, and before/after photos. The
 * end deliverable is a paged, print-ready Inspection Report.
 *
 * Lifecycle: requested → scheduled → onsite → completed (mirrors SurveyStore).
 *
 * Quote front (IDEAS #44 buildout — new, no prototype equivalent): an
 * inspection can now start life as an auto-priced QUOTE (quoteType
 * 'inspection', priced by src/lib/inspection-engine.ts). When that quote is
 * accepted (status 'won'), createFromQuote() spawns one `requested` record
 * per quoted venue — the same accepted-quote seam as flame tests and repairs,
 * in front of the existing requested → … → completed lifecycle.
 *
 * Recurrence (IDEAS #44): inspections run on two cadences by LEVEL —
 * Level 1 every year, Level 2 (in-depth) every 5 years. A completed
 * inspection's renewal anchors on its surveyDate; renewals() surfaces the
 * latest completed inspection per customer + venue + level so both cadences
 * are tracked independently, with the flame-test 60-day lead.
 *
 * Year-over-year: carryForward() spins up a fresh inspection that pulls every
 * OPEN log from a prior report forward (as open, with a firstNoted date
 * preserved) so a re-inspection can close them or keep them open across
 * visits.
 *
 * Also ported here (from the Inspection screen, Inspection.dc.html): the
 * component-condition rubric → finding grouping, with its severity mapping
 * Poor → Urgent, Fair → Necessary.
 *
 * Prototype localStorage/SyncEngine plumbing (pending, _setSync, resetToSeed,
 * events, cloud-seed/migration passes) is replaced by the doc-store; seeds
 * live in src/db/seeds/inspections.ts (which also exports demoInspection(),
 * the port of the prototype's demo()). boilerplate() takes the office
 * override object as a parameter instead of reading window.AppSettings —
 * pass `settings.inspection` from the app-settings blob.
 */

const DAY = 86400000;
const YEAR = 365 * DAY;
/** Flag a renewal this many days before the anniversary (same as flame tests). */
export const RENEWAL_LEAD_DAYS = 60;

function now(): number {
  return Date.now();
}

/* ---------- keys & meta ---------- */

export type InspectionStageKey = "requested" | "scheduled" | "onsite" | "completed";
export type InspectionSeverityKey = "urgent" | "necessary" | "basic";
export type InspectionLogStatus = "open" | "closed";
export type InspectionConditionKey = "good" | "fair" | "poor" | "failing";
export type RubricRatingKey = "na" | "good" | "fair" | "poor";

export const VENUE_TYPES: string[] = [
  "Proscenium theater", "Black box", "Worship / sanctuary", "Gymnasium / gym stage",
  "Arena", "Multipurpose room", "Outdoor / amphitheater",
];

/* ---- lifecycle stages (shared shape with SurveyStore) ---- */

export type InspectionStageMeta = { label: string; ink: string; soft: string; bd: string };

export const STAGES: Array<{ key: InspectionStageKey; label: string }> = [
  { key: "requested", label: "Requested" },
  { key: "scheduled", label: "Scheduled" },
  { key: "onsite", label: "On-site" },
  { key: "completed", label: "Completed" },
];

export const STAGE_META: Record<InspectionStageKey, InspectionStageMeta> = {
  requested: { label: "Requested", ink: "#8a6d1f", soft: "#fbf3dd", bd: "#f0e2bd" },
  scheduled: { label: "Scheduled", ink: "#3155a8", soft: "#e9eefb", bd: "#d4ddf3" },
  onsite: { label: "On-site", ink: "#7b3f8a", soft: "#f3eaf5", bd: "#e6d3ea" },
  completed: { label: "Completed", ink: "#1f7a52", soft: "#eaf6ef", bd: "#cce9da" },
};

export function stageMeta(k: string | null | undefined): InspectionStageMeta {
  return (
    (STAGE_META as Record<string, InspectionStageMeta | undefined>)[k || ""] || {
      label: k || "Requested",
      ink: "#8c919c",
      soft: "#f1f2f5",
      bd: "#e4e7ec",
    }
  );
}

export function stageIndex(k: string | null | undefined): number {
  const i = STAGES.findIndex((s) => s.key === k);
  return i < 0 ? 0 : i;
}

/* ---- inspection level (which cadence the inspection runs on) ---- */

export type InspectionLevel = {
  key: number;
  label: string;
  long: string;
  years: number;
  blurb: string;
  ink: string;
  soft: string;
  bd: string;
};

export const LEVELS: InspectionLevel[] = [
  { key: 1, label: "Level 1", long: "Level 1 — annual", years: 1,
    blurb: "Visual inspection of every accessible rigging component, performed every year.",
    ink: "#3155a8", soft: "#e9eefb", bd: "#d4ddf3" },
  { key: 2, label: "Level 2", long: "Level 2 — every 5 years", years: 5,
    blurb: "In-depth inspection with wear measurement and load-path review, performed every five years.",
    ink: "#7b3f8a", soft: "#f3eaf5", bd: "#e6d3ea" },
];

export function levelMeta(k: number | string | null | undefined): InspectionLevel {
  return LEVELS.find((l) => l.key === Number(k)) || LEVELS[0];
}

/* ---- renewal status (both cadences, flame-test badge shapes) ---- */

export type RenewalState = "overdue" | "due_soon" | "upcoming" | "ok" | "none";

export type RenewalBadge = {
  label: string;
  ink: string;
  soft: string;
  bd: string;
  dot: string;
};

export const RENEWAL_META: Record<RenewalState, RenewalBadge> = {
  overdue: { label: "Overdue", ink: "#b4543a", soft: "#f7e9e5", bd: "#f0d6cd", dot: "#b4543a" },
  due_soon: { label: "Due soon", ink: "#9a6a1f", soft: "#fbf3dd", bd: "#f0e2bd", dot: "#c98a2b" },
  upcoming: { label: "Upcoming", ink: "#3155a8", soft: "#e9eefb", bd: "#d4ddf3", dot: "#3155a8" },
  ok: { label: "On schedule", ink: "#1f7a52", soft: "#eaf6ef", bd: "#cce9da", dot: "#1f7a52" },
  none: { label: "—", ink: "#8c919c", soft: "#f1f2f5", bd: "#e4e7ec", dot: "#c4c9d2" },
};

export function renewalMeta(k: string | null | undefined): RenewalBadge {
  return (RENEWAL_META as Record<string, RenewalBadge>)[k || ""] || RENEWAL_META.none;
}

/** Human label for a renewalStatus() result (flame-test dueLabel). */
export function dueLabel(days: number, state: RenewalState | string): string {
  if (state === "overdue")
    return days === 0 ? "due today" : days + " day" + (days === 1 ? "" : "s") + " overdue";
  if (state === "due_soon" || state === "upcoming")
    return days === 0 ? "due today" : "due in " + days + " day" + (days === 1 ? "" : "s");
  return "on schedule";
}

/* ---- severity (level of problem) ---- */

export type InspectionSeverity = {
  key: InspectionSeverityKey;
  label: string;
  long: string;
  blurb: string;
};

export const SEVERITIES: InspectionSeverity[] = [
  { key: "urgent", label: "Urgent", long: "Urgent Repair", blurb: "A repair that requires immediate fixing — one that poses a danger until repaired." },
  { key: "necessary", label: "Necessary", long: "Necessary Repair", blurb: "A repair that should be dealt with in the next few months — one that, if left alone, may pose a threat." },
  { key: "basic", label: "Basic", long: "Basic Improvement", blurb: "A way to improve the venue’s efficiency and safety." },
];

export type InspectionSeverityMeta = {
  label: string;
  long: string;
  ink: string;
  soft: string;
  bd: string;
  bar: string;
};

export const SEVERITY_META: Record<InspectionSeverityKey, InspectionSeverityMeta> = {
  urgent: { label: "Urgent", long: "Urgent Repair", ink: "#b4543a", soft: "#f7e9e5", bd: "#f0d6cd", bar: "#b4543a" },
  necessary: { label: "Necessary", long: "Necessary Repair", ink: "#9a6a1f", soft: "#fbf3dd", bd: "#f0e2bd", bar: "#c98a2b" },
  basic: { label: "Basic", long: "Basic Improvement", ink: "#3155a8", soft: "#e9eefb", bd: "#d4ddf3", bar: "#3155a8" },
};

export function severityMeta(k: string | null | undefined): InspectionSeverityMeta {
  return (
    (SEVERITY_META as Record<string, InspectionSeverityMeta | undefined>)[k || ""] || {
      label: k || "",
      long: k || "",
      ink: "#8c919c",
      soft: "#f1f2f5",
      bd: "#e4e7ec",
      bar: "#8c919c",
    }
  );
}

export const SEVERITY_ORDER: Record<InspectionSeverityKey, number> = {
  urgent: 0,
  necessary: 1,
  basic: 2,
};

export type InspectionStatusMeta = { label: string; ink: string; soft: string; bd: string };

export const STATUS_META: Record<InspectionLogStatus, InspectionStatusMeta> = {
  open: { label: "Open", ink: "#b4543a", soft: "#f7e9e5", bd: "#f0d6cd" },
  closed: { label: "Closed", ink: "#1f7a52", soft: "#eaf6ef", bd: "#cce9da" },
};

export function statusMeta(k: string | null | undefined): InspectionStatusMeta {
  return (
    (STATUS_META as Record<string, InspectionStatusMeta | undefined>)[k || ""] ||
    STATUS_META.open
  );
}

/* ---- venue condition rating (the "About your venue" headline) ---- */

export type InspectionCondition = {
  key: InspectionConditionKey;
  label: string;
  ink: string;
  soft: string;
  bd: string;
};

export const CONDITIONS: InspectionCondition[] = [
  { key: "good", label: "Good condition", ink: "#1f7a52", soft: "#eaf6ef", bd: "#cce9da" },
  { key: "fair", label: "Fair condition", ink: "#9a6a1f", soft: "#fbf3dd", bd: "#f0e2bd" },
  { key: "poor", label: "Poor condition", ink: "#b4543a", soft: "#f7e9e5", bd: "#f0d6cd" },
  { key: "failing", label: "Failing / unsafe", ink: "#8a2f22", soft: "#f4dcd6", bd: "#e6c1b8" },
];

export function conditionMeta(k: string | null | undefined): InspectionCondition {
  return CONDITIONS.find((c) => c.key === k) || CONDITIONS[1];
}

/* ============================================================
 *  Venue information & stage measurements — the "site visit"
 *  data (general facts, the rigging system/equipment summary,
 *  and the itemized stage measurements) that opens the report.
 * ============================================================ */

export type VenueFactField = { key: string; label: string; wide?: boolean };

export const VENUE_FACTS: VenueFactField[] = [
  { key: "yearBuilt", label: "Built / equipment installed" },
  { key: "currentUse", label: "Current use" },
  { key: "ownerConcerns", label: "Owner concerns", wide: true },
];

export const SYSTEM_FIELDS: Array<{ key: string; label: string }> = [
  { key: "riggingType", label: "Rigging type" },
  { key: "lineSets", label: "Line sets" },
  { key: "liftLines", label: "Lift lines" },
  { key: "manufacturer", label: "Manufacturer" },
  { key: "electrics", label: "Electrics" },
  { key: "fireCurtain", label: "Fire curtain" },
  { key: "curtainTrack", label: "Curtain & track" },
  { key: "orchestraShell", label: "Orchestra shell" },
  { key: "deadHung", label: "Dead-hung rigging" },
  { key: "pitLift", label: "Orchestra pit / lift" },
];

export const MEASUREMENT_GROUPS: Array<{
  group: string;
  items: Array<{ key: string; label: string }>;
}> = [
  { group: "Stage dimensions", items: [
    { key: "proW", label: "Proscenium width" },
    { key: "proH", label: "Proscenium height" },
    { key: "depth", label: "Stage depth · PL to back wall" },
    { key: "apron", label: "Apron · PL to edge" },
    { key: "srW", label: "Stage-right wing" },
    { key: "slW", label: "Stage-left wing" },
  ] },
  { group: "Heights & section", items: [
    { key: "steel", label: "Height to steel" },
    { key: "grid", label: "Gridiron height" },
    { key: "houseH", label: "Stage house height" },
    { key: "pit", label: "Orchestra pit depth" },
    { key: "deck", label: "Deck / traps" },
  ] },
  { group: "FOH positions & beams", items: [
    { key: "beam1", label: "1st beam · from plaster line" },
    { key: "beam2", label: "2nd beam · from plaster line" },
    { key: "beam3", label: "3rd beam · from plaster line" },
    { key: "beamSpacing", label: "Beam spacing" },
    { key: "loadingBridge", label: "Loading bridge" },
  ] },
];

/* ============================================================
 *  Component-condition rubric — the systematic field checklist
 *  (loft blocks → wire rope → arbors → rope locks → curtains &
 *  track). The surveyor walks the whole system and rates every
 *  sub-component NA / Good / Fair / Poor, with per-section
 *  comments, a line-set reference and a photo.
 * ============================================================ */

export type RubricRating = {
  key: RubricRatingKey;
  label: string;
  ink: string;
  soft: string;
  bd: string;
  bar: string;
};

export const RUBRIC_RATINGS: RubricRating[] = [
  { key: "na", label: "NA", ink: "#8c919c", soft: "#f1f2f5", bd: "#dfe2e8", bar: "#c2c7d0" },
  { key: "good", label: "Good", ink: "#1f7a52", soft: "#eaf6ef", bd: "#cce9da", bar: "#1f7a52" },
  { key: "fair", label: "Fair", ink: "#9a6a1f", soft: "#fbf3dd", bd: "#f0e2bd", bar: "#c98a2b" },
  { key: "poor", label: "Poor", ink: "#b4543a", soft: "#f7e9e5", bd: "#f0d6cd", bar: "#b4543a" },
];

export function rubricRatingMeta(k: string | null | undefined): RubricRating | null {
  return RUBRIC_RATINGS.find((r) => r.key === k) || null;
}

export type RubricTemplateSection = { n: number; title: string; items: string[] };
export type RubricTemplateGroup = { group: string; sections: RubricTemplateSection[] };

export const RUBRIC_TEMPLATE: RubricTemplateGroup[] = [
  { group: "Counterweight Rigging System & Components", sections: [
    { n: 1, title: "Loft Block", items: ["Mounting assembly (clips & bolts)", "Housing (side plates / base angles)", "Sheave (casting)", "Bearing / shaft", "Alignment / fleet angle"] },
    { n: 2, title: "Wire Rope / Terminations", items: ["Wire rope", "Terminations", "Adjustment devices", "Alignment / fleet angle", "Clamps"] },
    { n: 3, title: "Head Block", items: ["Mounting assembly (clips & bolts)", "Housing (side plates / base angles)", "Sheaves (casting)", "Bearing / shaft", "Alignment / fleet angle"] },
    { n: 4, title: "Counterweight Arbor", items: ["Arbor top", "Arbor bottom", "Arbor rods", "Back bone", "Spreader plates", "Locking collars", "Guides / shoes"] },
    { n: 5, title: "Counterweights", items: ["Counterweight"] },
    { n: 6, title: "Rope Lock", items: ["Housing", "Jaws", "Handle", "Attachment", "Adjustment"] },
    { n: 7, title: "Hand Line", items: ["Hand line"] },
    { n: 8, title: "Tension Block", items: ["Housing", "Sheave", "Bearings / shaft", "Guides / shoes", "Attachment"] },
    { n: 9, title: "Battens", items: ["Battens", "Splices"] },
    { n: 10, title: "Locking Rail", items: ["Fasteners", "Stanchions", "Rail"] },
    { n: 11, title: "Arbor Guide System", items: ["Tees", "Wall batten", "Wall knee", "Arbor stops", "Fasteners", "U-clips", "Wire arbor guides"] },
    { n: 12, title: "CWT Electrics", items: ["SO power cable", "Connector strip", "Cable management", "Safety cables"] },
    { n: 13, title: "CWT Other Components", items: ["Acoustic ceiling system", "Loading bridge level", "Access ladders"] },
  ] },
  { group: "Curtain & Track Elements", sections: [
    { n: 1, title: "Curtain", items: ["Condition", "Flame retardants (NFPA 701 test)", "Travelers", "Borders", "Legs", "Scrims", "Grand valance", "Cyclorama", "Blackout"] },
    { n: 2, title: "Track", items: ["Tracks", "Track hardware", "Components", "Curtain machine"] },
  ] },
];

export const RUBRIC_LETTERS = "ABCDEFGHIJKLMNOP";

export type RubricItem = {
  l: string;
  label: string;
  rating: RubricRatingKey | null;
};

export type RubricSection = {
  key: string;
  group: string;
  n: number;
  title: string;
  items: RubricItem[];
  comments: string;
  lineSet: string;
  photo: string | null;
};

export function blankRubric(): RubricSection[] {
  const out: RubricSection[] = [];
  RUBRIC_TEMPLATE.forEach((grp, gi) => {
    grp.sections.forEach((sec, si) => {
      out.push({
        key: gi + "-" + si,
        group: grp.group,
        n: sec.n,
        title: sec.title,
        items: sec.items.map((label, i) => ({
          l: RUBRIC_LETTERS[i] || String(i + 1),
          label,
          rating: null,
        })),
        comments: "",
        lineSet: "",
        photo: null,
      });
    });
  });
  return out;
}

export function rubricSectionCount(): number {
  return RUBRIC_TEMPLATE.reduce((a, g) => a + g.sections.length, 0);
}

/* ============================================================
 *  Issue-template library — the surveyor picks one, then tweaks
 *  the wording. Each carries a suggested severity plus standard
 *  problem / explanation / solution copy.
 * ============================================================ */

export type IssueTemplate = {
  cat: string;
  severity: InspectionSeverityKey;
  problem: string;
  explanation: string;
  solution: string;
  standards: string[];
};

export const ISSUE_LIBRARY: IssueTemplate[] = [
  // ---- fall protection / access ----
  { cat: "Fall protection", severity: "urgent", problem: "Access ladder requires a self-closing gate",
    explanation: "There is a gap in the guardrail at a ladder access point that presents a fall hazard. OSHA 1910.28(b) requires that any employee on a walking-working surface with an unprotected edge 4 ft or more above a lower level be protected from falling.",
    solution: "Install a self-closing safety gate at the access opening to protect technicians from the fall hazard.",
    standards: ["OSHA 1910.28(b)"] },
  { cat: "Fall protection", severity: "urgent", problem: "Guardrail required at grid edge",
    explanation: "An unprotected edge of the gridiron needs to be protected. Per OSHA 1910.28(b) the top rail must be 42\" (±3\") above the walking surface with a mid-rail halfway between.",
    solution: "Install a compliant top rail, mid-rail, and self-closing gate to enclose the open edge.",
    standards: ["OSHA 1910.28(b)"] },
  { cat: "Fall protection", severity: "urgent", problem: "Catwalk railings are too low and mid-rails are missing",
    explanation: "The catwalk guardrails sit below the required height and no mid-rail is present. This does not meet the OSHA 1910.28(b) fall-protection requirement (42\"±3\" top rail, mid-rail halfway down).",
    solution: "Install a new top rail and mid-rail to the required heights throughout the catwalk system.",
    standards: ["OSHA 1910.28(b)"] },
  { cat: "Fall protection", severity: "urgent", problem: "Loft access openings require gates and railings",
    explanation: "Floor openings used to access stage-left/right lofts present fall hazards. OSHA 1910.28(b) requires protection at any unprotected edge 4 ft or more above a lower level.",
    solution: "Install self-closing gates and supplemental railings at each access location.",
    standards: ["OSHA 1910.28(b)"] },
  { cat: "Fall protection", severity: "necessary", problem: "Grid channel openings exceed the allowable hole size",
    explanation: "The gaps between grid channels and loft-block wells exceed the 2\" hole definition in 29 CFR 1910.21(b), creating trip and fall-through hazards.",
    solution: "Mitigate with covers, guardrails, or a fall-protection system after a review of the best option for the venue.",
    standards: ["OSHA 1910.21(b)", "OSHA 1910.28(b)"] },

  // ---- hardware ----
  { cat: "Hardware", severity: "urgent", problem: "Fire curtain head block uses unrated, undersized hardware",
    explanation: "The fire-curtain head block is mounted with unrated, undersized hardware. Overhead rigging must use rated locking hardware; the breaking strength of unrated hardware is unknown and can fail without warning.",
    solution: "Replace all unrated hardware with properly sized Grade 5 or higher rated hardware.",
    standards: [] },
  { cat: "Hardware", severity: "necessary", problem: "Loft block hardware is unrated",
    explanation: "Unrated hardware secures several loft blocks. All rigging equipment must be connected with rated locking hardware; unrated hardware has an unknown breaking strength.",
    solution: "Replace all unrated hardware with Grade 5 or higher rated hardware.",
    standards: [] },
  { cat: "Hardware", severity: "necessary", problem: "Shackle pins throughout are not moused (fixed)",
    explanation: "Screw-pin shackles below the battens are not moused. Vibration in use gradually loosens an unfixed pin until it can spin free.",
    solution: "Mouse every screw-pin shackle with steel wire or a zip tie through the pin eye, fastened back to the shackle body.",
    standards: [] },
  { cat: "Hardware", severity: "basic", problem: "Unused sheaves / hardware left on the head block steel",
    explanation: "Redundant sheaves and hardware remain on the head-block steel. Unused overhead material adds weight and can work loose over time.",
    solution: "Remove all unused sheaves and hardware from the overhead steel.",
    standards: [] },

  // ---- wire rope ----
  { cat: "Wire rope", severity: "urgent", problem: "Lift line is spiraled",
    explanation: "A lift line shows spiraling — a visible sign the wire rope has been twisted tighter than manufactured. Spiraled rope can fail unexpectedly.",
    solution: "Replace all wire rope that displays spiraling damage.",
    standards: [] },
  { cat: "Wire rope", severity: "urgent", problem: "Fire curtain wire rope clips are improperly installed",
    explanation: "Wire-rope clips on the fire-curtain lift lines are loosely and incorrectly oriented. Clips rely on friction and must follow the manufacturer’s torque, orientation and spacing; done wrong the system can drop the load.",
    solution: "Replace the wire rope and terminate with copper compression sleeves, which retain 95–100% of the rope’s breaking strength and need no periodic service.",
    standards: [] },
  { cat: "Wire rope", severity: "necessary", problem: "Single wire rope clip on a guide line",
    explanation: "A guide-line termination uses a single wire-rope clip. Clips are rated only when used in pairs or more at the correct spacing and torque; a single clip can slip.",
    solution: "Replace the wire rope with a length terminated using copper compression sleeves.",
    standards: [] },
  { cat: "Wire rope", severity: "necessary", problem: "Improper compression-sleeve crimp",
    explanation: "A compression sleeve is crimped incorrectly (overlapping crimps / overhang at the ends). An improperly terminated sleeve has an unknown efficiency, making the connection unrated.",
    solution: "Cut off and remake the termination; the wire rope will be replaced since it shortens when the eye is cut off.",
    standards: [] },
  { cat: "Wire rope", severity: "necessary", problem: "Severe fleet angle on a line set",
    explanation: "The wire rope runs off the head block at a fleet angle steeper than the 1.5° allowed by ANSI E1.4-1 for 7×19 rope, accelerating wear on both the sheave and the rope.",
    solution: "Adjust head/loft block placement, or add diverting blocks, to bring the fleet angle within tolerance.",
    standards: ["ANSI E1.4-1"] },

  // ---- fire curtain ----
  { cat: "Fire curtain", severity: "urgent", problem: "Fire curtain has no deceleration device",
    explanation: "The fire curtain lacks any deceleration device. ANSI E1.22 requires the curtain take at least 5 seconds to travel the last 8 ft; without it the curtain can slam the deck and damage the system.",
    solution: "Install a dashpot or other deceleration device after a review of the best method with venue staff.",
    standards: ["ANSI E1.22"] },
  { cat: "Fire curtain", severity: "urgent", problem: "Fire curtain guide lines are attached with hooks",
    explanation: "The fire-curtain guide lines are hooked to the grid. Hooks are not designed to secure wire rope — a slack line can escape and an overloaded hook can straighten, jamming the curtain in an emergency.",
    solution: "Replace the hooks with forged eye bolts.",
    standards: [] },
  { cat: "Fire curtain", severity: "urgent", problem: "Curtains are past their flame-retardancy certification",
    explanation: "The flame-retardancy certificate has expired. Curtain treatment typically must be renewed every 3–5 years; annual testing is recommended.",
    solution: "Take down all curtains and send them out to have flame-retardant treatment reapplied.",
    standards: ["NFPA 701"] },

  // ---- operation / mechanical ----
  { cat: "Operation", severity: "urgent", problem: "Rope locks are worn",
    explanation: "The rope locks show severe wear with flattened cams. Worn rope locks can let a line set move unexpectedly, creating a runaway hazard.",
    solution: "Replace the worn rope locks.",
    standards: [] },
  { cat: "Operation", severity: "urgent", problem: "Head block bearings are failing",
    explanation: "Several line sets are difficult to move and grinding during operation, indicating failed head-block bearings. This increases stress on the system and operator and can seize the set.",
    solution: "Replace the affected head blocks; given the shared installation age, replacing all head blocks is recommended.",
    standards: [] },
  { cat: "Structure", severity: "urgent", problem: "Head block beam shows deflection",
    explanation: "The head-block steel is visibly deflecting. Deflection in a structural beam can indicate overloading and risks catastrophic failure.",
    solution: "Have the beam assessed by a qualified structural engineer before any rigging renovation; develop a remediation plan from that assessment.",
    standards: [] },
  { cat: "Structure", severity: "urgent", problem: "Arbor rod is bent",
    explanation: "An arbor rod is bent, which weakens the arbor and can cause problems loading and unloading counterweight — especially in a runaway.",
    solution: "Replace the affected arbor.",
    standards: [] },
  { cat: "Loading", severity: "urgent", problem: "Small weights can fall through the loading gallery grating",
    explanation: "The smallest counterweights fit through the loading-gallery grating and can fall to the stage, causing injury or property damage.",
    solution: "Deck the loading-gallery walking surface with 3/4\" plywood.",
    standards: [] },

  // ---- rigging practice ----
  { cat: "Rigging", severity: "necessary", problem: "Dead-hung pipe is rigged poorly",
    explanation: "Chains supporting a dead-hung pipe are pulled in multiple directions and wrapped around grid channels, side-loading links that are only rated for linear loading.",
    solution: "Remove the improperly loaded chains and replace with an appropriately rated linear attachment.",
    standards: [] },
  { cat: "Rigging", severity: "necessary", problem: "Lifting lines are twisted from arbor to head block",
    explanation: "A lifting line is twisted around its neighbor between the arbor and head block, causing wear and risking premature failure.",
    solution: "Unload the set, untwist and inspect the lines for damage, reattach, and mouse the shackle pins.",
    standards: [] },
  { cat: "Rigging", severity: "necessary", problem: "Overhead fixtures lack secondary safety cables",
    explanation: "Side-arm fixtures on the gallery hang from a single point with no secondary cable. Any single-point overhead unit needs a secondary to catch it if the primary fails.",
    solution: "Install secondary safety cables on all overhead fixtures; monitor during every lighting changeover.",
    standards: [] },
  { cat: "Rigging", severity: "necessary", problem: "Batten splices are incorrect",
    explanation: "Batten splices throughout the system are made incorrectly, which can concentrate load and let the batten fail at the joint.",
    solution: "Rework all batten splices to the correct internal-sleeve method.",
    standards: [] },

  // ---- basic improvements ----
  { cat: "General", severity: "basic", problem: "Hand line does not have thimbles",
    explanation: "The operating hand line is terminated without thimbles, allowing the eye to deform and the line to wear quickly at the termination.",
    solution: "Re-terminate the hand line over proper thimbles.",
    standards: [] },
  { cat: "General", severity: "basic", problem: "No signage indicating system capacities",
    explanation: "There is no posted signage for the rigging system’s rated capacities, so operators have no reference for safe loading.",
    solution: "Post capacity signage at the operating rail and loading gallery.",
    standards: [] },
  { cat: "General", severity: "basic", problem: "Battens lack hi-visibility ends and clear numbering",
    explanation: "Batten ends are not hi-vis and the numbers do not face the operator, slowing safe operation and increasing the chance of a strike.",
    solution: "Add hi-visibility batten ends and reorient the batten numbers to face down toward the deck.",
    standards: [] },
];

export function libraryCategories(): string[] {
  const s: string[] = [];
  ISSUE_LIBRARY.forEach((i) => {
    if (s.indexOf(i.cat) < 0) s.push(i.cat);
  });
  return s;
}

/* ============================================================
 *  Boilerplate — the fixed report prose (About / Standards /
 *  Mission / Disclaimer …). Defaults live here; the office can
 *  override any field via the app-settings 'inspection' key —
 *  pass that object as `overrides`.
 * ============================================================ */

export type InspectionBoilerplate = {
  about: string;
  standardsIntro: string;
  standards: Array<{ name: string; desc: string }>;
  mission: string;
  inspectionPurpose: string;
  howToUse: string;
  disclaimer: string;
};

export const BOILERPLATE_DEFAULTS: InspectionBoilerplate = {
  about: "We are an independent theatrical rigging company specializing in renovation, restoration, new installation, and repair of counterweight rigging systems, pipe grids, automated rigging, and custom rigging solutions. Being independent — with no sales agreements tied to any manufacturer — lets us specify the equipment that is genuinely best for each purpose and leverage the best quality and pricing for our clients.",
  standardsIntro: "Our inspections follow a strict set of guidelines drawn from current federal regulations and theatrical industry standards, including:",
  standards: [
    { name: "OSHA", desc: "Occupational Safety and Health Administration — sets and enforces workplace safety standards, including fall protection for walking-working surfaces." },
    { name: "NFPA", desc: "National Fire Protection Association — publishes the consensus fire-safety codes that govern fire curtains and life-safety systems." },
    { name: "ANSI", desc: "American National Standards Institute — oversees the E1 series of voluntary entertainment-technology standards used throughout this report." },
    { name: "ESTA / PLASA", desc: "The entertainment-technology trade bodies whose technical standards program (E1) defines safe rigging practice." },
    { name: "ETCP", desc: "Entertainment Technician Certification Program — the North American certification for riggers who directly affect crew and audience safety." },
  ],
  mission: "To install high-quality rigging in a professional, timely manner; to create rigging solutions suited to each client’s specific needs; and to further users’ understanding of how their equipment works — encouraging education, creativity, and safe practices.",
  inspectionPurpose: "The purpose of a rigging inspection is to check every piece of hardware involved in the rigging system — anything that leaves the ground. Just as a chain is only as strong as its weakest link, a rigging system is only as strong as its weakest point. Each component must be checked at least once a year so wear can be caught early. This is a visual inspection of accessible components; items that cannot be seen (the inside of gearboxes and motors, spaces above finished ceilings) are not included unless specifically noted.",
  howToUse: "This report sorts every finding into three categories — Urgent Repair, Necessary Repair, and Basic Improvement — and tracks each as an Open or Closed log. An Open log is present or still present from a past inspection; a Closed log was resolved during this inspection or is a past issue no longer present. Each finding is detailed in its own rigging log.",
  disclaimer: "This report is limited to the deficiencies present and visually accessible at the time of the inspection. Mechanical and electrical systems can fail without warning and new deficiencies can develop at any time. This survey makes no attempt to vouch for the integrity of the system design and does not include any structural analysis; concerns about the building structure should be directed to a qualified structural engineer.",
};

/** Port of boilerplate() — the prototype read the override object from
 *  AppSettings ('inspection' key); the server caller passes it in. */
export function boilerplate(
  overrides?: Partial<InspectionBoilerplate> | null
): InspectionBoilerplate {
  return { ...BOILERPLATE_DEFAULTS, ...(overrides || {}) };
}

/**
 * InspectionBoilerplate with its six prose fields overlaid from the Templates
 * store (the `inspection_report` template). Falls back to BOILERPLATE_DEFAULTS
 * for anything an admin hasn't edited; the `standards` list stays built-in.
 * This is what wires the report's standing text to the Templates screen.
 */
export function reportBoilerplate(
  overrides?: TemplateOverrides,
  vars: Record<string, string | number | null | undefined> = {}
): InspectionBoilerplate {
  const f = (id: string) =>
    renderTemplate(fieldValue(overrides, "inspection_report", id), vars);
  return boilerplate({
    about: f("about"),
    standardsIntro: f("standardsIntro"),
    mission: f("mission"),
    inspectionPurpose: f("inspectionPurpose"),
    howToUse: f("howToUse"),
    disclaimer: f("disclaimer"),
  });
}

/* ---------- date helpers (records store ISO 'YYYY-MM-DD') ---------- */

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

export function parseISO(s: string | null | undefined): Date | null {
  if (!s) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(s));
  if (!m) {
    const d = new Date(s);
    return isNaN(d.getTime()) ? null : d;
  }
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

export function fmtLong(iso: string | null | undefined): string {
  const d = parseISO(iso);
  if (!d) return "—";
  return MONTHS[d.getMonth()] + " " + d.getDate() + ", " + d.getFullYear();
}

export function fmtShort(iso: string | null | undefined): string {
  const d = parseISO(iso);
  if (!d) return "—";
  return MONTHS[d.getMonth()].slice(0, 3) + " " + d.getDate() + ", " + d.getFullYear();
}

export function yearOf(iso: string | null | undefined): number | "" {
  const d = parseISO(iso);
  return d ? d.getFullYear() : "";
}

/* ---------- log & record shapes ---------- */

/** A rubric item reference attached to a finding created from the rubric. */
export type RubricRef = {
  key: string;
  idx: number;
  label: string;
  section: string;
  rating: RubricRatingKey | null;
};

export type InspectionLog = {
  id: number;
  seq: number;
  svid: string;
  severity: InspectionSeverityKey;
  status: InspectionLogStatus;
  problem: string;
  explanation: string;
  solution: string;
  workPerformed: string;
  location: string;
  standards: string[];
  beforePhoto: string | null;
  afterPhoto: string | null;
  firstNoted: string;
  estHours: number | null;
  estCost: number | null;
  /** Set by carryForward() on logs pulled forward from a prior report. */
  carried?: boolean;
  /** Seed flag: the closed demo logs render an after photo. */
  hasAfter?: boolean;
  /** Rubric items this finding was generated from. */
  rubricRefs?: RubricRef[];
};

export type InspectionRecord = {
  id: string;
  /** Accepted inspection quote this record was spawned from (IDEAS #44). */
  quoteId: string | null;
  /** 1 = annual · 2 = five-year in-depth — drives the renewal cadence. */
  level: number;
  /** Line sets covered (from the quote; informs the estimate + scope). */
  lineSets: number;
  /** Quoted value carried onto the record (whole-quote share for this venue). */
  value: number;
  customer: string;
  customerId: string | null;
  locationId: string | null;
  venue: string;
  venueType: string;
  address: string;
  contact: string;
  contactPhone: string;
  contactEmail: string;
  surveyDate: string; // ISO 'YYYY-MM-DD' or ''
  reportDate: string;
  inspector: string;
  condition: InspectionConditionKey;
  scope: string;
  narrative: string;
  logs: InspectionLog[];
  rubric?: RubricSection[];
  venueInfo?: Record<string, string>;
  measurements?: Record<string, string>;
  priorInspectionId: string | null;
  priorSurveyDate: string;
  stage: InspectionStageKey;
  assignedTo: string;
  scheduledDate: string;
  requestedBy: string;
  requestedAt: number;
  /** Renewal-outreach stamp (IDEAS #37) — the office contacted the customer
   *  about THIS cycle's renewal. Lives on the latest completed inspection;
   *  the next completed inspection is a new record, so cycles reset. */
  renewalOutreach?: { at: number; by: string } | null;
  owner: string;
  createdAt: number;
  updatedAt: number;
  /** Device-sync metadata from the prototype — preserved on seeds and client
   *  pushes; never managed server-side. */
  syncState?: "pending" | "syncing" | "synced" | "error";
  syncedAt?: number | null;
  rev?: number;
};

/* ---------- log helpers ---------- */

function newSvid(): string {
  return String(30000 + Math.floor(Math.random() * 9999));
}

/** Renumber logs 1..n in severity order (urgent → necessary → basic),
 *  stable within a severity. */
export function renumber(logs: InspectionLog[]): InspectionLog[] {
  const arr = (logs || []).slice();
  arr.sort(
    (a, b) =>
      SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] ||
      (a.seq || 0) - (b.seq || 0)
  );
  arr.forEach((l, i) => {
    l.id = i + 1;
  });
  return arr;
}

export function blankLog(partial: Partial<InspectionLog> = {}): InspectionLog {
  const t = now();
  return {
    id: 0,
    seq: t,
    svid: newSvid(),
    severity: "necessary",
    status: "open",
    problem: "",
    explanation: "",
    solution: "",
    workPerformed: "",
    location: "",
    standards: [],
    beforePhoto: null,
    afterPhoto: null,
    firstNoted: "",
    estHours: null,
    estCost: null,
    ...partial,
  };
}

/* ---------- rubric → finding grouping (port of Inspection.dc.html) ---------- */

/** The severity mapping for findings generated from rubric ratings:
 *  Poor → Urgent, anything else (Fair) → Necessary. */
export function rubricFindingSeverity(
  rating: RubricRatingKey | string | null | undefined
): InspectionSeverityKey {
  return rating === "poor" ? "urgent" : "necessary";
}

export type RubricSelectionRef = {
  key: string;
  idx: number;
  label: string;
  rating: RubricRatingKey | null;
  section: string;
  lineSet?: string;
  comments?: string;
};

/**
 * Build ONE finding (log partial) from a hand-picked selection of rubric
 * items — port of createFindingFromSelection(). Any Poor item makes the
 * whole finding Urgent; otherwise Necessary. Feed the result to addLog().
 */
export function findingFromRubricRefs(
  refs: RubricSelectionRef[]
): Partial<InspectionLog> | null {
  if (!refs.length) return null;
  const hasPoor = refs.some((r) => r.rating === "poor");
  const severity: InspectionSeverityKey = hasPoor ? "urgent" : "necessary";
  const sections: Record<string, RubricSelectionRef[]> = {};
  refs.forEach((r) => {
    (sections[r.section] = sections[r.section] || []).push(r);
  });
  const secNames = Object.keys(sections);
  const compLines = secNames.map((name) => {
    const its = sections[name];
    const cmt = (its[0].comments || "").trim();
    return (
      name +
      " (" + its.map((i) => i.label.toLowerCase()).join(", ") + ")" +
      (cmt ? " — " + cmt : "")
    );
  });
  const sevWord = hasPoor ? "Poor" : "Fair";
  let problem: string;
  if (secNames.length === 1)
    problem = secNames[0] + (refs.length === 1 ? " — " + refs[0].label.toLowerCase() : "");
  else problem = "Multiple components require attention";
  const explanation =
    "Rated " + sevWord +
    " during the component condition walkthrough. Affected components: " +
    compLines.join("; ") + ".";
  const solution = "";
  const standards: string[] = [];
  const lineSets = Array.from(
    new Set(refs.map((r) => r.lineSet).filter((x): x is string => !!x))
  );
  const location = lineSets.length
    ? "Line set " + lineSets.join(", ")
    : secNames.length === 1
      ? secNames[0]
      : "";
  return {
    severity,
    status: "open",
    problem,
    explanation,
    solution,
    location,
    standards,
    rubricRefs: refs.map((r) => ({
      key: r.key, idx: r.idx, label: r.label, section: r.section, rating: r.rating,
    })),
  };
}

/**
 * Pull every un-logged rubric item of one rating (Poor / Fair) into findings —
 * one finding per component section; port of addFindingsFromRating().
 * Poor → Urgent, Fair → Necessary. Items already covered by a log's
 * rubricRefs are skipped. Feed each result to addLog().
 */
export function findingsFromRubricRating(
  rubric: RubricSection[],
  logs: InspectionLog[],
  rating: "poor" | "fair"
): Array<Partial<InspectionLog>> {
  const covered: Record<string, boolean> = {};
  (logs || []).forEach((l) =>
    (l.rubricRefs || []).forEach((rf) => {
      covered[rf.key + ":" + rf.idx] = true;
    })
  );
  const groups: Array<{ sec: RubricSection; refs: RubricRef[] }> = [];
  (rubric || []).forEach((s) => {
    const refs: RubricRef[] = [];
    s.items.forEach((it, idx) => {
      if (it.rating === rating && !covered[s.key + ":" + idx])
        refs.push({ key: s.key, idx, label: it.label, rating: it.rating, section: s.title });
    });
    if (refs.length) groups.push({ sec: s, refs });
  });
  const sevWord = rating === "poor" ? "Poor" : "Fair";
  const severity = rubricFindingSeverity(rating);
  const out: Array<Partial<InspectionLog>> = [];
  let made = 0;
  groups.forEach(({ sec, refs }) => {
    const compList = refs.map((r) => r.label.toLowerCase()).join(", ");
    const cmt = (sec.comments || "").trim();
    const problem =
      sec.title + (refs.length === 1 ? " — " + refs[0].label.toLowerCase() : "");
    const explanation =
      "Rated " + sevWord +
      " during the component condition walkthrough. Affected: " +
      compList + (cmt ? " — " + cmt : "") + ".";
    const location = (sec.lineSet || "").trim() ? "Line set " + sec.lineSet : sec.title;
    out.push({
      seq: now() + made,
      severity,
      status: "open",
      problem,
      explanation,
      solution: "",
      location,
      standards: [],
      rubricRefs: refs.map((r) => ({
        key: r.key, idx: r.idx, label: r.label, section: r.section, rating: r.rating,
      })),
    });
    made++;
  });
  return out;
}

/* ---------- blank record & counts ---------- */

export type InspectionDraft = {
  quoteId: string | null;
  level: number;
  lineSets: number;
  value: number;
  customer: string;
  customerId: string | null;
  locationId: string | null;
  venue: string;
  venueType: string;
  address: string;
  contact: string;
  contactPhone: string;
  contactEmail: string;
  surveyDate: string;
  reportDate: string;
  inspector: string;
  condition: InspectionConditionKey;
  scope: string;
  narrative: string;
  logs: InspectionLog[];
  rubric: RubricSection[];
  venueInfo: Record<string, string>;
  measurements: Record<string, string>;
  priorInspectionId: string | null;
  priorSurveyDate: string;
  stage: InspectionStageKey;
  assignedTo: string;
  scheduledDate: string;
  requestedBy: string;
  requestedAt: number;
};

/** Port of blank(partial): defaults for every field, taking the partial's
 *  value when it is neither undefined nor null. Unknown keys are dropped. */
export function blank(partial: Partial<InspectionRecord> = {}): InspectionDraft {
  const def: InspectionDraft = {
    quoteId: null, level: 1, lineSets: 0, value: 0,
    customer: "", customerId: null, locationId: null, venue: "",
    venueType: VENUE_TYPES[0], address: "",
    contact: "", contactPhone: "", contactEmail: "",
    surveyDate: "", reportDate: "", inspector: "",
    condition: "fair", scope: "", narrative: "",
    logs: [], rubric: [], venueInfo: {}, measurements: {},
    priorInspectionId: null, priorSurveyDate: "",
    stage: "requested", assignedTo: "", scheduledDate: "",
    requestedBy: "", requestedAt: 0,
  };
  const rec = {} as InspectionDraft;
  (Object.keys(def) as Array<keyof InspectionDraft>).forEach((k) => {
    const v = (partial as Record<string, unknown>)[k];
    (rec as Record<string, unknown>)[k] =
      v !== undefined && v !== null ? v : def[k];
  });
  return rec;
}

export type SeverityCounts = { open: number; closed: number };

export type InspectionCounts = {
  urgent: SeverityCounts;
  necessary: SeverityCounts;
  basic: SeverityCounts;
  open: number;
  closed: number;
  total: number;
};

/** Counts for a record's logs → { urgent:{open,closed}, ..., open, closed, total }. */
export function counts(
  rec: Pick<InspectionRecord, "logs"> | null | undefined
): InspectionCounts {
  const bySev: Record<string, SeverityCounts> = {
    urgent: { open: 0, closed: 0 },
    necessary: { open: 0, closed: 0 },
    basic: { open: 0, closed: 0 },
  };
  let open = 0;
  let closed = 0;
  let total = 0;
  ((rec && rec.logs) || []).forEach((l) => {
    const sev = bySev[l.severity] || (bySev[l.severity] = { open: 0, closed: 0 });
    if (l.status === "closed") {
      sev.closed++;
      closed++;
    } else {
      sev.open++;
      open++;
    }
    total++;
  });
  const result: InspectionCounts = {
    urgent: bySev.urgent,
    necessary: bySev.necessary,
    basic: bySev.basic,
    open,
    closed,
    total,
  };
  // The prototype also kept buckets for any unexpected severity keys.
  Object.keys(bySev).forEach((k) => {
    if (k !== "urgent" && k !== "necessary" && k !== "basic")
      (result as unknown as Record<string, SeverityCounts>)[k] = bySev[k];
  });
  return result;
}

/* ---------- CRUD (doc-store backed; prototype public API) ---------- */

export async function getAll(): Promise<InspectionRecord[]> {
  const list = await listDocs<InspectionRecord>("inspections");
  return list.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
}

export async function get(id: string): Promise<InspectionRecord | null> {
  return getDoc<InspectionRecord>("inspections", id);
}

/** Prototype defaulted owner/requestedBy to window.Team.CURRENT — server
 *  callers pass them from the session; fallback matches the prototype. */
export async function create(
  partial: Partial<InspectionRecord> = {}
): Promise<InspectionRecord> {
  const t = now();
  const build = (id: string): InspectionRecord => ({
    ...blank(partial),
    id,
    owner: partial.owner || "Jeff Chesebro",
    requestedBy: partial.requestedBy || "Jeff Chesebro",
    requestedAt: partial.requestedAt || t,
    createdAt: t,
    updatedAt: t,
  });
  if (partial.id) {
    const rec = build(partial.id);
    await upsertDoc<InspectionRecord>("inspections", rec);
    return rec;
  }
  return insertWithPrefixedId<InspectionRecord>("inspections", "RI", 2041, build);
}

export async function update(
  id: string,
  patch: Partial<InspectionRecord>
): Promise<InspectionRecord | null> {
  return patchDoc<InspectionRecord>("inspections", id, (s) => {
    Object.assign(s, patch, { updatedAt: now() });
  });
}

export async function setStage(
  id: string,
  stage: InspectionStageKey
): Promise<InspectionRecord | null> {
  return update(id, { stage });
}

export async function assign(
  id: string,
  assignedTo?: string,
  scheduledDate?: string
): Promise<InspectionRecord | null> {
  return update(id, {
    assignedTo: assignedTo || "",
    scheduledDate: scheduledDate || "",
    stage: "scheduled",
  });
}

export async function unschedule(id: string): Promise<InspectionRecord | null> {
  return update(id, { stage: "requested", scheduledDate: "", assignedTo: "" });
}

/** Stamp / clear this cycle's renewal outreach (IDEAS #37). */
export async function setRenewalOutreach(
  id: string,
  by: string | null
): Promise<InspectionRecord | null> {
  return update(id, {
    renewalOutreach: by ? { at: now(), by } : null,
  });
}

/* ---- renewal math (both cadences: L1 annual · L2 every 5 years) ---- */

export function msOf(isoStr: string | null | undefined): number | null {
  const d = parseISO(isoStr);
  return d ? d.getTime() : null;
}

/** When the inspection was performed — anchors the renewal clock. */
export function completedAtOf(
  rec: Pick<InspectionRecord, "stage" | "surveyDate" | "reportDate" | "updatedAt"> | null | undefined
): number | null {
  if (!rec || rec.stage !== "completed") return null;
  return msOf(rec.surveyDate) ?? msOf(rec.reportDate) ?? rec.updatedAt ?? null;
}

/** Next inspection due — performed date + the level's cadence (1 or 5 years). */
export function dueAtOf(
  rec: Pick<InspectionRecord, "stage" | "surveyDate" | "reportDate" | "updatedAt" | "level"> | null | undefined
): number | null {
  const at = completedAtOf(rec);
  if (at == null) return null;
  return at + levelMeta(rec && rec.level).years * YEAR;
}

export type RenewalStatus = {
  state: RenewalState;
  days: number;
  dueAt: number | null;
};

export function renewalStatus(
  rec: InspectionRecord | null | undefined
): RenewalStatus {
  const due = dueAtOf(rec);
  if (due == null) return { state: "none", days: 0, dueAt: null };
  const diff = due - now();
  if (diff < 0) return { state: "overdue", days: Math.round(-diff / DAY), dueAt: due };
  if (diff <= RENEWAL_LEAD_DAYS * DAY)
    return { state: "due_soon", days: Math.round(diff / DAY), dueAt: due };
  if (diff <= 120 * DAY)
    return { state: "upcoming", days: Math.round(diff / DAY), dueAt: due };
  return { state: "ok", days: Math.round(diff / DAY), dueAt: due };
}

/**
 * Latest completed inspection per customer + venue + LEVEL, with renewal
 * status attached — both cadences tracked independently (an L2 five-year
 * clock never hides the venue's annual L1 clock and vice versa). dueOnly
 * keeps overdue + due_soon rows. Sorted soonest-due first.
 */
export async function renewals(
  opts: { dueOnly?: boolean } = {}
): Promise<Array<InspectionRecord & { _renewal: RenewalStatus }>> {
  const all = await listDocs<InspectionRecord>("inspections");
  const completed = all.filter((r) => r.stage === "completed");
  const latest: Record<string, InspectionRecord> = {};
  completed.forEach((r) => {
    const k =
      (r.customerId || r.customer || "") +
      "|" +
      (r.locationId || r.venue || "") +
      "|" +
      levelMeta(r.level).key;
    if (!latest[k] || (completedAtOf(r) || 0) > (completedAtOf(latest[k]) || 0)) {
      latest[k] = r;
    }
  });
  let rows = Object.keys(latest).map((k) => ({
    ...latest[k],
    _renewal: renewalStatus(latest[k]),
  }));
  if (opts.dueOnly) {
    rows = rows.filter(
      (r) => r._renewal.state === "overdue" || r._renewal.state === "due_soon"
    );
  }
  rows.sort((a, b) => (dueAtOf(a) || 0) - (dueAtOf(b) || 0));
  return rows;
}

/* ---- accepted-quote spawn (the quote → approved front, IDEAS #44) ---- */

/** Minimal structural view of an inspection quote doc (collection "quotes"). */
export type InspectionQuoteLike = {
  id: string;
  quoteType?: string;
  status?: string;
  customer?: string;
  customerId?: string | null;
  locationId?: string | null;
  value?: number;
  owner?: string;
  contact?: { name?: string; role?: string; email?: string; phone?: string } | null;
  inspection?: {
    level?: number;
    scope?: string;
    venues?: Array<{ id?: string | null; label?: string; lineSets?: number }>;
    contact?: { name?: string; email?: string; phone?: string } | null;
  } | null;
};

/** Minimal structural view of a customer doc (for the venue address). */
type CustomerDocLike = {
  id: string;
  name?: string;
  locations?: Array<{
    id?: string;
    label?: string;
    street?: string;
    city?: string;
    state?: string;
    zip?: string;
  }>;
};

export async function byQuote(qid: string): Promise<InspectionRecord[]> {
  const list = await listDocs<InspectionRecord>("inspections");
  return list.filter((r) => r.quoteId === qid);
}

/**
 * Spawn the `requested` inspection record(s) for one accepted inspection
 * quote — ONE RECORD PER QUOTED VENUE (an inspection record is per-venue;
 * the quote prices the venues as one shared trip). Idempotent: returns the
 * existing records when the quote already spawned; null when the quote is
 * missing or not an inspection quote.
 */
export async function createFromQuote(
  qid: string
): Promise<InspectionRecord[] | null> {
  const existing = await byQuote(qid);
  if (existing.length) return existing;
  const q = await getDoc<InspectionQuoteLike>("quotes", qid);
  if (!q || q.quoteType !== "inspection") return null;
  const insp = q.inspection || {};
  const level = levelMeta(insp.level).key;
  // Identity core (D85): composed from relational rows via the store seam.
  const cust = q.customerId
    ? ((await getCustomerDoc(q.customerId)) as CustomerDocLike | null)
    : null;
  const venues =
    insp.venues && insp.venues.length
      ? insp.venues
      : [{ id: q.locationId, label: "", lineSets: 0 }];
  const share = Math.round((q.value || 0) / venues.length);
  const contact = q.contact || insp.contact || null;
  const made: InspectionRecord[] = [];
  for (let i = 0; i < venues.length; i++) {
    const v = venues[i];
    const loc = cust
      ? (cust.locations || []).find((l) => l.id === v.id) || null
      : null;
    const address = loc
      ? [loc.street, [loc.city, loc.state].filter(Boolean).join(", "), loc.zip]
          .filter(Boolean)
          .join(", ")
      : "";
    const lineSets = Math.max(0, Number(v.lineSets) || 0);
    const rec = await create({
      quoteId: q.id,
      level,
      lineSets,
      // first venue absorbs the rounding remainder
      value: i === 0 ? (q.value || 0) - share * (venues.length - 1) : share,
      customer: q.customer || (cust && cust.name) || "",
      customerId: q.customerId || null,
      locationId: v.id ?? null,
      venue: v.label || (loc && loc.label) || "Venue",
      address,
      contact: (contact && contact.name) || "",
      contactPhone: (contact && contact.phone) || "",
      contactEmail: (contact && contact.email) || "",
      scope:
        insp.scope ||
        levelMeta(level).long +
          " rigging inspection" +
          (lineSets ? " — " + lineSets + " line sets." : "."),
      stage: "requested",
      owner: q.owner || "Jeff Chesebro",
      requestedBy: q.owner || "Jeff Chesebro",
    });
    made.push(rec);
  }
  return made;
}

/** Scan accepted (won) inspection quotes and spawn any records not made yet.
 *  Returns the number of records created. */
export async function syncFromQuotes(): Promise<number> {
  const quotes = await listDocs<InspectionQuoteLike>("quotes");
  const recs = await listDocs<InspectionRecord>("inspections");
  const have: Record<string, boolean> = {};
  recs.forEach((r) => {
    if (r.quoteId) have[r.quoteId] = true;
  });
  let made = 0;
  for (const q of quotes) {
    if (q.quoteType !== "inspection" || q.status !== "won") continue;
    if (have[q.id]) continue;
    const out = await createFromQuote(q.id);
    if (out && out.length) {
      have[q.id] = true;
      made += out.length;
    }
  }
  return made;
}

/* ---- log CRUD (operate on a record's logs[], keep them renumbered) ---- */

export async function addLog(
  id: string,
  logPartial: Partial<InspectionLog> = {}
): Promise<InspectionRecord | null> {
  const s = await get(id);
  if (!s) return null;
  const logs = (s.logs || []).slice();
  const l = blankLog({ seq: now(), ...logPartial });
  logs.push(l);
  return update(id, { logs: renumber(logs) });
}

export async function updateLog(
  id: string,
  logId: number,
  patch: Partial<InspectionLog>
): Promise<InspectionRecord | null> {
  const s = await get(id);
  if (!s) return null;
  const logs = (s.logs || []).map((l) => (l.id === logId ? { ...l, ...patch } : l));
  // re-sort/renumber only if severity changed
  return update(id, { logs: patch && patch.severity ? renumber(logs) : logs });
}

export async function removeLog(
  id: string,
  logId: number
): Promise<InspectionRecord | null> {
  const s = await get(id);
  if (!s) return null;
  const logs = (s.logs || []).filter((l) => l.id !== logId);
  return update(id, { logs: renumber(logs) });
}

/* ---- year-over-year: create a fresh inspection carrying every OPEN log forward ---- */

export async function carryForward(
  priorId: string,
  patch: Partial<InspectionRecord> = {}
): Promise<InspectionRecord | null> {
  const prior = await get(priorId);
  if (!prior) return null;
  const carried = (prior.logs || [])
    .filter((l) => l.status === "open")
    .map((l) =>
      blankLog({
        severity: l.severity,
        status: "open",
        problem: l.problem,
        explanation: l.explanation,
        solution: l.solution,
        location: l.location,
        standards: (l.standards || []).slice(),
        firstNoted: l.firstNoted || prior.surveyDate || "",
        seq: l.seq,
        carried: true,
      })
    );
  return create({
    customer: prior.customer,
    customerId: prior.customerId,
    locationId: prior.locationId,
    venue: prior.venue,
    venueType: prior.venueType,
    address: prior.address,
    contact: prior.contact,
    contactPhone: prior.contactPhone,
    contactEmail: prior.contactEmail,
    condition: prior.condition,
    scope: prior.scope,
    logs: renumber(carried),
    priorInspectionId: prior.id,
    priorSurveyDate: prior.surveyDate || "",
    stage: "scheduled",
    ...patch,
  });
}

export async function remove(id: string): Promise<void> {
  await softDeleteDoc("inspections", id);
}

/* ---------- misc ---------- */

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
