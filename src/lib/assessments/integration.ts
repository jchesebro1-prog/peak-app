/* Assessments engine (#337, Task 11) — the pure view models behind the integration points: the nav badge count, the
   ⌘K result mapping, and the venue / company / lead / project cards. No db / next imports. */
import { allQuestions, VISIT_TYPES, type AssessmentDef } from "./defs";
import { formatValue, type PicklistExtrasVM, type ProfileFactVM } from "./editor-model";
import { pendingPrintedLabel, type Finding } from "./findings-model";
import { RATINGS, RATING_LABEL } from "./register";
import type { Rating } from "./defs/types";

/* ---------- nav badge ---------- */

/** Open = not closed and not voided. */
export const isOpenFinding = (f: Pick<Finding, "status" | "voided">): boolean => f.status !== "closed" && !f.voided;

/** The nav badge: open findings rated Immediate attention. */
export function immediateOpenCount(findings: readonly Pick<Finding, "rating" | "status" | "voided">[]): number {
  let n = 0;
  for (const f of findings) if (f.rating === "immediate" && isOpenFinding(f)) n++;
  return n;
}

/* ---------- ⌘K ---------- */

export interface SearchResult { id: string; title: string; sub: string; href: string; letter: string; color: string }

export const ASSESSMENT_SEARCH_COLOR = "#7a4f1f";
const SUB_MAX = 80;

const STATUS_WORD: Record<string, string> = { draft: "Draft", onsite: "On site", completed: "Completed" };
const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1).trimEnd() + "…" : s);
const one = (s: string) => s.replace(/\s+/g, " ").trim();

type SearchableAssessment = { id: string; status?: string; spaceLabel?: string };

/** Does a stored assessment answer to the typed text (already lower-cased)? Id, status, space, customer, venue, visit type. */
export function matchesAssessment(q: string, a: SearchableAssessment & { visitType?: string }, names: { customer: string; venue: string }): boolean {
  const visitType = VISIT_TYPES.find((v) => v.key === a.visitType)?.title ?? a.visitType ?? "";
  return [a.id, a.status, STATUS_WORD[a.status ?? ""], a.spaceLabel, names.customer, names.venue, visitType].some((s) => typeof s === "string" && s.toLowerCase().includes(q));
}

/** `AS-1001 · <customer>`, sub `<venue> · <status>`; opens the editor. */
export function assessmentSearchResult(a: SearchableAssessment, names: { customer: string; venue: string }): SearchResult {
  const venue = [names.venue, a.spaceLabel].filter(Boolean).join(" — ");
  return {
    id: a.id,
    title: `${a.id} · ${names.customer || "Unknown customer"}`,
    sub: [venue, STATUS_WORD[a.status ?? ""] ?? a.status ?? ""].filter(Boolean).join(" · "),
    href: `/assessments/${encodeURIComponent(a.id)}`,
    letter: "A",
    color: ASSESSMENT_SEARCH_COLOR,
  };
}

type SearchableFinding = Pick<Finding, "key" | "printedId" | "companyCode" | "siteCode" | "category" | "description" | "voided">;

/** A finding answers to its printed id or its description (case-insensitive). */
export function matchesFinding(q: string, f: Pick<Finding, "printedId" | "description" | "key">): boolean {
  return [f.printedId, f.description, f.key].some((s) => typeof s === "string" && s.toLowerCase().includes(q));
}

/** Title the printed id (or its pending label), sub the description (≤ 80 characters); opens the register on it. */
export function findingSearchResult(f: SearchableFinding): SearchResult {
  const desc = clip(one(f.description || ""), SUB_MAX - (f.voided ? 9 : 0));
  return {
    id: f.key,
    title: f.printedId ?? pendingPrintedLabel(f.companyCode, f.siteCode, f.category),
    sub: f.voided ? `Voided — ${desc}` : desc,
    href: `/assessments/findings?focus=${encodeURIComponent(f.key)}`,
    letter: "F",
    color: ASSESSMENT_SEARCH_COLOR,
  };
}

/* ---------- cards ---------- */

export interface RatingCount { rating: Rating; label: string; n: number }

/** Open findings (not closed, not voided) per rating, in the register's order, with the total. */
export function openRatingCounts(findings: readonly Pick<Finding, "rating" | "status" | "voided">[]): { counts: RatingCount[]; total: number } {
  const open = findings.filter(isOpenFinding);
  const counts = RATINGS.map((rating) => ({ rating, label: RATING_LABEL[rating], n: open.filter((f) => f.rating === rating).length }));
  return { counts, total: open.length };
}

export interface AssessmentCardRow { id: string; title: string; sub: string; visitDate: number; status: string; href: string; search: string }

type CardAssessment = { id: string; visitType: string; status: string; visitDate: number; siteId: string; customerId: string; spaceLabel?: string };

/** Newest visit first; each row names the visit type, and (company cards) the venue. */
export function assessmentCardRows(list: readonly CardAssessment[], opts: { siteNames?: Map<string, string>; showVenue?: boolean; openCounts?: Map<string, number> } = {}): AssessmentCardRow[] {
  return [...list]
    .sort((a, b) => b.visitDate - a.visitDate || b.id.localeCompare(a.id, undefined, { numeric: true }))
    .map((a) => {
      const vt = VISIT_TYPES.find((v) => v.key === a.visitType)?.title ?? a.visitType;
      const venue = opts.showVenue ? [opts.siteNames?.get(a.siteId), a.spaceLabel].filter(Boolean).join(" — ") : a.spaceLabel ?? "";
      const open = opts.openCounts?.get(a.id) ?? 0;
      const sub = [venue, vt, STATUS_WORD[a.status] ?? a.status, open ? `${open} open finding${open === 1 ? "" : "s"}` : ""].filter(Boolean).join(" · ");
      return { id: a.id, title: a.id, sub, visitDate: a.visitDate, status: a.status, href: `/assessments/${encodeURIComponent(a.id)}`, search: `${a.id} ${sub}` };
    });
}

export interface ProfileFactRow { key: string; label: string; value: string; from: string; at: number }

/** The confirmed facts, in the definition's question order: a `profile: true` question with a non-empty stored value. */
export function profileFactRows(facts: Record<string, ProfileFactVM> | undefined, def: AssessmentDef, extras: PicklistExtrasVM = {}): ProfileFactRow[] {
  if (!facts) return [];
  const rows: ProfileFactRow[] = [];
  for (const [key, { q }] of allQuestions(def)) {
    if (!q.profile || !Object.hasOwn(facts, key)) continue;
    const f = facts[key];
    if (f.v === undefined || f.v === null || (typeof f.v === "string" && f.v.trim() === "") || (Array.isArray(f.v) && f.v.length === 0)) continue;
    rows.push({ key, label: q.label, value: formatValue(q, f.v, def, extras), from: f.from, at: f.at });
  }
  return rows;
}

/** A Chicago-day label ("Oct 13, 2026"); empty for a missing time. */
export function chicagoDay(ms: number): string {
  return ms ? new Date(ms).toLocaleDateString("en-US", { timeZone: "America/Chicago", month: "short", day: "numeric", year: "numeric" }) : "";
}

/** "confirmed on AS-1001 · Oct 13, 2026"; just "confirmed · <date>" when the source assessment is unknown. */
export function confirmedLine(from: string, at: number): string {
  return ["confirmed" + (from ? ` on ${from}` : ""), chicagoDay(at)].filter(Boolean).join(" · ");
}

/** The register link for a card's counts chip: `?customer=` or `?venue=` plus an optional rating. A rating chip counts
 *  open findings only, so it also asks for `open=1`; the plain Register link shows everything. */
export function registerHref(scope: { customerId?: string; siteId?: string }, rating?: Rating): string {
  const u = new URLSearchParams();
  if (scope.customerId) u.set("customer", scope.customerId);
  if (scope.siteId) u.set("venue", scope.siteId);
  if (rating) { u.set("rating", rating); u.set("open", "1"); }
  const s = u.toString();
  return s ? `/assessments/findings?${s}` : "/assessments/findings";
}

/** The lead a new assessment attaches to: an explicit `?lead=` wins, else the site visit's own lead. */
export function carryLeadId(param: string, visit: { leadId?: string | null } | null | undefined): string {
  return param || visit?.leadId || "";
}

/** Where "Start assessment" goes from each context. */
export function startHref(ctx: { visitId?: string; siteId?: string; customerId?: string; leadId?: string; projectId?: string }): string {
  const u = new URLSearchParams();
  if (ctx.visitId) u.set("visit", ctx.visitId);
  else {
    if (ctx.customerId) u.set("company", ctx.customerId);
    if (ctx.siteId) u.set("site", ctx.siteId);
  }
  if (ctx.leadId) u.set("lead", ctx.leadId);
  if (ctx.projectId) u.set("project", ctx.projectId);
  const s = u.toString();
  return s ? `/assessments/new?${s}` : "/assessments/new";
}

/* ---------- pick-list admin ---------- */

export interface PickListAdminRow {
  id: string;
  title: string;
  usedBy: string[];
  builtIn: { value: string; label: string }[];
  added: { value: string; label: string; retired: boolean }[];
}

/** "arena_bowl" / "venue-types" → "Arena bowl". */
export function listTitle(id: string): string {
  const t = id.replace(/[_.-]+/g, " ").trim();
  return t ? t[0].toUpperCase() + t.slice(1) : id;
}

/** Every code list with its built-in values (read-only) and its added values, sorted by list id. */
export function pickListAdminRows(def: AssessmentDef, extras: PicklistExtrasVM): PickListAdminRow[] {
  const usedBy = new Map<string, string[]>();
  const noteUse = (listId: string | undefined, label: string) => { if (listId) usedBy.set(listId, [...(usedBy.get(listId) ?? []), label]); };
  for (const { q } of allQuestions(def).values()) {
    noteUse(q.options, q.label);
    for (const c of q.columns ?? []) noteUse(c.options, `${q.label} — ${c.label}`);
  }
  const rows: PickListAdminRow[] = [];
  for (const id of Object.keys(def.pickLists).sort()) {
    rows.push({
      id,
      title: listTitle(id),
      usedBy: [...new Set(usedBy.get(id) ?? [])],
      builtIn: def.pickLists[id].map((o) => ({ value: o.value, label: o.label })),
      added: (extras[id] ?? []).map((o) => ({ value: o.value, label: o.label, retired: o.retired === true })),
    });
  }
  return rows;
}
