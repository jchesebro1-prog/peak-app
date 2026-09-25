"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { MapFocusRequest, MapPin } from "@/components/map/LeafletMap";
import { LIFECYCLES, LIFECYCLE_LABEL } from "@/lib/identity/config";
import type { CompanySummary } from "@/lib/company-summary";
import { getCompanySummaryAction } from "./actions";
import { ACCENT_INK, ACCENT_SOFT, quoteStatusMeta, typeColor } from "./lib";
import {
  EMPTY_MAP_FILTERS,
  filterMapPoints,
  groupPointsByCompany,
  hasActiveMapFilters,
  mapFilterOptions,
  type CompanyMapFilters,
  type CompanyMapPoint,
} from "./map-filter";

/**
 * The companies map (Jeff's request): a hideable search/filter rail on the
 * left, the map in the middle, and a non-modal pop-out with the company
 * summary on the right. Everything below the pins fetch (filtering,
 * selection, the summary panel) runs client-side against the ONE slim VM
 * the server ships for every located venue — see map-filter.ts for the pure
 * filtering logic this component drives.
 */

const LeafletMap = dynamic(() => import("@/components/map/LeafletMap"), {
  ssr: false,
  loading: () => (
    <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, color: "#8c919c", background: "#e9eef1" }}>
      Loading map…
    </div>
  ),
});

const RAIL_KEY = "quartzite.companies.mapRailOpen";

/**
 * localStorage as an external store, not a set-in-effect: the server always
 * renders the rail open, so a lazy useState initializer reading
 * localStorage would hydrate mismatched, and restoring the remembered
 * choice from a useEffect is a synchronous setState-in-effect (a repo lint
 * error — see estimating-rules/controls.tsx's identical rationale).
 * useSyncExternalStore is the supported shape for both; the snapshot is
 * cached so it stays referentially stable between renders.
 */
let railOpenCache = true;
let railOpenLoaded = false;
const railOpenListeners = new Set<() => void>();

function subscribeRailOpen(cb: () => void): () => void {
  railOpenListeners.add(cb);
  window.addEventListener("storage", cb);
  return () => {
    railOpenListeners.delete(cb);
    window.removeEventListener("storage", cb);
  };
}
function getRailOpenSnapshot(): boolean {
  if (!railOpenLoaded) {
    try {
      railOpenCache = window.localStorage.getItem(RAIL_KEY) !== "0";
    } catch {
      railOpenCache = true; // storage unavailable — stay open
    }
    railOpenLoaded = true;
  }
  return railOpenCache;
}
function getRailOpenServerSnapshot(): boolean {
  return true;
}
function writeRailOpen(next: boolean): void {
  railOpenCache = next;
  railOpenLoaded = true;
  try {
    window.localStorage.setItem(RAIL_KEY, next ? "1" : "0");
  } catch {
    /* ignore */
  }
  for (const l of railOpenListeners) l();
}

const CSS = `
  .cm-rail-row:hover { background: #fafbff; }
  .cm-rail-row.is-selected { background: ${ACCENT_SOFT}; }
  .cm-panel-row:hover { background: #fafbff; }
  .cm-mobile-filters-btn { display: none; }
  @media (max-width: 860px) {
    .cm-rail-wrap { display: none !important; }
    .cm-mobile-filters-btn { display: flex !important; }
    .cm-panel {
      position: fixed !important;
      left: 0 !important;
      right: 0 !important;
      bottom: 0 !important;
      top: auto !important;
      width: 100% !important;
      max-height: 72vh !important;
      border-left: none !important;
      border-top: 1px solid #ececf0 !important;
      border-radius: 14px 14px 0 0 !important;
      box-shadow: 0 -8px 24px rgba(0,0,0,.14) !important;
    }
  }
`;

/** The rail's shared body — search, filters, result list — rendered both
 *  inline (desktop) and inside the full-screen overlay (mobile). */
function RailBody({
  filters,
  setFilters,
  types,
  tags,
  hasDriveData,
  ownerOptions,
  companies,
  filteredCount,
  venueCount,
  selectedId,
  onSelect,
  onClear,
}: {
  filters: CompanyMapFilters;
  setFilters: (f: CompanyMapFilters) => void;
  types: string[];
  tags: string[];
  hasDriveData: boolean;
  ownerOptions: Array<{ value: string; label: string }>;
  companies: ReturnType<typeof groupPointsByCompany>;
  filteredCount: number;
  venueCount: number;
  selectedId: string | null;
  onSelect: (companyId: string) => void;
  onClear: () => void;
}) {
  const patch = (p: Partial<CompanyMapFilters>) => setFilters({ ...filters, ...p });
  const active = hasActiveMapFilters(filters);
  const selectStyle: React.CSSProperties = {
    width: "100%",
    fontSize: 12.5,
    fontFamily: "var(--font-ui)",
    color: "#3a3f4a",
    background: "#fff",
    border: "1px solid #e4e7ec",
    borderRadius: 7,
    padding: "7px 8px",
  };
  const label: React.CSSProperties = { display: "block", fontSize: 10.5, fontWeight: 600, color: "#9aa0ab", letterSpacing: ".03em", textTransform: "uppercase", marginBottom: 4 };

  return (
    <>
      <div style={{ padding: "14px 14px 10px" }}>
        <input
          className="pk-input"
          style={{ width: "100%", fontSize: 13 }}
          placeholder="Search name, venue, city, state…"
          aria-label="Search companies on the map"
          value={filters.q}
          onChange={(e) => patch({ q: e.target.value })}
        />
      </div>

      <div style={{ padding: "0 14px 10px", display: "flex", flexDirection: "column", gap: 10 }}>
        <div>
          <span style={label}>Type</span>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {["all", ...types].map((t) => {
              const isActive = filters.type === t || (t === "all" && (!filters.type || filters.type === "all"));
              return (
                <button
                  key={t}
                  type="button"
                  onClick={() => patch({ type: t })}
                  style={{
                    fontSize: 11,
                    fontWeight: isActive ? 600 : 500,
                    padding: "4px 9px",
                    borderRadius: 20,
                    border: `1px solid ${isActive ? "var(--accent)" : "#e4e7ec"}`,
                    cursor: "pointer",
                    background: isActive ? ACCENT_SOFT : "#fff",
                    color: isActive ? ACCENT_INK : "#5b616e",
                  }}
                >
                  {t === "all" ? "All" : t}
                </button>
              );
            })}
          </div>
        </div>

        <label>
          <span style={label}>Owner</span>
          <select style={selectStyle} value={filters.owner} onChange={(e) => patch({ owner: e.target.value })} aria-label="Owner filter">
            <option value="all">Everyone</option>
            <option value="mine">My work</option>
            {ownerOptions
              .filter((o) => o.value !== "all")
              .map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
          </select>
        </label>

        <label>
          <span style={label}>Lifecycle</span>
          <select style={selectStyle} value={filters.lifecycle} onChange={(e) => patch({ lifecycle: e.target.value })} aria-label="Lifecycle filter">
            <option value="all">All</option>
            {LIFECYCLES.map((l) => (
              <option key={l} value={l}>
                {LIFECYCLE_LABEL[l]}
              </option>
            ))}
          </select>
        </label>

        {tags.length > 0 && (
          <label>
            <span style={label}>Tag</span>
            <select style={selectStyle} value={filters.tag} onChange={(e) => patch({ tag: e.target.value })} aria-label="Tag filter">
              <option value="all">All</option>
              {tags.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </label>
        )}

        {hasDriveData && (
          <label>
            <span style={label}>Drive time</span>
            <select style={selectStyle} value={filters.drive} onChange={(e) => patch({ drive: e.target.value as CompanyMapFilters["drive"] })} aria-label="Drive time filter">
              <option value="">Any</option>
              <option value="30">≤ 30 min</option>
              <option value="60">≤ 60 min</option>
              <option value="120">≤ 120 min</option>
            </select>
          </label>
        )}

        <label style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 12, color: "#3a3f4a" }}>
          <input type="checkbox" checked={filters.hasOpenQuotes} onChange={(e) => patch({ hasOpenQuotes: e.target.checked })} />
          Has open quotes
        </label>

        <button
          type="button"
          className="pk-btn-outline"
          disabled={!active}
          onClick={onClear}
          style={{ opacity: active ? 1 : 0.5, cursor: active ? "pointer" : "default" }}
        >
          Clear filters
        </button>
      </div>

      <div style={{ padding: "9px 14px", fontSize: 11, fontWeight: 600, color: "#8c919c", borderTop: "1px solid #f0f1f4", borderBottom: "1px solid #f0f1f4", background: "#fafbfc" }}>
        {companies.length} compan{companies.length === 1 ? "y" : "ies"} · {filteredCount} venue{filteredCount === 1 ? "" : "s"}
        {filteredCount !== venueCount ? ` of ${venueCount}` : ""}
      </div>

      <div style={{ flex: 1, minHeight: 0, overflowY: "auto" }}>
        {companies.map((c) => (
          <button
            key={c.companyId}
            type="button"
            className={"cm-rail-row" + (c.companyId === selectedId ? " is-selected" : "")}
            onClick={() => onSelect(c.companyId)}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 9,
              width: "100%",
              textAlign: "left",
              padding: "9px 14px",
              border: "none",
              borderBottom: "1px solid #f5f6f8",
              background: "transparent",
              cursor: "pointer",
              font: "inherit",
            }}
          >
            <span style={{ width: 8, height: 8, borderRadius: "50%", background: typeColor(c.type), flexShrink: 0 }} />
            <span style={{ flex: 1, minWidth: 0 }}>
              <span style={{ display: "block", fontSize: 12.5, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{c.name}</span>
              <span style={{ display: "block", fontSize: 11, color: "#9aa0ab", marginTop: 1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                {[c.city, c.state].filter(Boolean).join(", ") || "—"}
                {c.venueCount > 1 ? ` · ${c.venueCount} venues` : ""}
              </span>
            </span>
          </button>
        ))}
        {companies.length === 0 && (
          <div style={{ padding: "30px 16px", textAlign: "center", color: "#9aa0ab", fontSize: 12.5 }}>No companies match these filters.</div>
        )}
      </div>
    </>
  );
}

function PanelSkeleton() {
  const bar = (w: number | string, h = 12) => (
    <div style={{ width: w, height: h, borderRadius: 5, background: "#eef0f3" }} />
  );
  return (
    <div style={{ padding: 18, display: "flex", flexDirection: "column", gap: 12 }}>
      {bar(140, 16)}
      {bar(90, 11)}
      {bar("100%", 11)}
      {bar("70%", 11)}
    </div>
  );
}

function PanelContent({ summary, onFocusVenue }: { summary: CompanySummary; onFocusVenue: (lat: number, lng: number) => void }) {
  const sectionLabel: React.CSSProperties = { fontSize: 10.5, fontWeight: 600, color: "#9aa0ab", letterSpacing: ".05em", textTransform: "uppercase", margin: "18px 0 8px" };
  const tc = typeColor(summary.type);
  return (
    <div style={{ padding: "16px 18px 28px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <span style={{ fontSize: 16, fontWeight: 600 }}>{summary.name}</span>
        {summary.type && (
          <span style={{ fontSize: 10.5, fontWeight: 600, color: tc, background: `color-mix(in srgb, ${tc} 12%, #fff)`, padding: "2px 9px", borderRadius: 20 }}>{summary.type}</span>
        )}
        {summary.lifecycleLabel && summary.lifecycleLabel !== "—" && (
          <span style={{ fontSize: 10.5, fontWeight: 600, color: "#5b616e", background: "#f1f2f5", border: "1px solid #e4e7ec", padding: "2px 9px", borderRadius: 20 }}>{summary.lifecycleLabel}</span>
        )}
      </div>
      {summary.owner && <div style={{ fontSize: 12, color: "#8c919c", marginTop: 6 }}>Owner · {summary.owner}</div>}
      {(summary.phone || summary.website) && (
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginTop: 5, fontSize: 12, color: "#5b616e" }}>
          {summary.phone && <span style={{ fontFamily: "var(--font-mono)" }}>{summary.phone}</span>}
          {summary.website && (
            <a href={/^https?:\/\//i.test(summary.website) ? summary.website : `https://${summary.website}`} target="_blank" rel="noreferrer noopener" style={{ color: "var(--accent)", fontWeight: 600, textDecoration: "none" }}>
              {summary.website}
            </a>
          )}
        </div>
      )}
      {summary.keywords.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 5, marginTop: 8 }}>
          {summary.keywords.map((k) => (
            <span key={k} style={{ fontSize: 10, fontWeight: 600, color: "#5b616e", background: "#f1f2f5", border: "1px solid #e4e7ec", padding: "1px 8px", borderRadius: 20 }}>
              {k}
            </span>
          ))}
        </div>
      )}

      <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
        <Link href={`/companies/${encodeURIComponent(summary.id)}`} className="pk-btn-outline" style={{ textDecoration: "none", display: "inline-block" }}>
          Open company
        </Link>
        <Link href={`/quotes/new?customer=${encodeURIComponent(summary.id)}`} className="pk-btn-accent" style={{ textDecoration: "none", display: "inline-block" }}>
          + New quote
        </Link>
      </div>

      {summary.primaryContact && (
        <>
          <div style={sectionLabel}>Primary contact</div>
          <div style={{ fontSize: 13, fontWeight: 600 }}>{summary.primaryContact.name}</div>
          {summary.primaryContact.role && <div style={{ fontSize: 11.5, color: "#8c919c" }}>{summary.primaryContact.role}</div>}
          <div style={{ display: "flex", flexDirection: "column", gap: 2, marginTop: 4 }}>
            {summary.primaryContact.email && (
              <a href={`mailto:${summary.primaryContact.email}`} style={{ fontSize: 11.5, fontFamily: "var(--font-mono)", color: "var(--accent)", textDecoration: "none" }}>
                {summary.primaryContact.email}
              </a>
            )}
            {summary.primaryContact.phone && (
              <a href={`tel:${summary.primaryContact.phone}`} style={{ fontSize: 11.5, fontFamily: "var(--font-mono)", color: "#5b616e", textDecoration: "none" }}>
                {summary.primaryContact.phone}
              </a>
            )}
          </div>
        </>
      )}

      {summary.venues.length > 0 && (
        <>
          <div style={sectionLabel}>Venues</div>
          {summary.venues.map((v) => (
            <button
              key={v.key}
              type="button"
              className="cm-panel-row"
              disabled={v.lat == null || v.lng == null}
              onClick={() => v.lat != null && v.lng != null && onFocusVenue(v.lat, v.lng)}
              style={{ display: "flex", justifyContent: "space-between", gap: 8, width: "100%", textAlign: "left", padding: "7px 0", border: "none", borderTop: "1px solid #f3f4f7", background: "transparent", cursor: v.lat != null ? "pointer" : "default", font: "inherit" }}
            >
              <span style={{ minWidth: 0 }}>
                <span style={{ display: "block", fontSize: 12.5, fontWeight: 600 }}>{v.label}</span>
                <span style={{ display: "block", fontSize: 11, color: "#9aa0ab" }}>{[v.city, v.state].filter(Boolean).join(", ") || "—"}</span>
              </span>
              <span style={{ fontSize: 11, color: "#8c919c", flexShrink: 0, whiteSpace: "nowrap" }}>{v.driveLabel}</span>
            </button>
          ))}
        </>
      )}

      <div style={sectionLabel}>Quotes · {summary.openValueLabel} open{summary.openCount ? ` (${summary.openCount})` : ""}</div>
      {summary.recentQuotes.length > 0 ? (
        summary.recentQuotes.map((qt) => {
          const m = quoteStatusMeta(qt.status);
          return (
            <Link
              key={qt.id}
              href={qt.href}
              className="cm-panel-row"
              style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, padding: "7px 0", borderTop: "1px solid #f3f4f7", textDecoration: "none", color: "inherit" }}
            >
              <span style={{ minWidth: 0, flex: 1 }}>
                <span style={{ display: "block", fontSize: 12.5, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{qt.name}</span>
                <span style={{ fontSize: 9.5, fontWeight: 600, color: m.ink, background: m.soft, border: `1px solid ${m.bd}`, padding: "1px 7px", borderRadius: 20 }}>{m.label}</span>
              </span>
              <span style={{ fontFamily: "var(--font-mono)", fontSize: 12, fontWeight: 600, flexShrink: 0 }}>{qt.valueLabel}</span>
            </Link>
          );
        })
      ) : (
        <div style={{ fontSize: 12, color: "#9aa0ab" }}>No quotes yet.</div>
      )}

      {summary.activeProjects.length > 0 && (
        <>
          <div style={sectionLabel}>Active projects</div>
          {summary.activeProjects.map((p) => (
            <Link key={p.id} href={p.href} className="cm-panel-row" style={{ display: "flex", justifyContent: "space-between", gap: 8, padding: "7px 0", borderTop: "1px solid #f3f4f7", textDecoration: "none", color: "inherit" }}>
              <span style={{ fontSize: 12.5, fontWeight: 600, minWidth: 0, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{p.name}</span>
              <span style={{ fontSize: 11, color: "#8c919c", flexShrink: 0 }}>{p.stageLabel}</span>
            </Link>
          ))}
        </>
      )}

      {summary.recentActivity.length > 0 && (
        <>
          <div style={sectionLabel}>Recent activity</div>
          {summary.recentActivity.map((a) => (
            <div key={a.id} style={{ padding: "7px 0", borderTop: "1px solid #f3f4f7" }}>
              <div style={{ fontSize: 12, fontWeight: 600, lineHeight: 1.35 }}>{a.title}</div>
              {a.sub && <div style={{ fontSize: 11, color: "#9aa0ab", marginTop: 1 }}>{a.sub}</div>}
            </div>
          ))}
        </>
      )}
    </div>
  );
}

export function CompanyMapClient({
  points,
  initialFilters,
  meName,
  ownerOptions,
}: {
  points: CompanyMapPoint[];
  initialFilters: CompanyMapFilters;
  meName: string;
  ownerOptions: Array<{ value: string; label: string }>;
}) {
  const [filters, setFilters] = useState<CompanyMapFilters>(initialFilters);
  const railOpen = useSyncExternalStore(subscribeRailOpen, getRailOpenSnapshot, getRailOpenServerSnapshot);
  const [mobileRailOpen, setMobileRailOpen] = useState(false);
  const toggleRail = () => writeRailOpen(!railOpen);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [summary, setSummary] = useState<CompanySummary | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [summaryError, setSummaryError] = useState(false);
  const reqRef = useRef(0);
  const focusNonceRef = useRef(0);
  const [focus, setFocus] = useState<MapFocusRequest | null>(null);

  const { types, tags, hasDriveData } = useMemo(() => mapFilterOptions(points), [points]);
  const filtered = useMemo(() => filterMapPoints(points, filters, meName), [points, filters, meName]);
  const companies = useMemo(() => groupPointsByCompany(filtered), [filtered]);

  const pins: MapPin[] = useMemo(
    () =>
      filtered.map((p) => ({
        id: p.companyId + "|" + p.locId,
        lat: p.lat,
        lng: p.lng,
        color: typeColor(p.type),
        label: p.name,
        sub: [p.venueLabel, [p.city, p.state].filter(Boolean).join(", ")].filter(Boolean).join(" · "),
        companyId: p.companyId,
        selected: p.companyId === selectedId,
      })),
    [filtered, selectedId]
  );

  const flyTo = useCallback((pts: Array<{ lat: number; lng: number }>, zoom?: number) => {
    if (!pts.length) return;
    focusNonceRef.current += 1;
    setFocus({ points: pts, nonce: focusNonceRef.current, zoom });
  }, []);

  const selectCompany = useCallback(
    (companyId: string) => {
      setSelectedId(companyId);
      setMobileRailOpen(false);
      // Fly to the currently FILTERED venues — what's actually plotted —
      // not the company's full venue set, which could include a point
      // hidden by the active filters (no visible pin to zoom toward).
      const pts = filtered.filter((p) => p.companyId === companyId).map((p) => ({ lat: p.lat, lng: p.lng }));
      flyTo(pts, pts.length === 1 ? 15 : 12);
    },
    [filtered, flyTo]
  );

  const closePanel = useCallback(() => setSelectedId(null), []);

  // Fetch (or clear) the summary for the selected company. Every setState
  // call is deferred into the setTimeout callback below (the debounced
  // type-ahead in venue-locate-drawer.tsx uses the same shape) — a direct
  // synchronous setState at the top of an effect body is a repo lint error
  // (react-hooks/set-state-in-effect); one inside a nested callback is the
  // supported "subscribe / respond to an external change" shape.
  useEffect(() => {
    let cancelled = false;
    const myReq = ++reqRef.current;
    const t = setTimeout(() => {
      if (cancelled) return;
      if (!selectedId) {
        setSummary(null);
        setSummaryError(false);
        setSummaryLoading(false);
        return;
      }
      setSummaryLoading(true);
      setSummaryError(false);
      setSummary(null);
      getCompanySummaryAction(selectedId)
        .then((s) => {
          if (cancelled || myReq !== reqRef.current) return; // stale response — ignore
          setSummary(s);
          setSummaryError(!s);
          setSummaryLoading(false);
        })
        .catch(() => {
          if (cancelled || myReq !== reqRef.current) return;
          setSummaryError(true);
          setSummaryLoading(false);
        });
    }, 0);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [selectedId]);

  useEffect(() => {
    if (!selectedId) return;
    const k = (e: KeyboardEvent) => e.key === "Escape" && closePanel();
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [selectedId, closePanel]);

  const onPinClick = useCallback(
    (pin: MapPin) => {
      if (!pin.companyId) return;
      setSelectedId(pin.companyId);
      setMobileRailOpen(false);
    },
    []
  );

  const clearFilters = () => setFilters(EMPTY_MAP_FILTERS);

  const railBody = (
    <RailBody
      filters={filters}
      setFilters={setFilters}
      types={types}
      tags={tags}
      hasDriveData={hasDriveData}
      ownerOptions={ownerOptions}
      companies={companies}
      filteredCount={filtered.length}
      venueCount={points.length}
      selectedId={selectedId}
      onSelect={selectCompany}
      onClear={clearFilters}
    />
  );

  return (
    <div style={{ flex: 1, minHeight: 0, display: "flex", overflow: "hidden", position: "relative" }}>
      <style>{CSS}</style>

      <div className="cm-rail-wrap" style={{ flexShrink: 0, display: "flex" }}>
        {railOpen ? (
          <aside aria-label="Map filters" style={{ width: 300, display: "flex", flexDirection: "column", background: "#fff", borderRight: "1px solid #ececf0" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 10px 0 14px" }}>
              <span style={{ fontSize: 12.5, fontWeight: 600 }}>Filters</span>
              <button type="button" className="pk-btn-outline" onClick={toggleRail} title="Hide filters" aria-label="Hide filters" style={{ padding: "3px 8px" }}>
                ‹
              </button>
            </div>
            {railBody}
          </aside>
        ) : (
          <div style={{ width: 36, display: "flex", flexDirection: "column", background: "#fff", borderRight: "1px solid #ececf0" }}>
            <button
              type="button"
              onClick={toggleRail}
              aria-expanded={false}
              title="Show filters"
              style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "flex-start", gap: 10, padding: "12px 0", background: "transparent", border: "none", color: "#9aa0ab", cursor: "pointer", fontFamily: "var(--font-ui)" }}
            >
              <span aria-hidden style={{ fontSize: 15, lineHeight: 1 }}>›</span>
              <span style={{ fontSize: 11, fontWeight: 600, letterSpacing: ".05em", writingMode: "vertical-rl", whiteSpace: "nowrap" }}>Filters</span>
            </button>
          </div>
        )}
      </div>

      <div style={{ flex: 1, minHeight: 0, position: "relative" }}>
        <LeafletMap pins={pins} height="100%" fitMode="once" preferCanvas onPinClick={onPinClick} focus={focus} />
      </div>

      <button
        type="button"
        className="cm-mobile-filters-btn pk-btn-accent"
        onClick={() => setMobileRailOpen(true)}
        style={{ position: "absolute", left: 14, bottom: 14, zIndex: 40, alignItems: "center", gap: 6 }}
      >
        Filters{hasActiveMapFilters(filters) ? " •" : ""}
      </button>

      {mobileRailOpen && (
        <div style={{ position: "fixed", inset: 0, zIndex: 70 }}>
          <div onClick={() => setMobileRailOpen(false)} style={{ position: "absolute", inset: 0, background: "rgba(22,24,29,.28)" }} />
          <div style={{ position: "absolute", top: 0, left: 0, bottom: 0, width: "100%", maxWidth: 340, background: "#fff", display: "flex", flexDirection: "column", boxShadow: "8px 0 24px rgba(0,0,0,.12)" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 14px 0" }}>
              <span style={{ fontSize: 13.5, fontWeight: 600 }}>Filters</span>
              <button type="button" aria-label="Close" onClick={() => setMobileRailOpen(false)} style={{ fontSize: 18, lineHeight: 1, background: "none", border: 0, cursor: "pointer" }}>
                ×
              </button>
            </div>
            {railBody}
          </div>
        </div>
      )}

      {selectedId && (
        <aside
          className="cm-panel"
          role="region"
          aria-label="Company details"
          style={{ position: "relative", width: 380, maxWidth: "100vw", flexShrink: 0, background: "#fff", borderLeft: "1px solid #ececf0", boxShadow: "-8px 0 24px rgba(0,0,0,.08)", overflowY: "auto", zIndex: 30 }}
        >
          <div style={{ position: "sticky", top: 0, display: "flex", justifyContent: "flex-end", padding: "10px 12px 0", background: "#fff" }}>
            <button type="button" aria-label="Close company panel" onClick={closePanel} style={{ fontSize: 18, lineHeight: 1, background: "none", border: 0, cursor: "pointer", color: "#8c919c" }}>
              ×
            </button>
          </div>
          {summaryLoading && <PanelSkeleton />}
          {!summaryLoading && summaryError && (
            <div style={{ padding: 24, textAlign: "center", color: "#9aa0ab", fontSize: 12.5 }}>Couldn&apos;t load this company. Try selecting it again.</div>
          )}
          {!summaryLoading && !summaryError && summary && (
            <PanelContent summary={summary} onFocusVenue={(lat, lng) => flyTo([{ lat, lng }], 16)} />
          )}
        </aside>
      )}
    </div>
  );
}
