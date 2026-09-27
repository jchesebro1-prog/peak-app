/**
 * Customer visibility of a catalog part (#245 Task 5, spec §1.3). Pure — no
 * store access — so it's exercised directly by the harness.
 *
 * A part is always `quotable` unless a human explicitly hid it: staff can
 * still add any non-Hidden part to a quote regardless of whether the
 * customer portal would ever show it in a browse/search result. `browsable`
 * is the separate, stricter question the portal catalog (later tasks) asks
 * before listing a part on its own: an explicit Show/Hide override wins
 * outright; absent that ("auto"), a part earns its way onto the shelf by
 * having a customer-presentable image, a datasheet, or having actually been
 * quoted recently (`BrowseRule.minQuotes` within the browse window —
 * `quoteCount` is computed by the caller, not here).
 */
export type PortalVisibility = "auto" | "show" | "hide";

export type VisibilityFacts = {
  visibility: PortalVisibility;
  hasVisibleImage: boolean;
  hasDatasheet: boolean;
  quoteCount: number;
  /** An internal catalog row (a labor/travel rate, see
   *  `isInternalCategory`) — hidden under "auto"; "show" still overrides. */
  internal?: boolean;
};

export type BrowseRule = { minQuotes: number };

/** An unrecognized or absent stored value reads as "auto" — the default,
 *  rule-driven behavior. */
export function normalizeVisibility(v: unknown): PortalVisibility {
  return v === "show" || v === "hide" ? v : "auto";
}

/** Catalog categories that are internal rates, not products (#245 Task 11
 *  controller decision): the "Labor" rows carry labor and travel rates. */
const INTERNAL_CATEGORIES = new Set(["labor"]);

/** The reason line for an internal row left on "auto". */
export const INTERNAL_HIDDEN_REASON = "Hidden from customers — labor/travel rate";

/** Whether a catalog category is an internal rate (case-insensitive, trimmed). */
export function isInternalCategory(category: unknown): boolean {
  return typeof category === "string" && INTERNAL_CATEGORIES.has(category.trim().toLowerCase());
}

/** Whether a catalog row is withheld from customers entirely: an explicit
 *  Hide, or an internal (labor/travel) row left on "auto". "show" always
 *  wins, so an internal row a human chose to show stays quotable. */
export function portalHidden(visibility: unknown, category: unknown): boolean {
  const v = normalizeVisibility(visibility);
  return v === "hide" || (v === "auto" && isInternalCategory(category));
}

/** Everything but an explicit Hide (or an internal row on "auto") can be
 *  quoted (staff-side; not gated by the browse rule at all). */
export function quotable(f: Pick<VisibilityFacts, "visibility" | "internal">): boolean {
  if (f.visibility === "hide") return false;
  return !(f.visibility === "auto" && f.internal);
}

/** Whether the portal catalog would list this part on its own (browse or
 *  search-result cards), as opposed to only being reachable by an exact
 *  SKU/quote-line lookup. An explicit override always wins; "auto" falls
 *  through to the presentability facts. */
export function browsable(f: VisibilityFacts, rule: BrowseRule): boolean {
  if (f.visibility === "show") return true;
  if (f.visibility === "hide") return false;
  if (f.internal) return false;
  return f.hasVisibleImage || f.hasDatasheet || f.quoteCount >= rule.minQuotes;
}

/** The human-readable reason behind `browsable`'s answer — shown in the
 *  catalog part editor beneath the Auto/Show/Hide selector so an override is
 *  never a mystery. Names the first matching fact in a fixed priority order:
 *  image, then datasheet, then recent quote count. */
export function browseReason(f: VisibilityFacts, rule: BrowseRule): string {
  if (f.visibility === "hide") return "Hidden from customers";
  if (f.visibility === "show") return "Shown by override";
  if (f.internal) return INTERNAL_HIDDEN_REASON;
  if (f.hasVisibleImage) return "Browsable: has image";
  if (f.hasDatasheet) return "Browsable: has datasheet";
  if (f.quoteCount >= rule.minQuotes) return `Browsable: quoted ${f.quoteCount} times recently`;
  return "Search only — no image, datasheet, or recent quotes";
}
