"use client";

import { useRef, useState, type CSSProperties, type KeyboardEvent } from "react";
import { useSearchParams } from "next/navigation";
import dynamic from "next/dynamic";
import {
  nextPackageTab,
  PACKAGE_TAB_LABEL,
  PACKAGE_TABS,
  packageTabId,
  packageTabPanelId,
  packageTabSearch,
  parsePackageTab,
  type PackageTab,
} from "@/lib/estimate-steps/package-tabs";
import { PackageNarrativeTab } from "./package-narrative-tab";
import ClientPackageTab from "./client-package-tab";
import type { EstimatorState } from "../use-estimator-state";

/** The Customer review step's tab look (review-tabs.tsx), so the two tab rows read as one family. */
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

/** #333 — the BOM quote tab is code-split: QuoteDocument and the letterhead reach only its chunk (R3). */
const PackageBomTab = dynamic(() => import("./package-bom-tab"), { ssr: false, loading: () => TAB_LOADING });

const PANEL: CSSProperties = { flex: 1, minHeight: 0, minWidth: 0, flexDirection: "column" };

/**
 * #305 — Build package; #333 (spec 2026-10-12 §4.1, D-TBD-a) — the shell:
 * Narrative · BOM quote · Client package (`?ptab=`, Narrative paramless; the
 * step shell's own pushState pattern). Every panel stays MOUNTED once
 * visited and is hidden with `display: none`, never unmounted — the
 * Narrative tab's TipTap editor keeps its undo history and its unmount flush
 * never runs on a tab switch. An unknown `ptab` reads as Narrative.
 */
export function PackageStep({ s }: { s: EstimatorState }) {
  const params = useSearchParams();
  const tab = parsePackageTab(params.get("ptab"));
  // Mounted once visited; the URL (reload, back/forward) can land on any tab.
  const [visited, setVisited] = useState<Record<PackageTab, boolean>>(() => ({ narrative: true, bom: tab === "bom", client: tab === "client" }));
  if (!visited[tab]) setVisited({ ...visited, [tab]: true });
  const tabRefs = useRef<Partial<Record<PackageTab, HTMLButtonElement | null>>>({});

  /** #333 review (M): a click is a history entry (pushState); an arrow-key move replaces it. */
  const goTab = (to: PackageTab, anchor?: string, replace = false) => {
    if (to === tab && !anchor) return;
    window.history[replace ? "replaceState" : "pushState"](null, "", window.location.pathname + packageTabSearch(window.location.search, to) + (anchor ? "#" + anchor : ""));
  };
  /** Only a mounted panel is named by aria-controls (#333 review M). */
  const mounted = (t: PackageTab) => t === "narrative" || visited[t];
  const onTabKey = (e: KeyboardEvent<HTMLButtonElement>) => {
    const to = nextPackageTab(tab, e.key);
    if (!to) return;
    e.preventDefault();
    goTab(to, undefined, true);
    tabRefs.current[to]?.focus();
  };
  const presentationHref = packageTabSearch(params.toString(), "client") + "#systems";

  return (
    <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap", padding: "8px 14px", borderBottom: "1px solid #e4e7ec", background: "#f7f8fa" }}>
        <div role="tablist" aria-label="Build package" style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
          {PACKAGE_TABS.map((t) => (
            <button
              key={t}
              ref={(el) => {
                tabRefs.current[t] = el;
              }}
              id={packageTabId(t)}
              type="button"
              role="tab"
              aria-selected={tab === t}
              aria-controls={mounted(t) ? packageTabPanelId(t) : undefined}
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
      <div id={packageTabPanelId("narrative")} role="tabpanel" aria-labelledby={packageTabId("narrative")} style={{ ...PANEL, display: tab === "narrative" ? "flex" : "none" }}>
        <PackageNarrativeTab s={s} active={tab === "narrative"} presentationHref={presentationHref} onOpenPresentation={() => goTab("client", "systems")} />
      </div>
      {visited.bom && (
        <div id={packageTabPanelId("bom")} role="tabpanel" aria-labelledby={packageTabId("bom")} style={{ ...PANEL, display: tab === "bom" ? "flex" : "none" }}>
          <PackageBomTab s={s} active={tab === "bom"} />
        </div>
      )}
      {visited.client && (
        <div id={packageTabPanelId("client")} role="tabpanel" aria-labelledby={packageTabId("client")} style={{ ...PANEL, display: tab === "client" ? "flex" : "none" }}>
          <ClientPackageTab s={s} active={tab === "client"} />
        </div>
      )}
    </div>
  );
}
