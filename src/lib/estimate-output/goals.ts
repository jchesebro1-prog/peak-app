import type { SpecSection } from "@/app/(app)/estimator/types";
import { CLIENT_GOALS_MAX, DISCIPLINES, DISCIPLINE_LABEL, cleanPlainText, effectiveDiscipline, type ScopeDiscipline } from "./fields";

/**
 * #301 slice A — the site visit's Client goals (survey `disciplines[key].goals`)
 * and how they reach a quote's systems (R3, R4). Pure and client-safe.
 */

export type DisciplineGoals = Partial<Record<ScopeDiscipline, string>>;

/** #344: a survey goal list. R1 — saving must never shorten anything an old goals string (≤ CLIENT_GOALS_MAX) could
 *  hold: each line is cleaned to CLIENT_GOALS_MAX, blanks dropped, and lines are kept while the joined text
 *  (lines joined with "\n") stays within CLIENT_GOALS_MAX. The editor's own per-goal / count limits are input limits. */
function cleanGoalList(v: unknown[]): string[] {
  const out: string[] = [];
  let len = 0;
  for (const x of v) {
    const line = cleanPlainText(x, CLIENT_GOALS_MAX);
    if (!line) continue;
    const next = len + (out.length ? 1 : 0) + line.length;
    if (next > CLIENT_GOALS_MAX) break;
    out.push(line);
    len = next;
  }
  return out;
}

/** R4: each discipline's `goals` cleaned (trimmed, ≤ 1,000); a blank or
 *  non-string one removed; every other field and key untouched. #344: a goals
 *  list (the read-time migration turns goal text into one) is kept as a cleaned
 *  list, removed when nothing is left. */
export function sanitizeSurveyDisciplineGoals(disciplines: unknown): unknown {
  if (!disciplines || typeof disciplines !== "object" || Array.isArray(disciplines)) return disciplines;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(disciplines as Record<string, unknown>)) {
    if (!v || typeof v !== "object" || Array.isArray(v) || !("goals" in v)) {
      out[k] = v;
      continue;
    }
    const d = { ...(v as Record<string, unknown>) };
    if (Array.isArray(d.goals)) {
      const list = cleanGoalList(d.goals);
      if (list.length) d.goals = list;
      else delete d.goals;
      out[k] = d;
      continue;
    }
    const g = cleanPlainText(d.goals, CLIENT_GOALS_MAX);
    if (g) d.goals = g;
    else delete d.goals;
    out[k] = d;
  }
  return out;
}

/** The survey save rule: a patch carrying `disciplines` gets them cleaned. */
export function withSanitizedSurveyGoals<T extends object>(patch: T): T {
  if (!patch || typeof patch !== "object" || !("disciplines" in patch)) return patch;
  return { ...patch, disciplines: sanitizeSurveyDisciplineGoals((patch as { disciplines?: unknown }).disciplines) } as T;
}

/** The four disciplines' goals, cleaned again (the sync push path has no sanitizer — R4). #344: a goals list
 *  reads as its lines joined with newlines, so the Estimator, cover and package see the same text as before. */
export function goalsFromSurvey(s: { disciplines?: unknown } | null | undefined): DisciplineGoals {
  const out: DisciplineGoals = {};
  const d = s && s.disciplines && typeof s.disciplines === "object" ? (s.disciplines as Record<string, unknown>) : {};
  for (const k of DISCIPLINES) {
    const branch = d[k];
    const raw = branch && typeof branch === "object" ? (branch as Record<string, unknown>).goals : undefined;
    const text = Array.isArray(raw) ? cleanGoalList(raw).join("\n") : raw;
    const g = cleanPlainText(text, CLIENT_GOALS_MAX);
    if (g) out[k] = g;
  }
  return out;
}

const BULLET = /^\s*(?:[-•*]|\d+[.)])\s+/;

/** One goal per line: a stored string splits on newlines with leading bullets dropped; an array is trimmed.
 *  (#344 B7: moved here from survey-flow, which re-exports it, so goals.ts needs no survey-flow import.) */
export function splitGoalLines(v: unknown): string[] {
  if (Array.isArray(v)) return v.map((x) => String(x ?? "").trim()).filter(Boolean);
  if (typeof v !== "string") return [];
  return v.split(/\r?\n/).map((line) => line.replace(BULLET, "").trim()).filter(Boolean);
}

/** #344 B7: the four disciplines' goals as lists, for the recap and the field sheet. A list is cleaned by the same
 *  rule as the save sanitizer (joined text within CLIENT_GOALS_MAX); old goal text is cleaned like goalsFromSurvey's,
 *  then split one goal per line. Disciplines with no goals are left out. */
export function goalListsFromSurvey(s: { disciplines?: unknown } | null | undefined): Partial<Record<ScopeDiscipline, string[]>> {
  const out: Partial<Record<ScopeDiscipline, string[]>> = {};
  const d = s && s.disciplines && typeof s.disciplines === "object" ? (s.disciplines as Record<string, unknown>) : {};
  for (const k of DISCIPLINES) {
    const branch = d[k];
    const raw = branch && typeof branch === "object" ? (branch as Record<string, unknown>).goals : undefined;
    const list = Array.isArray(raw) ? cleanGoalList(raw) : splitGoalLines(cleanPlainText(raw, CLIENT_GOALS_MAX));
    if (list.length) out[k] = list;
  }
  return out;
}

/** R3: blank goals on a system whose discipline (stored, else inferred)
 *  matches get the visit's goals. Returns the SAME array when nothing changes. */
export function fillClientGoals(sections: SpecSection[], goals: DisciplineGoals): SpecSection[] {
  let changed = false;
  const out = sections.map((sec) => {
    if (!sec || (sec.clientGoals || "").trim()) return sec;
    const d = effectiveDiscipline(sec);
    const g = d ? goals[d] : undefined;
    if (!g) return sec;
    changed = true;
    return { ...sec, clientGoals: g };
  });
  return changed ? out : sections;
}

export type SiteVisitSurvey = {
  id: string;
  venue?: string;
  customer?: string;
  customerId?: string | null;
  leadId?: string | null;
  updatedAt?: number;
  disciplines?: unknown;
};
export type SiteVisitEntry = { discipline: ScopeDiscipline; label: string; text: string };
export type SiteVisitOption = { surveyId: string; label: string; entries: SiteVisitEntry[] };

const shortDate = (ms: number) =>
  new Date(ms).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "America/Chicago" });

/** From site visit (R3): the lead's visits + the customer's visits that have
 *  any goals, newest first, at most `limit`. */
export function siteVisitOptions(
  surveys: SiteVisitSurvey[],
  ctx: { leadId?: string | null; customerId?: string | null },
  limit = 5
): SiteVisitOption[] {
  const leadId = ctx.leadId || null;
  const customerId = ctx.customerId || null;
  if (!leadId && !customerId) return [];
  return surveys
    .filter((s) => !!s && ((leadId && s.leadId === leadId) || (customerId && s.customerId === customerId)))
    .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
    .map((s) => {
      const g = goalsFromSurvey(s);
      const entries = DISCIPLINES.filter((k) => !!g[k]).map((k) => ({ discipline: k, label: DISCIPLINE_LABEL[k], text: g[k] as string }));
      return { surveyId: s.id, label: `${s.venue || s.customer || s.id} · ${shortDate(s.updatedAt || 0)}`, entries };
    })
    .filter((o) => o.entries.length > 0)
    .slice(0, limit);
}
