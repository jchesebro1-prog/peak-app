/**
 * #242 — the server half of review limits: reads Settings → Review limits and
 * the roster. Never import from a "use client" file (settings and users reach
 * the database); client components receive a ReviewLimitChipData prop.
 */
import { getSettings } from "@/lib/settings";
import { allUsers } from "@/lib/users";
import {
  reviewLimitChip,
  reviewLimitsFrom,
  type ReviewableQuote,
  type ReviewLimitChipData,
  type ReviewLimitContext,
} from "@/lib/review-limits";

/** Limits + roster. getSettings() reads `{}` on a DB error, which fails
 *  closed (no limits → needs review). Sequential on purpose: inside
 *  setStatus's transaction both reads share one handle. */
export async function loadReviewLimitContext(): Promise<ReviewLimitContext> {
  const settings = await getSettings();
  const users = await allUsers();
  return {
    limits: reviewLimitsFrom(settings.reviewLimits),
    roster: users.map((u) => ({ id: u.id, name: u.name, status: u.status })),
  };
}

/** The chip for one saved quote, evaluated against the owner's live limit. */
export async function reviewLimitChipFor(q: ReviewableQuote, viewerName: string): Promise<ReviewLimitChipData | null> {
  return reviewLimitChip(q, await loadReviewLimitContext(), viewerName);
}
