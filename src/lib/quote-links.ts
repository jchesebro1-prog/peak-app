/**
 * #221 — the one place that maps a quote to its own builder's edit URL.
 * Copied EXACTLY from the private editHrefFor() that used to live in
 * quotes/page.tsx: every branch, including consulting's and rental's
 * routes, and the same encodeURIComponent(id) query-string shape.
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
    case "flame_test":
      return `/flame-tests/quote?id=${id}`;
    case "repair":
      return `/repairs/quote?id=${id}`;
    case "inspection":
      return `/inspections/quote?id=${id}`;
    case "consulting":
      return `/design/engagements/quote?id=${id}`;
    case "rental":
      return `/rentals/quote?id=${id}`;
    default:
      return `/estimator?id=${id}`;
  }
}

/** True when this quote's builder is NOT the Estimator — i.e. the
 *  Estimator page should redirect an ?id= lookup to the real builder. */
export function estimatorShouldRedirect(q: QuoteLinkInput): boolean {
  return !!q.quoteType && q.quoteType !== "system";
}
