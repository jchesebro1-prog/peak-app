import type { SpecItem, SpecSection } from "@/app/(app)/estimator/types";

/* What stored quotes of the removed customer portal (#245 / #248) still need from the Estimator. The portal itself,
   its carts, pricing and acceptance flow are gone; a quote it created is an ordinary quote now. Pure. */

/**
 * A save never reclassifies a portal-created quote: once a quote's stored `source` is `portal-catalog` or
 * `portal-service`, every later save keeps it (stored data is left alone). Any other prior source (or a fresh
 * create) takes the builder's own stamp.
 */
export function sourceForSave(prior: string | null | undefined, builderSource: string): string {
  return prior === "portal-catalog" || prior === "portal-service" ? prior : builderSource;
}

/**
 * `por` ("price on request") is cleared on any item staff have now priced (`price > 0`), so an old portal line stops
 * printing as price-on-request once it has a price; a line left at 0 stays flagged. `anyConfirm` reports whether any
 * `portalConfirm` item remains (never cleared here). Sections / items not carrying `por` pass through
 * object-identical, so any other quote's save is untouched.
 */
export function clearPricedPor(sections: readonly SpecSection[]): { sections: SpecSection[]; anyPor: boolean; anyConfirm: boolean } {
  let anyPor = false;
  let anyConfirm = false;
  const next = sections.map((s) => {
    let changed = false;
    const items = s.items.map((it) => {
      if (it.portalConfirm) anyConfirm = true;
      if (!it.por) return it;
      if (it.price > 0) {
        changed = true;
        const { por, ...rest } = it;
        void por;
        return rest as SpecItem;
      }
      anyPor = true;
      return it;
    });
    return changed ? { ...s, items } : s;
  });
  return { sections: next, anyPor, anyConfirm };
}
