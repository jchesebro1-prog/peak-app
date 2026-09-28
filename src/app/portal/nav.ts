/**
 * Portal shell nav items: Home · Catalog · Service · Quote (N) (#245 Task
 * 10; Service added #246 Task 3). Pure. A team preview (`previewCid`)
 * carries `?preview=` on Home, Catalog and Service, and shows the Quote item
 * disabled with no count — a preview never touches the customer's cart (the
 * service intake itself stays open in preview — it prices read-only, spec
 * §2).
 */
export type PortalNavItem = { href: string; label: string; active?: boolean; badge?: number; disabled?: boolean };

export function portalNav(
  active: "home" | "catalog" | "service" | "quote",
  opts: { previewCid?: string; cartCount?: number } = {}
): PortalNavItem[] {
  const pv = opts.previewCid ? "?preview=" + encodeURIComponent(opts.previewCid) : "";
  return [
    { href: "/portal" + pv, label: "Home", active: active === "home" },
    { href: "/portal/catalog" + pv, label: "Catalog", active: active === "catalog" },
    { href: "/portal/service" + pv, label: "Service", active: active === "service" },
    opts.previewCid
      ? { href: "/portal/catalog/quote", label: "Quote", active: active === "quote", disabled: true }
      : { href: "/portal/catalog/quote", label: "Quote", active: active === "quote", badge: opts.cartCount ?? 0 },
  ];
}
