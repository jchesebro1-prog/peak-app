/**
 * Estimate suggestion (spec 2026-10-13 §2) — what the Estimator's save does
 * with the suggestion fields, kept out of the "use server" file so the DB
 * checks can run it. Server-only in practice (it reads stores).
 */
import { get as getLead } from "@/lib/stores/leads";
import { getSuggestion, linkSuggestionToQuote } from "@/lib/stores/estimate-suggestions";
import { isSuggestionId } from "@/lib/assist/features/suggestion";
import { unlinkedRetryAllowed } from "@/lib/assist/features/suggestion-panel";
import { HANDOFF_LEAD_RE } from "@/app/(app)/quotes/new/handoff";

/**
 * The lead a NEW quote is stamped with: a well-formed id of a lead that
 * exists, else null (an unknown lead would only skew the estimate number,
 * which carries from the lead). Never used on an update — a saved quote keeps
 * the lead it has.
 */
export async function leadIdForCreate(raw: unknown): Promise<string | null> {
  if (typeof raw !== "string") return null;
  const id = raw.trim();
  if (!id || !HANDOFF_LEAD_RE.test(id)) return null;
  try {
    return (await getLead(id)) ? id : null;
  } catch {
    return null;
  }
}

/**
 * After a save wrote `quote`: link it to the suggestion it was built from
 * (the quote index always; the suggestion's own quoteId keeps the first
 * quote). Unknown or malformed ids are ignored, and a failure never fails
 * the save. True when linked.
 *
 * `created` is true for the create branch (a brand-new quote may link any
 * suggestion). On an update the same rule as the Estimator page applies
 * (`unlinkedRetryAllowed`, against the quote's stored createdAt / customer):
 * a crafted save can't attach a suggestion to an older or another customer's
 * quote, or to one that already belongs to a different quote.
 */
export async function linkSavedQuoteToSuggestion(
  suggestionId: unknown,
  quote: { id: string; createdAt?: number | null; customerId?: string | null } | null | undefined,
  created: boolean
): Promise<boolean> {
  if (!quote?.id || !isSuggestionId(suggestionId)) return false;
  try {
    if (!created) {
      const s = await getSuggestion(suggestionId);
      if (!s || !unlinkedRetryAllowed(s, quote)) return false;
    }
    return await linkSuggestionToQuote(suggestionId, quote.id);
  } catch (e) {
    console.warn("[estimator] could not link the saved quote to its suggestion", e);
    return false;
  }
}
