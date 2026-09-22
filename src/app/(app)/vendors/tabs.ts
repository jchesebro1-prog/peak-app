/**
 * #122 — vendor detail tab keys. Dependency-free VALUE module so both the
 * server route (validates ?tab=) and client components can import it (the
 * engagements/tabs.ts idiom — never export these from a "use client" file).
 */
export const VENDOR_TABS = ["overview", "contacts", "prices", "activity"] as const;
export type VendorTab = (typeof VENDOR_TABS)[number];

export const VENDOR_TAB_LABEL: Record<VendorTab, string> = {
  overview: "Overview",
  contacts: "Contacts",
  prices: "Price lists",
  activity: "Activity",
};

export function resolveVendorTab(param: string): VendorTab {
  return (VENDOR_TABS as readonly string[]).includes(param) ? (param as VendorTab) : "overview";
}
