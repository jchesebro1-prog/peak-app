import { estimatorShouldRedirect, type QuoteLinkInput } from "@/lib/quote-links";

/**
 * #314 — "Design in the Grid" from the Estimator's Build package step. Pure
 * and client-safe: which quotes qualify, and the copy the button, its
 * tooltip and the Grid's swapped quote button read.
 *
 * A quote qualifies when its builder IS the Estimator (D-#314): a system
 * quote, an Estimator-built portal quote, a Quick Design promote or a Grid
 * quote opened in the Estimator. Flame-test, repair, inspection, consulting
 * and rental quotes have their own builders and no plan to draw.
 */
export function quoteQualifiesForGrid(q: QuoteLinkInput | null | undefined): boolean {
  return !!q && typeof q.id === "string" && !!q.id && !estimatorShouldRedirect(q);
}

export const GRID_LINK_COPY = {
  design: "Design in the Grid →",
  open: "Open Grid design →",
  opening: "Opening the Grid…",
  saveFirst: "Save the estimate first.",
  notSystem: "Only system estimates can be drawn in the Grid.",
  /** "Generate from Grid" with no linked design yet. */
  generateNeedsDesign: "Design in the Grid first.",
  openEstimate: "Open estimate →",
  gone: "That estimate no longer exists.",
} as const;

/**
 * "Spec from this design →": a Grid quote's spec reads the design's BOM
 * (`?grid=…&quote=…`); an estimate-linked design's parts live in the
 * estimate, so its spec starts from the quote alone.
 */
export function specFromDesignHref(projectId: string, quoteId: string, estimateOwned: boolean): string {
  const q = `quote=${encodeURIComponent(quoteId)}`;
  return estimateOwned ? `/design/specs/new?${q}` : `/design/specs/new?grid=${encodeURIComponent(projectId)}&${q}`;
}

/** The Grid's tooltip on "Open estimate →" (the swapped Add to quotes). */
export function openEstimateTitle(quoteNumber: string): string {
  return `Parts and prices for this design live in estimate ${quoteNumber}.`;
}

/** The intake's note where the Auto card would be. */
export function estimateIntakeNote(quoteNumber: string): string {
  return `Parts come from estimate ${quoteNumber} — place them from the From estimate tray.`;
}
