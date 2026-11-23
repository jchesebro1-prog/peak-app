/**
 * #221 — the one place that maps a quote to its own builder's edit URL.
 * Copied from the private editHrefFor() that used to live in
 * quotes/page.tsx, with the same encodeURIComponent(id) query-string shape.
 * Unknown / missing / "system" quoteType all fall through to the
 * Estimator, since a system (Grid) quote's builder IS the Estimator.
 *
 * Pure — no imports besides types — so client components may import it
 * directly without pulling in a store.
 */

export type QuoteLinkInput = { id: string; quoteType?: string | null };

export function quoteBuilderHref(q: QuoteLinkInput): string {
  const id = encodeURIComponent(q.id);
  switch (q.quoteType) {
    // The consulting, flame test, inspection, repair and rental builders were
    // removed: an old quote of any of those types opens its row in the Quotes
    // hub (status, value and history stay readable).
    case "consulting":
    case "flame_test":
    case "inspection":
    case "repair":
    case "rental":
      return `/quotes?id=${id}`;
    default:
      return `/estimator?id=${id}`;
  }
}

/** True when this quote's builder is NOT the Estimator — i.e. the
 *  Estimator page should redirect an ?id= lookup to the real builder.
 *  #221 fix: derived purely from quoteBuilderHref itself, so an unmapped
 *  quoteType (falls through to the Estimator's own href) never redirects
 *  to the page it's already on — the old `!!quoteType && quoteType !==
 *  "system"` check redirected for ANY other truthy quoteType (e.g. a
 *  "service" value from the Import hub), which sent estimator/page.tsx
 *  into a self-redirect loop. */
export function estimatorShouldRedirect(q: QuoteLinkInput): boolean {
  return !quoteBuilderHref(q).startsWith("/estimator?");
}

/** Quote types whose builder was removed — a row in the Quotes hub only (no builder link, no saved PDF). */
export function hasNoBuilder(quoteType: string | null | undefined): boolean {
  return quoteType === "consulting" || quoteType === "flame_test" || quoteType === "inspection" || quoteType === "repair" || quoteType === "rental";
}
