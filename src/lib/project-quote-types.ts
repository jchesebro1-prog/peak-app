/**
 * Quote types that never become an Installs project (the `projects`
 * collection, kind "project"/"order") — each spawns its own downstream
 * record on the win path instead: flame_test/repair/inspection spawn
 * their own service records (flame-jobs.ts/repair-jobs.ts/inspections.ts),
 * rental spawns equipment bookings (equipment-bookings.ts), and consulting
 * spawns a ConsultingEngagement (engagements.ts).
 *
 * One shared list so the four places that need to agree on it can't drift
 * apart independently — which is exactly what happened before this file
 * existed: projects.ts's three checks (createProjectFromQuote,
 * syncProjectsFromQuotes, pendingConversions) and quotes.ts's own #16
 * "Install sold" task gate each carried their own inline copy, and
 * "rental" was missing from all four separately (PUNCHLIST #180 review).
 *
 * Deliberately a plain, dependency-free module — quotes.ts and
 * projects.ts each import it directly, and neither imports the other, so
 * this must not import from either (or from anything that does) to avoid
 * creating a cycle.
 */
export const PROJECT_EXCLUDED_QUOTE_TYPES = [
  "flame_test",
  "repair",
  "inspection",
  "consulting",
  "rental",
] as const;

export type ProjectExcludedQuoteType = (typeof PROJECT_EXCLUDED_QUOTE_TYPES)[number];

/** True when `quoteType` is one of the types above — i.e. this quote never
 *  becomes (or should never become) an Installs project. */
export function isProjectExcludedQuoteType(
  quoteType: string | null | undefined
): quoteType is ProjectExcludedQuoteType {
  return (PROJECT_EXCLUDED_QUOTE_TYPES as readonly string[]).includes(quoteType ?? "");
}
