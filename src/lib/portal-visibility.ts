/**
 * Customer visibility of a catalog part (#242 Task 5, spec §1.3). Pure — no
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
};

export type BrowseRule = { minQuotes: number };

/** An unrecognized or absent stored value reads as "auto" — the default,
 *  rule-driven behavior. */
export function normalizeVisibility(v: unknown): PortalVisibility {
  return v === "show" || v === "hide" ? v : "auto";
}

/** Everything but an explicit Hide can be quoted (staff-side; not gated by
 *  the browse rule at all). */
export function quotable(f: Pick<VisibilityFacts, "visibility">): boolean {
  return f.visibility !== "hide";
}

/** Whether the portal catalog would list this part on its own (browse or
 *  search-result cards), as opposed to only being reachable by an exact
 *  SKU/quote-line lookup. An explicit override always wins; "auto" falls
 *  through to the presentability facts. */
export function browsable(f: VisibilityFacts, rule: BrowseRule): boolean {
  if (f.visibility === "show") return true;
  if (f.visibility === "hide") return false;
  return f.hasVisibleImage || f.hasDatasheet || f.quoteCount >= rule.minQuotes;
}

/** The human-readable reason behind `browsable`'s answer — shown in the
 *  catalog part editor beneath the Auto/Show/Hide selector so an override is
 *  never a mystery. Names the first matching fact in a fixed priority order:
 *  image, then datasheet, then recent quote count. */
export function browseReason(f: VisibilityFacts, rule: BrowseRule): string {
  if (f.visibility === "hide") return "Hidden from customers";
  if (f.visibility === "show") return "Shown by override";
  if (f.hasVisibleImage) return "Browsable: has image";
  if (f.hasDatasheet) return "Browsable: has datasheet";
  if (f.quoteCount >= rule.minQuotes) return `Browsable: quoted ${f.quoteCount} times recently`;
  return "Search only — no image, datasheet, or recent quotes";
}
