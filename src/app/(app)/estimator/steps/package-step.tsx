"use client";

import { useRef, useState, type CSSProperties, type KeyboardEvent } from "react";
import { useSearchParams } from "next/navigation";
import dynamic from "next/dynamic";
import {
  boxSalePackageTab,
  nextPackageTab,
  PACKAGE_TAB_LABEL,
  packageTabsFor,
  packageTabId,
  packageTabPanelId,
  packageTabSearch,
  parsePackageTab,
  type PackageTab,
} from "@/lib/estimate-steps/package-tabs";
import PackageDatasheetsTab from "./package-datasheets-tab";
import type { EstimatorState } from "../use-estimator-state";

/** The Estimator's tab look, shared by every tab row. */
const TAB_BTN = (active: boolean): CSSProperties => ({
  fontFamily: "var(--font-ui)",
  fontSize: 12.5,
  fontWeight: 600,
  color: active ? "#16181d" : "#5b616e",
  background: active ? "#fff" : "transparent",
  border: active ? "1px solid #e4e7ec" : "1px solid transparent",
  borderRadius: 7,
  padding: "5px 11px",
  cursor: "pointer",
  whiteSpace: "nowrap",
});

const TAB_LOADING = <div style={{ padding: 24, fontSize: 12.5, color: "#8c919c" }}>Loading…</div>;

/** The estimate tab is code-split: QuoteDocument and the letterhead reach only its chunk (#333 R3). */
const PackageBomTab = dynamic(() => import("./package-bom-tab"), { ssr: false, loading: () => TAB_LOADING });

const PANEL: CSSProperties = { flex: 1, minHeight: 0, minWidth: 0, flexDirection: "column" };

/**
 * #305 — Build package; #379 (Jeff 2026-11-24) — the shell: BOM Estimate
 * Generator · Datasheets (`?ptab=`, the estimate tab paramless; the step
 * shell's own pushState pattern). Each tab is a live preview beside its
 * settings. A panel is mounted once visited and hidden with `display: none`,
 * so its loaded rows survive a tab switch. An unknown or retired `ptab`
 * (narrative, client) reads as the estimate tab.
 */
export function PackageStep({ s }: { s: EstimatorState }) {
  const params = useSearchParams();
  // Box goods sale (spec 2026-10-21): the estimate tab only — ?ptab=datasheets lands on it.
  const tab = boxSalePackageTab(parsePackageTab(params.get("ptab")), s.boxSale);
  const tabs = packageTabsFor(s.boxSale);
  // Mounted once visited; the URL (reload, back/forward) can land on either tab.
  const [visited, setVisited] = useState<Record<PackageTab, boolean>>(() => ({ bom: tab === "bom", datasheets: tab === "datasheets" }));
  if (!visited[tab]) setVisited({ ...visited, [tab]: true });
  const tabRefs = useRef<Partial<Record<PackageTab, HTMLButtonElement | null>>>({});

  /** #333 review (M): a click is a history entry (pushState); an arrow-key move replaces it. */
  const goTab = (to: PackageTab, replace = false) => {
    if (to === tab) return;
    window.history[replace ? "replaceState" : "pushState"](null, "", window.location.pathname + packageTabSearch(window.location.search, to));
  };
  const onTabKey = (e: KeyboardEvent<HTMLButtonElement>) => {
    const to = nextPackageTab(tab, e.key, tabs);
    if (!to) return;
    e.preventDefault();
    goTab(to, true);
    tabRefs.current[to]?.focus();
  };

  return (
    <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap", padding: "8px 14px", borderBottom: "1px solid #e4e7ec", background: "#f7f8fa" }}>
        <div role="tablist" aria-label="Build package" style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
          {tabs.map((t) => (
            <button
              key={t}
              ref={(el) => {
                tabRefs.current[t] = el;
              }}
              id={packageTabId(t)}
              type="button"
              role="tab"
              aria-selected={tab === t}
              // Only a mounted panel is named by aria-controls (#333 review M).
              aria-controls={visited[t] ? packageTabPanelId(t) : undefined}
              tabIndex={tab === t ? 0 : -1}
              onClick={() => goTab(t)}
              onKeyDown={onTabKey}
              style={TAB_BTN(tab === t)}
            >
              {PACKAGE_TAB_LABEL[t]}
            </button>
          ))}
        </div>
      </div>
      {visited.bom && (
        <div id={packageTabPanelId("bom")} role="tabpanel" aria-labelledby={packageTabId("bom")} style={{ ...PANEL, display: tab === "bom" ? "flex" : "none" }}>
          <PackageBomTab s={s} active={tab === "bom"} />
        </div>
      )}
      {visited.datasheets && (
        <div id={packageTabPanelId("datasheets")} role="tabpanel" aria-labelledby={packageTabId("datasheets")} style={{ ...PANEL, display: tab === "datasheets" ? "flex" : "none" }}>
          <PackageDatasheetsTab s={s} active={tab === "datasheets"} />
        </div>
      )}
    </div>
  );
}
