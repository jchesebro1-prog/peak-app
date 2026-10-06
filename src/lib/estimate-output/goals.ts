import type { SpecSection } from "@/app/(app)/estimator/types";
import { CLIENT_GOALS_MAX, DISCIPLINES, DISCIPLINE_LABEL, cleanPlainText, effectiveDiscipline, type ScopeDiscipline } from "./fields";

/**
 * #301 slice A — the site visit's Client goals (survey `disciplines[key].goals`)
 * and how they reach a quote's systems (R3, R4). Pure and client-safe.
 */

export type DisciplineGoals = Partial<Record<ScopeDiscipline, string>>;

/** R4: each discipline's `goals` cleaned (trimmed, ≤ 1,000); a blank or
 *  non-string one removed; every other field and key untouched. */
export function sanitizeSurveyDisciplineGoals(disciplines: unknown): unknown {
  if (!disciplines || typeof disciplines !== "object" || Array.isArray(disciplines)) return disciplines;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(disciplines as Record<string, unknown>)) {
    if (!v || typeof v !== "object" || Array.isArray(v) || !("goals" in v)) {
      out[k] = v;
      continue;
    }
    const d = { ...(v as Record<string, unknown>) };
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

/** The four disciplines' goals, cleaned again (the sync push path has no sanitizer — R4). */
export function goalsFromSurvey(s: { disciplines?: unknown } | null | undefined): DisciplineGoals {
  const out: DisciplineGoals = {};
  const d = s && s.disciplines && typeof s.disciplines === "object" ? (s.disciplines as Record<string, unknown>) : {};
  for (const k of DISCIPLINES) {
    const branch = d[k];
    const g = branch && typeof branch === "object" ? cleanPlainText((branch as Record<string, unknown>).goals, CLIENT_GOALS_MAX) : "";
    if (g) out[k] = g;
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
