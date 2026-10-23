/**
 * #333 (spec 2026-10-12 §4.1) — the Build package step's three tabs.
 * Pure and client-safe: the shell reads `?ptab=` through parsePackageTab and
 * writes it through packageTabSearch (pushState), as the step shell does with
 * `?step=` (steps.ts). Narrative is the default and writes no param;
 * stepSearch drops `ptab` whenever it leaves the package step.
 */

export const PACKAGE_TABS = ["narrative", "bom", "client"] as const;
export type PackageTab = (typeof PACKAGE_TABS)[number];

export const PACKAGE_TAB_LABEL: Record<PackageTab, string> = {
  narrative: "Narrative",
  bom: "BOM quote",
  client: "Client package",
};

/** Missing, unknown or wrong-case → Narrative. */
export function parsePackageTab(raw: string | null | undefined): PackageTab {
  return (PACKAGE_TABS as readonly string[]).includes(raw ?? "") ? (raw as PackageTab) : "narrative";
}

/** The `?…` string for `tab`, keeping every other param. Narrative writes no `ptab`. */
export function packageTabSearch(search: string, tab: PackageTab): string {
  const params = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  if (tab === "narrative") params.delete("ptab");
  else params.set("ptab", tab);
  const s = params.toString();
  return s ? "?" + s : "";
}

/** Arrow-key navigation across the tabs: Left/Right wrap, Home/End jump; any other key → null. */
export function nextPackageTab(current: PackageTab, key: string): PackageTab | null {
  const i = PACKAGE_TABS.indexOf(current);
  const n = PACKAGE_TABS.length;
  if (key === "ArrowRight") return PACKAGE_TABS[(i + 1) % n];
  if (key === "ArrowLeft") return PACKAGE_TABS[(i - 1 + n) % n];
  if (key === "Home") return PACKAGE_TABS[0];
  if (key === "End") return PACKAGE_TABS[n - 1];
  return null;
}

export function packageTabId(tab: PackageTab): string {
  return `pkg-tab-${tab}`;
}

export function packageTabPanelId(tab: PackageTab): string {
  return `pkg-panel-${tab}`;
}

/** Box goods sale (spec 2026-10-21): the client gets the BOM only, so Build package is the BOM quote tab alone. */
export const BOX_SALE_PACKAGE_TABS: readonly PackageTab[] = ["bom"];

/** The tabs Build package shows. */
export function packageTabsFor(boxSale: boolean): readonly PackageTab[] {
  return boxSale ? BOX_SALE_PACKAGE_TABS : PACKAGE_TABS;
}

/** A box sale lands on BOM quote whatever `?ptab=` says (narrative / client / none); otherwise `tab`. */
export function boxSalePackageTab(tab: PackageTab, boxSale: boolean): PackageTab {
  return boxSale ? "bom" : tab;
}
