"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import type { PartLite } from "@/lib/design/grid-bom";
import type { SymbolLook } from "@/lib/design/grid-icons";
import type { DeviceType } from "@/lib/design/device-types";
import { GRID_LAYERS, type GridLayer } from "@/lib/design/grid-scopes";
import { PALETTE_ROW_CAP, isMapped, paletteView, type PaletteTab } from "@/lib/design/grid-palette";
import { SymbolIcon } from "@/components/design/symbol-shape";
import { SearchFilterBar } from "@/components/search/search-filter-bar";
import { useCanMap } from "@/components/design/equipment-map-link";
import { toggleGridFavoriteAction } from "./actions";

/**
 * The Grid's device palette (#226, spec §Screens 2) — moved out of
 * editor.tsx. Tabs Favorites · Recent · All; in All, scope chips → type
 * chips (+ counts) → manufacturer → search; unmapped parts hidden until you
 * search (admins get a link to map them). The star toggle writes the
 * signed-in user's favorites; Recent comes from the server (placeDeviceAction
 * updates it) and refreshes with the page. Filtering is pure
 * (lib/design/grid-palette); this file only renders it.
 */

const BTN: React.CSSProperties = {
  borderWidth: 1, borderStyle: "solid", borderColor: "#dfe2e8",
  background: "#fff",
  borderRadius: 7,
  padding: "5px 10px",
  fontSize: 12,
  fontWeight: 600,
  color: "#3d424e",
  cursor: "pointer",
  fontFamily: "inherit",
};
const PANEL: React.CSSProperties = { background: "#fff", border: "1px solid #edeff3", borderRadius: 10, padding: 12 };
const PANEL_LABEL: React.CSSProperties = { fontSize: 10, fontWeight: 700, letterSpacing: ".06em", textTransform: "uppercase", color: "#9aa0ab", marginBottom: 7 };

function chip(on: boolean): React.CSSProperties {
  return { ...BTN, padding: "4px 7px", fontSize: 10.5, background: on ? "#16181d" : "#fff", color: on ? "#fff" : "#5b616e", borderColor: on ? "#16181d" : "#dfe2e8" };
}

function moneyFmt(n: number): string {
  return "$" + Math.round(n).toLocaleString("en-US");
}

const TABS: Array<{ key: PaletteTab; label: string }> = [
  { key: "favorites", label: "Favorites" },
  { key: "recent", label: "Recent" },
  { key: "all", label: "All" },
];

export default function DevicePalette({
  parts,
  types,
  favorites: initialFavorites,
  recent,
  armedPartId,
  onArm,
  onDisarm,
  isHidden,
  lookOf,
}: {
  parts: PartLite[];
  types: DeviceType[];
  favorites: string[];
  recent: string[];
  armedPartId: string | null;
  /** Arm (or, with null, disarm) a part and clear every other armed tool. */
  onArm: (partId: string | null) => void;
  /** The "Done" button: disarm only. */
  onDisarm: () => void;
  /** True when a part's layer is hidden on the plan. */
  isHidden: (p: PartLite) => boolean;
  lookOf: (p: PartLite) => SymbolLook;
}) {
  const canMap = useCanMap();
  const [tab, setTab] = useState<PaletteTab>("all");
  const [search, setSearch] = useState("");
  const [scope, setScope] = useState<GridLayer | "">("");
  const [typeKey, setTypeKey] = useState("");
  const [mfr, setMfr] = useState("");
  const [favorites, setFavorites] = useState<string[]>(initialFavorites);
  const [starErr, setStarErr] = useState<string | null>(null);
  const [, startStar] = useTransition();

  const activeTypes = useMemo(() => types.filter((t) => !t.archived), [types]);
  const favSet = useMemo(() => new Set(favorites), [favorites]);
  const view = useMemo(
    () => paletteView(parts, { tab, search, scope, typeKey, mfr }, activeTypes, favorites, recent),
    [parts, tab, search, scope, typeKey, mfr, activeTypes, favorites, recent]
  );
  const armedPart = armedPartId ? parts.find((p) => p.id === armedPartId) ?? null : null;

  const pickScope = (s: GridLayer | "") => {
    setScope(s);
    setTypeKey("");
    setMfr("");
  };
  const pickType = (k: string) => {
    setTypeKey((cur) => (cur === k ? "" : k));
    setMfr("");
  };
  const star = (id: string) => {
    const before = favorites;
    setStarErr(null);
    setFavorites(favSet.has(id) ? before.filter((x) => x !== id) : [id, ...before]);
    startStar(async () => {
      const r = await toggleGridFavoriteAction(id);
      if (r.ok) setFavorites(r.favorites);
      else {
        setFavorites(before);
        setStarErr(r.error);
      }
    });
  };

  const emptyText =
    tab === "favorites"
      ? search ? "No favorite matches." : "Star a part (☆) to keep it here."
      : tab === "recent"
        ? search ? "No recent part matches." : "Parts you place show up here."
        : "Nothing matches.";

  return (
    <div style={PANEL}>
      <div style={PANEL_LABEL}>Devices</div>
      <div role="tablist" aria-label="Device lists" style={{ display: "flex", gap: 4, marginBottom: 7 }}>
        {TABS.map((t) => {
          const n = t.key === "favorites" ? favorites.length : t.key === "recent" ? recent.length : null;
          return (
            <button key={t.key} type="button" role="tab" aria-selected={tab === t.key} onClick={() => setTab(t.key)} style={{ ...chip(tab === t.key), flex: 1 }}>
              {t.label}
              {n !== null && <span style={{ opacity: 0.65 }}> {n}</span>}
            </button>
          );
        })}
      </div>
      {/* #121: search + scope filter on ONE row (the chips wrap under the box inside this 252px column). */}
      <SearchFilterBar value={search} onChange={setSearch} placeholder="Search names or Manufacturer #" ariaLabel="Search devices">
        {tab === "all" && (
          <div className="pk-searchbar-group">
            {(["", ...GRID_LAYERS] as Array<GridLayer | "">).map((s) => (
              <button key={s || "all"} type="button" onClick={() => pickScope(s)} style={chip(scope === s)}>
                {s || "All"} <span style={{ opacity: 0.65 }}>{view.scopeCounts[s] || 0}</span>
              </button>
            ))}
          </div>
        )}
      </SearchFilterBar>
      {tab === "all" && scope && view.typeChips.length > 0 && (
        <div aria-label={`${scope} device types`} style={{ display: "flex", flexWrap: "wrap", gap: 3, marginTop: 6 }}>
          {view.typeChips.map((c) => (
            <button key={c.key} type="button" onClick={() => pickType(c.key)} aria-pressed={typeKey === c.key} style={chip(typeKey === c.key)}>
              {c.label} <span style={{ opacity: 0.65 }}>{c.count}</span>
            </button>
          ))}
        </div>
      )}
      {tab === "all" && (view.manufacturers.length > 1 || mfr) && (
        <select
          aria-label="Manufacturer"
          value={mfr}
          onChange={(e) => setMfr(e.target.value)}
          style={{ ...BTN, width: "100%", marginTop: 6, fontWeight: 500, padding: "4px 6px" }}
        >
          <option value="">All manufacturers</option>
          {mfr && !view.manufacturers.includes(mfr) && <option value={mfr}>{mfr}</option>}
          {view.manufacturers.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
      )}
      {armedPart && isHidden(armedPart) && (
        <div style={{ marginTop: 6, fontSize: 10.5, color: "#a0442b", lineHeight: 1.4 }}>
          That part&apos;s layer is hidden, so what you place won&apos;t show until you turn it back on.
        </div>
      )}
      {armedPart ? (
        <div style={{ marginTop: 8, fontSize: 11.5, color: "#2e7d55", fontWeight: 600 }}>
          Painting: {armedPart.sku} — click the plan to place.{" "}
          <button style={{ ...BTN, padding: "2px 7px", fontSize: 10.5, marginLeft: 2 }} onClick={onDisarm}>
            Done
          </button>
        </div>
      ) : (
        <div style={{ marginTop: 8, fontSize: 11, color: "#8c919c" }}>Pick a part, then click the plan for each unit.</div>
      )}
      <div style={{ marginTop: 8, maxHeight: 300, overflowY: "auto", display: "grid", gap: 3 }}>
        {view.rows.slice(0, PALETTE_ROW_CAP).map((p) => {
          const on = p.id === armedPartId;
          const look = lookOf(p);
          const starred = favSet.has(p.id);
          return (
            <div key={p.id}>
              <div style={{ display: "flex", gap: 3, alignItems: "stretch" }}>
                <button
                  onClick={() => onArm(on ? null : p.id)}
                  title={p.desc}
                  style={{
                    ...BTN,
                    flex: 1,
                    minWidth: 0,
                    textAlign: "left",
                    padding: "5px 8px",
                    fontWeight: 500,
                    display: "grid",
                    gap: 1,
                    background: on ? "#16181d" : "#fff",
                    color: on ? "#fff" : "#3d424e",
                    borderColor: on ? "#16181d" : "#dfe2e8",
                  }}
                >
                  <span style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}>
                    <SymbolIcon iconId={look.iconId} color={look.color} size={16} />
                    <strong style={{ fontSize: 11.5, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.desc}</strong>
                    <span style={{ marginLeft: "auto", fontSize: 11 }}>{moneyFmt(p.list)}</span>
                  </span>
                  <span style={{ fontSize: 10.5, color: on ? "#c9cdd6" : "#8c919c", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                    {!isMapped(p) && <span style={{ fontWeight: 700, color: on ? "#f3c9bd" : "#a0442b" }}>Unmapped · </span>}
                    {p.manufacturer ? `${p.manufacturer} · ` : ""}
                    {p.modelNumber || p.sku}
                    {p.kind === "assembly" ? " · assembly" : ""}
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => star(p.id)}
                  aria-pressed={starred}
                  aria-label={starred ? `Unstar ${p.desc}` : `Star ${p.desc}`}
                  title={starred ? "Remove from Favorites" : "Add to Favorites"}
                  style={{ ...BTN, padding: "0 7px", fontSize: 14, color: starred ? "#b88a00" : "#b7bcc6" }}
                >
                  {starred ? "★" : "☆"}
                </button>
              </div>
              {/* Datasheet link (Task 5, punch #39) — a sibling of the arm
                  button, never nested: an <a> inside a <button> is invalid. */}
              {p.hasDatasheet && (
                <a
                  href={`/api/part-datasheet/${encodeURIComponent(p.sku)}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ display: "block", marginTop: 2, padding: "0 8px", fontSize: 10, color: "var(--accent)", textDecoration: "none" }}
                >
                  Datasheet
                </a>
              )}
            </div>
          );
        })}
        {view.rows.length > PALETTE_ROW_CAP && (
          <div style={{ fontSize: 10.5, color: "#9aa0ab", padding: "3px 2px" }}>{view.rows.length - PALETTE_ROW_CAP} more — narrow the search.</div>
        )}
        {view.rows.length === 0 && <div style={{ fontSize: 11.5, color: "#9aa0ab", padding: "3px 2px" }}>{emptyText}</div>}
      </div>
      {view.hiddenUnmapped > 0 && (
        <div style={{ marginTop: 6, fontSize: 10.5, color: "#8c919c", lineHeight: 1.4 }}>
          {view.hiddenUnmapped} unmapped {view.hiddenUnmapped === 1 ? "part" : "parts"} hidden —{" "}
          {canMap ? (
            <Link href="/catalog/device-types" style={{ color: "var(--accent)" }}>
              map them in Catalog → Device types
            </Link>
          ) : (
            "search to find them"
          )}
          .
        </div>
      )}
      {starErr && <div style={{ marginTop: 6, fontSize: 10.5, color: "#a0442b" }}>{starErr}</div>}
    </div>
  );
}
