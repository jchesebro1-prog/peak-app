/**
 * #379 (Jeff 2026-11-24) — the Build package step's two tabs: BOM Estimate
 * Generator (the customer's estimate) and Datasheets (the datasheet package).
 * Each is a live preview beside its settings. They replace #333's Narrative ·
 * BOM quote · Client package. Pure and client-safe: the shell reads `?ptab=`
 * through parsePackageTab and writes it through packageTabSearch (pushState),
 * as the step shell does with `?step=` (steps.ts). BOM Estimate Generator is
 * the default and writes no param; stepSearch drops `ptab` whenever it leaves
 * the package step. An old `?ptab=narrative` / `client` link opens the default.
 */

export const PACKAGE_TABS = ["bom", "datasheets"] as const;
export type PackageTab = (typeof PACKAGE_TABS)[number];

export const PACKAGE_TAB_LABEL: Record<PackageTab, string> = {
  bom: "BOM Estimate Generator",
  datasheets: "Datasheets",
};

/** Missing, unknown, retired or wrong-case → BOM Estimate Generator. */
export function parsePackageTab(raw: string | null | undefined): PackageTab {
  return (PACKAGE_TABS as readonly string[]).includes(raw ?? "") ? (raw as PackageTab) : "bom";
}

/** The `?…` string for `tab`, keeping every other param. BOM Estimate Generator writes no `ptab`. */
export function packageTabSearch(search: string, tab: PackageTab): string {
  const params = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  if (tab === "bom") params.delete("ptab");
  else params.set("ptab", tab);
  const s = params.toString();
  return s ? "?" + s : "";
}

/** Arrow-key navigation across the shown tabs: Left/Right wrap, Home/End jump; any other key → null. */
export function nextPackageTab(current: PackageTab, key: string, tabs: readonly PackageTab[] = PACKAGE_TABS): PackageTab | null {
  const i = tabs.indexOf(current);
  const n = tabs.length;
  if (key === "ArrowRight") return tabs[(i + 1) % n];
  if (key === "ArrowLeft") return tabs[(i - 1 + n) % n];
  if (key === "Home") return tabs[0];
  if (key === "End") return tabs[n - 1];
  return null;
}

export function packageTabId(tab: PackageTab): string {
  return `pkg-tab-${tab}`;
}

export function packageTabPanelId(tab: PackageTab): string {
  return `pkg-panel-${tab}`;
}

/** Box goods sale (spec 2026-10-21): the client link offers no datasheets, so Build package is the estimate tab alone. */
export const BOX_SALE_PACKAGE_TABS: readonly PackageTab[] = ["bom"];

/** The tabs Build package shows. */
export function packageTabsFor(boxSale: boolean): readonly PackageTab[] {
  return boxSale ? BOX_SALE_PACKAGE_TABS : PACKAGE_TABS;
}

/** A box sale lands on the estimate tab whatever `?ptab=` says; otherwise `tab`. */
export function boxSalePackageTab(tab: PackageTab, boxSale: boolean): PackageTab {
  return boxSale ? "bom" : tab;
}
