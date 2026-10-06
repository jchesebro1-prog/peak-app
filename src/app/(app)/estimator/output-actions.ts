"use server";

import { requireUser } from "@/lib/session";
import { siteVisitGoalsFor, surveyGoalsFor } from "@/lib/estimate-output/survey-goals-server";
import type { DisciplineGoals, SiteVisitOption } from "@/lib/estimate-output/goals";

/**
 * #301 slice A — the Estimator's site-visit goals (R3). Signed-in only; reads
 * only. A missing record answers with a message, never a throw.
 */

const ID_MAX = 64;

export async function surveyGoalsAction(
  surveyId: string
): Promise<{ ok: true; goals: DisciplineGoals; label: string } | { ok: false; error: string }> {
  await requireUser();
  const id = typeof surveyId === "string" ? surveyId.trim().slice(0, ID_MAX) : "";
  if (!id) return { ok: false, error: "No site visit is linked." };
  const r = await surveyGoalsFor(id);
  if (!r) return { ok: false, error: "That site visit no longer exists." };
  return { ok: true, goals: r.goals, label: r.label };
}

export async function siteVisitGoalsAction(input: {
  quoteId: string | null;
  customerId: string | null;
}): Promise<{ ok: true; options: SiteVisitOption[] } | { ok: false; error: string }> {
  await requireUser();
  const o = input && typeof input === "object" ? input : { quoteId: null, customerId: null };
  const quoteId = typeof o.quoteId === "string" && o.quoteId ? o.quoteId.slice(0, ID_MAX) : null;
  const customerId = typeof o.customerId === "string" && o.customerId ? o.customerId.slice(0, ID_MAX) : null;
  return { ok: true, options: await siteVisitGoalsFor({ quoteId, customerId }) };
}
