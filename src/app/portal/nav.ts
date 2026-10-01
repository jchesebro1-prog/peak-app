/**
 * Portal shell nav items: Home · Catalog · Service · My quotes · Cart (N)
 * (#245 Task 10; Service added #248 Task 3; My quotes + "Quote" → "Cart"
 * #288). Pure. A team preview (`previewCid`) carries `?preview=` on Home,
 * Catalog, Service and My quotes (which renders read-only), and shows the
 * Cart item disabled with no count — a preview never touches the customer's
 * cart (the service intake itself stays open in preview — it prices
 * read-only, spec §2).
 */
export type PortalNavItem = { href: string; label: string; active?: boolean; badge?: number; disabled?: boolean };

export function portalNav(
  active: "home" | "catalog" | "service" | "my-quotes" | "quote",
  opts: { previewCid?: string; cartCount?: number } = {}
): PortalNavItem[] {
  const pv = opts.previewCid ? "?preview=" + encodeURIComponent(opts.previewCid) : "";
  return [
    { href: "/portal" + pv, label: "Home", active: active === "home" },
    { href: "/portal/catalog" + pv, label: "Catalog", active: active === "catalog" },
    { href: "/portal/service" + pv, label: "Service", active: active === "service" },
    { href: "/portal/my-quotes" + pv, label: "My quotes", active: active === "my-quotes" },
    opts.previewCid
      ? { href: "/portal/catalog/quote", label: "Cart", active: active === "quote", disabled: true }
      : { href: "/portal/catalog/quote", label: "Cart", active: active === "quote", badge: opts.cartCount ?? 0 },
  ];
}
