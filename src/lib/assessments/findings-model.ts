/* Assessments engine (#340) — the finding record and its pure rules (immediate-attention requirements,
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
  /** `mergedInto` is set ONLY by a merge: the key of the finding this one was merged into */
  voided?: { by: string; at: number; reason: string; mergedInto?: string };
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
export function codeInUse(findings: Pick<Finding, "voided" | "companyCode" | "siteCode">[], code: string | null | undefined, kind: "company" | "site"): boolean {
  if (!code) return false;
  return findings.some((f) => !f.voided && (kind === "company" ? f.companyCode : f.siteCode) === code);
}

/* ---------- Task 8: keys, prompt resolution, merge and split (pure) ---------- */

/** A fresh finding key: `fd_` + 16 lowercase hex characters (safe in the browser and on the server). */
export function newFindingKey(): string {
  return "fd_" + globalThis.crypto.randomUUID().replace(/-/g, "").slice(0, 16);
}

export const MERGE_REASON_PREFIX = "Merged into ";
/** The void reason a merged-away finding carries. */
export function mergeReason(printedId: string): string {
  return `${MERGE_REASON_PREFIX}${printedId}`;
}

/** The minimum a prompt-resolution check reads from a finding (the stored record or the editor's view of it). */
export interface PromptSource {
  key?: string; ruleId?: string; questionKeys: string[];
  voided?: boolean | { mergedInto?: string } | null;
  /** the editor's flat view of `voided.mergedInto` */
  mergedInto?: string;
}

/** Why a typed void reason is refused (null when fine): it is required, and "Merged into …" is reserved for merges. */
export function voidReasonProblem(reason: unknown): string | null {
  const r = typeof reason === "string" ? reason.trim() : "";
  if (!r) return "Say why the finding is being voided.";
  if (r.toLowerCase().startsWith(MERGE_REASON_PREFIX.toLowerCase())) return "That reason is reserved for merges. Use Merge to combine findings.";
  return null;
}

/** A finding's merge target key: `voided.mergedInto`, else the editor's flat `mergedInto`. */
function mergeTargetKey(f: PromptSource): string | undefined {
  const t = typeof f.voided === "object" && f.voided ? f.voided.mergedInto : undefined;
  return typeof t === "string" && t ? t : typeof f.mergedInto === "string" && f.mergedInto ? f.mergedInto : undefined;
}

/**
 * The ONE merge-chain walker (resolvedPromptIds and the report share it): a live finding is its own target; a merged-away
 * one follows `mergedInto` to the live keeper it now lives in. null when the chain ends at a voided finding that was
 * not merged, a missing one, or a cycle.
 */
export function liveMergeTarget<T extends PromptSource>(findingsByKey: Map<string, T>, f: T): T | null {
  const seen = new Set<string>(typeof f.key === "string" ? [f.key] : []);
  let cur = f;
  while (cur.voided) {
    const next = mergeTargetKey(cur);
    if (!next || seen.has(next)) return null;
    seen.add(next);
    const t = findingsByKey.get(next);
    if (!t) return null;
    cur = t;
  }
  return cur;
}

/**
 * Prompt ids (`rule:<id>` / `flag:<key>`) that findings have already turned into a finding — the ONE rule the editor
 * and Mark complete share. A rule prompt is resolved by a finding with that `ruleId`; a flagged-answer prompt (X5) by
 * a finding raised from it (`ruleId` "X5") or one with no rule that links the question. A voided finding resolves
 * nothing — unless a merge voided it: it then carries `mergedInto` (the keeper's key, set only by mergeFindings) and
 * counts only while following the `mergedInto` chain ends at a LIVE finding in the list (a keeper that was later
 * voided, is missing, or a cycle reopens the prompt). The void reason text is never read.
 */
export function resolvedPromptIds(findings: PromptSource[]): string[] {
  const byKey = new Map<string, PromptSource>();
  for (const f of findings) if (typeof f.key === "string") byKey.set(f.key, f);
  const out = new Set<string>();
  for (const f of findings) {
    if (f.voided && !liveMergeTarget(byKey, f)) continue;
    const keys = Array.isArray(f.questionKeys) ? f.questionKeys.filter((k): k is string => typeof k === "string") : [];
    if (typeof f.ruleId === "string" && f.ruleId && f.ruleId !== "X5") out.add(`rule:${f.ruleId}`);
    else for (const k of keys) out.add(`flag:${k}`);
  }
  return [...out];
}

/**
 * Whether changing a short code needs `approve`: true when a live finding of that company (kind "company") or that
 * venue (kind "site") already prints it. `ids` scopes the findings to the record being changed, so another
 * company's findings can't unlock it (or lock it).
 */
export function codeChangeNeedsApprove(
  findings: Pick<Finding, "voided" | "companyCode" | "siteCode" | "customerId" | "siteId">[],
  kind: "company" | "site", code: string | null | undefined, ids: { customerId: string; siteId?: string },
): boolean {
  const scoped = findings.filter((f) => f.customerId === ids.customerId && (kind === "company" || f.siteId === ids.siteId));
  return codeInUse(scoped, code, kind);
}

/** True when a request names a company other than the venue's own. The venue's lock is its own company's, so a
 *  mismatched pair would read the wrong company's findings and could unlock a locked code. */
export function codeScopeMismatch(companyId: string | undefined, site: { companyId: string } | null): boolean {
  return companyId !== undefined && site !== null && site.companyId !== companyId;
}

/** The most ids a finding's photo / question list holds (the store's cap). */
export const FINDING_LIST_MAX = 50;

type Mergeable = Pick<Finding, "key" | "printedId" | "description" | "photoIds" | "questionKeys" | "assessmentId"> & { voided?: unknown };

/**
 * Merge: the FIRST finding is kept and takes the others' descriptions (appended, each once), photos and questions
 * (unioned, first-seen order); every other one is voided with "Merged into <printedId>", so no number is reused.
 * Refused for fewer than two, a repeat, a voided one, findings from different assessments, a kept finding with no
 * number yet, or a union past the list cap.
 */
export function mergePlan(list: Mergeable[]):
  | { ok: true; keep: string; patch: { description: string; photoIds: string[]; questionKeys: string[] }; voids: { key: string; reason: string; mergedInto: string }[] }
  | { ok: false; error: string } {
  if (!Array.isArray(list) || list.length < 2) return { ok: false, error: "Choose at least two findings to merge." };
  if (new Set(list.map((f) => f.key)).size !== list.length) return { ok: false, error: "A finding was chosen twice." };
  if (list.some((f) => f.voided)) return { ok: false, error: "A voided finding can't be merged." };
  if (new Set(list.map((f) => f.assessmentId)).size !== 1) return { ok: false, error: "Only findings from the same assessment can be merged." };
  const [keep, ...rest] = list;
  if (!keep.printedId) return { ok: false, error: "The finding kept by a merge needs its number first. Try again once it has synced." };
  // Deduped by paragraph, so retrying a half-finished merge never appends the same text twice.
  const paras = (d: string | undefined) => (d ?? "").split(/\n{2,}/).map((x) => x.trim()).filter(Boolean);
  const descs: string[] = paras(keep.description);
  for (const f of rest) for (const d of paras(f.description)) if (!descs.includes(d)) descs.push(d);
  const union = (k: "photoIds" | "questionKeys") => [...new Set(list.flatMap((f) => f[k] ?? []))];
  const photoIds = union("photoIds");
  const questionKeys = union("questionKeys");
  if (photoIds.length > FINDING_LIST_MAX || questionKeys.length > FINDING_LIST_MAX) {
    return { ok: false, error: `A finding can hold at most ${FINDING_LIST_MAX} photos and ${FINDING_LIST_MAX} questions.` };
  }
  return {
    ok: true,
    keep: keep.key,
    patch: { description: descs.join("\n\n").slice(0, 5000), photoIds, questionKeys },
    voids: rest.map((f) => ({ key: f.key, reason: mergeReason(keep.printedId!), mergedInto: keep.key })),
  };
}

/** The fields a split copies onto the new finding (everything descriptive; never its number, status or history). */
const SPLIT_COPY = ["customerId", "siteId", "spaceLabel", "assessmentId", "category", "rating", "description", "location", "actionTag", "recommendedAction", "qualification", "priority", "budgetTier", "owner", "auditRef", "immediate"] as const;

/**
 * Split: a new finding duplicating `f` takes the chosen photos and questions, which leave `f`. At least one photo or
 * question must move, and only ones `f` has. The new finding carries no rule (the original keeps it). Both halves
 * must still meet the Immediate-attention rules — refused with those messages otherwise.
 */
export function splitPlan(f: Finding, move: { photoIds: string[]; questionKeys: string[] }, newKey: string):
  | { ok: true; kept: { photoIds: string[]; questionKeys: string[] }; created: Partial<Finding> & { key: string } }
  | { ok: false; error: string } {
  if (f.voided) return { ok: false, error: "A voided finding can't be split." };
  const mp = [...new Set(Array.isArray(move?.photoIds) ? move.photoIds : [])];
  const mq = [...new Set(Array.isArray(move?.questionKeys) ? move.questionKeys : [])];
  if (!mp.length && !mq.length) return { ok: false, error: "Choose the photos or questions that move to the new finding." };
  if (mp.some((p) => !f.photoIds.includes(p)) || mq.some((q) => !f.questionKeys.includes(q))) return { ok: false, error: "Only this finding's own photos and questions can move." };
  const kept = { photoIds: f.photoIds.filter((p) => !mp.includes(p)), questionKeys: f.questionKeys.filter((q) => !mq.includes(q)) };
  const created: Partial<Finding> & { key: string } = { key: newKey, photoIds: mp, questionKeys: mq };
  for (const k of SPLIT_COPY) if (f[k] !== undefined) (created as Record<string, unknown>)[k] = f[k];
  const problems = [
    ...immediateProblems({ ...f, ...kept }).map((p) => `This finding: ${p}`),
    ...immediateProblems({ ...f, ...created } as Finding).map((p) => `The new finding: ${p}`),
  ];
  if (problems.length) return { ok: false, error: problems.join(" ") };
  return { ok: true, kept, created };
}
