/* Assessments engine (#337) — the finding record and its pure rules (immediate-attention requirements,
   status preconditions, legacy rating map). Spec §3 "Record: findings collection". No db / next imports. */
import type { Category, Rating } from "./defs/types";

export const STATUSES = ["open", "triaged", "inspected", "quoted", "scheduled", "repaired", "verified", "closed"] as const;
export type FindingStatus = (typeof STATUSES)[number];

export interface Finding {
  key: string;               // fd_…  (doc id, never changes)
  printedId: string | null;  // "MPSD-LIN-RIG-003"; null while pending server allocation
  customerId: string; siteId: string; spaceLabel?: string;
  category: Category;
  description: string; location?: string;         // line set number, voltage/phase if known
  assessmentId: string;                            // raised at
  questionKeys: string[]; ruleId?: string;         // what raised it
  photoIds: string[];                              // PhotoRef ids on the assessment(s)
  rating: Rating;                                  // assessor's, never overwritten
  specialist?: { rating: Rating; standard?: string; by?: string; at?: number };  // beside, not over
  actionTag?: "out_of_service" | "specialist_needed" | "replace" | "repair" | "monitor";
  recommendedAction?: string;
  qualification?: "engineer" | "rigging_contractor" | "electrician" | "environmental" | "venue_staff";
  priority?: "high" | "medium" | "low";
  budgetTier?: "lt10k" | "lt100k" | "gt100k";
  owner?: { kind: "staff" | "contractor"; name: string };
  auditRef?: { item: string; estimate?: number };
  immediate?: { hazardContactNotified: boolean; notifiedAt?: number; lockout: "locked" | "tagged" | "none" };
  quoteRefs: string[];                             // quote ids
  repair?: { date: number; by: string; work: string; parts?: string };
  verified?: { by: string; at: number };
  nextDue?: number;
  status: FindingStatus;
  history: { status: FindingStatus; by: string; at: number; note?: string }[];
  voided?: { by: string; at: number; reason: string };
  createdAt: number; createdBy: string; updatedAt: number;
  /** the per-(company code, venue code, category) sequence number behind printedId; null while pending */
  seq: number | null;
  /** the codes printedId was issued under (they keep their text if the codes change later) */
  companyCode: string | null;
  siteCode: string | null;
  /** optimistic-concurrency revision */
  rev?: number;
}

/** MPSD-LIN-RIG-003 (three digits minimum; four or more when the sequence grows). */
export function formatPrintedId(companyCode: string, siteCode: string, cat: Category, seq: number): string {
  return `${companyCode}-${siteCode}-${cat}-${String(seq).padStart(3, "0")}`;
}

/** What a finding shows until the server allocates its number: "MPSD-LIN-RIG-…". A missing code shows as an em dash. */
export function pendingPrintedLabel(companyCode: string | null, siteCode: string | null, cat: Category): string {
  return `${companyCode ?? "—"}-${siteCode ?? "—"}-${cat}-…`;
}

const blank = (s: string | undefined) => s === undefined || s.trim() === "";

/** Immediate attention needs a photo, the hazard contact told (with when), a lockout state and a recommended action. */
export function immediateProblems(f: Finding): string[] {
  if (f.rating !== "immediate") return [];
  const out: string[] = [];
  if (!f.photoIds || f.photoIds.length < 1) out.push("Add at least one photo.");
  const im = f.immediate;
  if (!im || typeof im.hazardContactNotified !== "boolean") out.push("Say whether the hazard contact was notified.");
  else if (im.hazardContactNotified && !(typeof im.notifiedAt === "number" && Number.isFinite(im.notifiedAt))) out.push("Record when the hazard contact was notified.");
  if (!im || !(im.lockout === "locked" || im.lockout === "tagged" || im.lockout === "none")) out.push("Say whether the hazard was locked out or tagged.");
  if (blank(f.recommendedAction)) out.push("Enter a recommended action.");
  return out;
}

/** Why a finding can't move to `to` yet (spec §3 Status); [] when it can. Backward moves need a note. */
export function transitionProblems(f: Finding, to: FindingStatus, note?: string): string[] {
  if (f.voided) return ["A voided finding can't change status."];
  const from = STATUSES.indexOf(f.status);
  const dest = STATUSES.indexOf(to);
  if (dest < 0) return ["Unknown status."];
  if (dest === from) return [];
  const out: string[] = [];
  if (dest < from) {
    if (blank(note)) out.push("Moving a finding back needs a note saying why.");
    return out;
  }
  if (to === "inspected" && !f.specialist?.rating) out.push("Record the specialist's rating before marking inspected.");
  if (to === "quoted" && !(f.quoteRefs && f.quoteRefs.length >= 1)) out.push("Link at least one quote before marking quoted.");
  if (to === "repaired") {
    const r = f.repair;
    if (!r || !(typeof r.date === "number" && Number.isFinite(r.date))) out.push("Enter the repair date.");
    if (!r || blank(r.by)) out.push("Enter who did the repair.");
    if (!r || blank(r.work)) out.push("Describe the work done.");
  }
  if (to === "verified" && (!f.verified || blank(f.verified.by) || !(typeof f.verified.at === "number" && Number.isFinite(f.verified.at)))) out.push("Record who verified the repair and when.");
  return out;
}

/** Old Rigging Inspection / Field Survey wording → the one rating scale. Case-insensitive; null when unrecognised. */
export function legacyRating(src: "RI" | "FS", value: string): { rating: Rating; actionTag?: "monitor" } | null {
  const v = String(value).trim().toLowerCase();
  if (src === "RI") {
    if (v === "poor" || v === "urgent") return { rating: "immediate" };
    if (v === "fair" || v === "necessary") return { rating: "needs" };
    if (v === "good" || v === "basic") return { rating: "good" };
    return null;
  }
  if (v === "replace") return { rating: "needs" };
  if (v === "monitor") return { rating: "good", actionTag: "monitor" };
  if (v === "good") return { rating: "good" };
  return null;
}

export const CATEGORY_ROUTING: Record<Category, { label: string; routedTo: string; behavior: string }> = {
  RIG: { label: "Rigging, incl. fire curtain", routedTo: "Peak rigging inspection", behavior: "Quote a rigging inspection opens /inspections/quote pre-filled for the venue" },
  ELC: { label: "Electrical and control", routedTo: "Qualified electrician", behavior: "Observation only; never marked inspected by Peak" },
  STR: { label: "Structural / building, incl. smoke vents, roof, egress structure", routedTo: "Engineer or building owner", behavior: "Flag only; no rating of structure" },
  HAZ: { label: "Hazardous materials", routedTo: "Environmental specialist", behavior: "Do-not-disturb flag printed on the finding" },
  GEN: { label: "Theatrical general", routedTo: "Assessor / venue staff", behavior: "Stays with Peak" },
};

/** True when any non-voided finding carries this company / venue code — the code is then locked (changing it needs `approve`). */
export function codeInUse(findings: Finding[], code: string, kind: "company" | "site"): boolean {
  return findings.some((f) => !f.voided && (kind === "company" ? f.companyCode : f.siteCode) === code);
}
