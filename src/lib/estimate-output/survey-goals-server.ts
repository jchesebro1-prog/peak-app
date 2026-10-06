import { get as getSurvey, getAll as allSurveys } from "@/lib/stores/surveys";
import { get as getQuote } from "@/lib/stores/quotes";
import { goalsFromSurvey, siteVisitOptions, type DisciplineGoals, type SiteVisitOption } from "./goals";

/**
 * #301 slice A — server lookups behind the Estimator's goals pre-fill (R3).
 * Read-only. A saved quote's own lead and customer win over anything posted.
 */

export async function surveyGoalsFor(surveyId: string): Promise<{ goals: DisciplineGoals; label: string } | null> {
  const s = await getSurvey(surveyId);
  if (!s) return null;
  return { goals: goalsFromSurvey(s), label: s.venue || s.customer || s.id };
}

export async function siteVisitGoalsFor(input: { quoteId?: string | null; customerId?: string | null }): Promise<SiteVisitOption[]> {
  const q = input.quoteId ? await getQuote(input.quoteId) : null;
  const leadId = q?.leadId ?? null;
  const customerId = q ? q.customerId ?? null : typeof input.customerId === "string" && input.customerId ? input.customerId : null;
  if (!leadId && !customerId) return [];
  return siteVisitOptions(await allSurveys(), { leadId, customerId });
}
