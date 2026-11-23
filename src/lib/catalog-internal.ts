/* Internal catalog rows (moved from the removed portal visibility rules, #245). Pure. */

/** The stored per-part customer-visibility override. Only the removed customer portal read it; the field stays
 *  on stored parts and is tolerated on read, and nothing edits it any more. */
export type PortalVisibility = "auto" | "show" | "hide";

/** Catalog categories that are internal rates, not products: the "Labor" rows carry labor and travel rates. */
const INTERNAL_CATEGORIES = new Set(["labor"]);

/** Whether a catalog category is an internal rate (case-insensitive, trimmed). */
export function isInternalCategory(category: unknown): boolean {
  return typeof category === "string" && INTERNAL_CATEGORIES.has(category.trim().toLowerCase());
}
