/**
 * Portal shell nav items (#242 Task 10): Home · Catalog · Quote (N). Pure.
 * A team preview (`previewCid`) carries `?preview=` on Home and Catalog, and
 * shows the Quote item disabled with no count — a preview never touches the
 * customer's cart.
 */
export type PortalNavItem = { href: string; label: string; active?: boolean; badge?: number; disabled?: boolean };

export function portalNav(
  active: "home" | "catalog" | "quote",
  opts: { previewCid?: string; cartCount?: number } = {}
): PortalNavItem[] {
  const pv = opts.previewCid ? "?preview=" + encodeURIComponent(opts.previewCid) : "";
  return [
    { href: "/portal" + pv, label: "Home", active: active === "home" },
    { href: "/portal/catalog" + pv, label: "Catalog", active: active === "catalog" },
    opts.previewCid
      ? { href: "/portal/catalog/quote", label: "Quote", active: active === "quote", disabled: true }
      : { href: "/portal/catalog/quote", label: "Quote", active: active === "quote", badge: opts.cartCount ?? 0 },
  ];
}
