"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import Link from "next/link";
import type { PartLite } from "@/lib/design/grid-bom";
import { GRID_CURTAIN_TYPES } from "@/lib/design/grid-bom";
import type { GridLayer } from "@/lib/design/grid-scopes";
import { PALETTE_ROW_CAP, isMapped, paletteView } from "@/lib/design/grid-palette";
import { assemblyParts, libraryQuery, libraryTree, selKey, type LibraryNode, type LibrarySel } from "@/lib/design/grid-library";
import { SymbolIcon } from "@/components/design/symbol-shape";
import { ObjectSymbolImg } from "@/components/design/object-symbol";
import { useCanMap } from "@/components/design/equipment-map-link";
import { toggleGridFavoriteAction } from "../actions";
import AssembliesPanel from "../assemblies-panel";
import EstimateTray from "./estimate-tray";
import { GRID_PART_MIME } from "../plan-canvas";
import type { GridEditor } from "../use-grid-editor";

/**
 * The Grid workspace's Product Library (#299 slice 2, spec §4) — the bottom
 * pane. Left: a category tree (Favorites, Recent, All, scope → device type,
 * Assemblies, Curtains; lib/design/grid-library). Right: search +
 * manufacturer filter over numbered symbol tiles. Click a tile to arm Place
 * (painter mode — click it again to stop); drag a tile onto the plan to
 * place one unit. Filtering stays pure in lib/design/grid-palette
 * (`paletteView(`); this file only renders it. Replaces the old Devices
 * palette, Assemblies card and Curtains card of the left column.
 */

const BTN: React.CSSProperties = {
  borderWidth: 1,
  borderStyle: "solid",
  borderColor: "#dfe2e8",
  background: "#fff",
  borderRadius: 7,
  padding: "5px 10px",
  fontSize: 12,
  fontWeight: 600,
  color: "#3d424e",
  cursor: "pointer",
  fontFamily: "inherit",
};

const FIELD: React.CSSProperties = {
  borderWidth: 1,
  borderStyle: "solid",
  borderColor: "#dfe2e8",
  borderRadius: 7,
  padding: "4px 8px",
  height: 28,
  boxSizing: "border-box",
  fontSize: 12,
  fontFamily: "inherit",
  background: "#fff",
  color: "#16181d",
};

const SELECTED_BG = "color-mix(in srgb, var(--accent) 12%, transparent)";

function moneyFmt(n: number): string {
  return "$" + Math.round(n).toLocaleString("en-US");
}

/* ------------------------------- tree ------------------------------- */

function TreeRows({
  nodes,
  depth,
  selected,
  expanded,
  onPick,
  onToggle,
}: {
  nodes: LibraryNode[];
  depth: number;
  selected: string;
  expanded: GridLayer | null;
  onPick: (sel: LibrarySel) => void;
  onToggle: (scope: GridLayer) => void;
}) {
  return (
    <>
      {nodes.map((n) => {
        const on = n.key === selected;
        const scope = n.sel.kind === "scope" ? n.sel.scope : null;
        const open = scope !== null && scope === expanded;
        return (
          <div key={n.key}>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 2,
                paddingLeft: 4 + depth * 12,
                paddingRight: 6,
                borderRadius: 6,
                background: on ? SELECTED_BG : "transparent",
              }}
            >
              {scope ? (
                <button
                  type="button"
                  onClick={() => onToggle(scope)}
                  aria-expanded={open}
                  aria-label={`${open ? "Collapse" : "Expand"} ${n.label}`}
                  style={{ border: "none", background: "none", padding: 0, width: 14, height: 22, cursor: "pointer", color: "#8c919c", fontSize: 9, flexShrink: 0 }}
                >
                  {open ? "▾" : "▸"}
                </button>
              ) : (
                <span style={{ width: 14, flexShrink: 0 }} />
              )}
              <button
                type="button"
                onClick={() => onPick(n.sel)}
                aria-current={on ? "true" : undefined}
                style={{
                  flex: 1,
                  minWidth: 0,
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  border: "none",
                  background: "none",
                  padding: "4px 0",
                  fontFamily: "inherit",
                  fontSize: 12,
                  fontWeight: on ? 600 : 500,
                  color: "#16181d",
                  cursor: "pointer",
                  textAlign: "left",
                }}
              >
                <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{n.label}</span>
                {n.count !== undefined && <span style={{ fontSize: 11, color: "#8c919c", fontWeight: 500 }}>{n.count}</span>}
              </button>
            </div>
            {n.children && n.children.length > 0 && (
              <TreeRows nodes={n.children} depth={depth + 1} selected={selected} expanded={expanded} onPick={onPick} onToggle={onToggle} />
            )}
          </div>
        );
      })}
    </>
  );
}

/* ------------------------------- tiles ------------------------------- */

const TILE_BTN: React.CSSProperties = {
  ...BTN,
  width: "100%",
  height: "100%",
  minHeight: 112,
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  gap: 4,
  padding: "16px 6px 7px",
  fontWeight: 500,
  textAlign: "center",
  position: "relative",
};

function tileStyle(on: boolean): React.CSSProperties {
  // Armed = a 2px accent border (border + inset ring, so nothing shifts).
  return on ? { ...TILE_BTN, borderColor: "var(--accent)", boxShadow: "inset 0 0 0 1px var(--accent)" } : TILE_BTN;
}

const BADGE: React.CSSProperties = {
  position: "absolute",
  top: 5,
  left: 6,
  fontFamily: "var(--font-mono)",
  fontSize: 10.5,
  color: "#8c919c",
  pointerEvents: "none",
};

const NAME: React.CSSProperties = {
  fontSize: 12,
  lineHeight: 1.25,
  color: "#16181d",
  display: "-webkit-box",
  WebkitLineClamp: 2,
  WebkitBoxOrient: "vertical",
  overflow: "hidden",
  wordBreak: "break-word",
};

/** The part tiles (#226's device palette, now symbol tiles in the Library):
 *  numbered, star to favourite, click to arm, drag onto the plan. */
function DevicePalette({
  ed,
  rows,
  favSet,
  onStar,
  emptyText,
}: {
  ed: GridEditor;
  rows: PartLite[];
  favSet: Set<string>;
  onStar: (id: string) => void;
  emptyText: string;
}) {
  const { armedPartId, lookOf, enterTool, disarm, symbolUrls } = ed;
  return (
    <>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(104px, 1fr))", gap: 8 }}>
        {rows.slice(0, PALETTE_ROW_CAP).map((p, i) => {
          const on = p.id === armedPartId;
          const look = lookOf(p);
          // #300: a part's drawing shows whenever it has one, in either mode.
          const drawing = symbolUrls[p.id]?.plan;
          const starred = favSet.has(p.id);
          return (
            <div key={p.id} style={{ position: "relative", minWidth: 0 }}>
              <button
                type="button"
                draggable
                onDragStart={(e) => {
                  e.dataTransfer.setData(GRID_PART_MIME, p.id);
                  e.dataTransfer.effectAllowed = "copy";
                }}
                onClick={() => (on ? disarm() : enterTool("place", { partId: p.id }))}
                aria-pressed={on}
                title={`${p.desc} — ${[p.manufacturer, p.modelNumber || p.sku].filter(Boolean).join(" ")}`}
                style={tileStyle(on)}
              >
                <span style={BADGE}>{i + 1}</span>
                {drawing ? (
                  <ObjectSymbolImg src={drawing} size={34} fallback={<SymbolIcon iconId={look.iconId} color={look.color} size={34} />} />
                ) : (
                  <SymbolIcon iconId={look.iconId} color={look.color} size={34} />
                )}
                <span style={NAME}>{p.desc}</span>
                <span style={{ marginTop: "auto", fontSize: 11, color: "#8c919c" }}>
                  {!isMapped(p) && <span style={{ fontWeight: 700, color: "#a0442b" }}>Unmapped · </span>}
                  {moneyFmt(p.list)}
                  {p.kind === "assembly" ? " · assembly" : ""}
                </span>
              </button>
              <button
                type="button"
                onClick={() => onStar(p.id)}
                aria-pressed={starred}
                aria-label={starred ? `Unstar ${p.desc}` : `Star ${p.desc}`}
                title={starred ? "Remove from Favorites" : "Add to Favorites"}
                style={{ position: "absolute", top: 2, right: 2, border: "none", background: "none", padding: "1px 4px", fontSize: 14, lineHeight: 1, cursor: "pointer", color: starred ? "#b88a00" : "#b7bcc6" }}
              >
                {starred ? "★" : "☆"}
              </button>
              {/* Datasheet link (Task 5, punch #39) — a sibling of the arm
                  button, never nested: an <a> inside a <button> is invalid. */}
              {p.hasDatasheet && (
                <a
                  href={`/api/part-datasheet/${encodeURIComponent(p.sku)}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  title="Open the datasheet"
                  style={{ position: "absolute", bottom: 4, right: 6, fontSize: 9.5, color: "var(--accent)", textDecoration: "none" }}
                >
                  PDF
                </a>
              )}
            </div>
          );
        })}
      </div>
      {rows.length > PALETTE_ROW_CAP && (
        <div style={{ fontSize: 10.5, color: "#9aa0ab", padding: "6px 2px 0" }}>{rows.length - PALETTE_ROW_CAP} more — narrow the search.</div>
      )}
      {rows.length === 0 && <div style={{ fontSize: 11.5, color: "#9aa0ab", padding: "3px 2px" }}>{emptyText}</div>}
    </>
  );
}

/* ----------------------------- assemblies ----------------------------- */

/** "+ Build assembly": the existing AssembliesPanel (create form + delete
 *  list) in a 360px popover anchored to the button. Fixed-positioned so the
 *  short bottom pane never clips it; opens upward, closes on Escape or a
 *  pointerdown outside. */
function BuildAssembly({ ed }: { ed: GridEditor }) {
  const [at, setAt] = useState<{ left: number; bottom: number } | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const open = at !== null;

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (popRef.current?.contains(t) || btnRef.current?.contains(t)) return;
      setAt(null);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setAt(null);
        btnRef.current?.focus();
      }
    };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const toggle = () => {
    if (open) return setAt(null);
    const r = btnRef.current?.getBoundingClientRect();
    if (!r) return;
    setAt({ left: Math.max(8, Math.min(r.right - 360, window.innerWidth - 368)), bottom: Math.max(8, window.innerHeight - r.top + 6) });
  };

  return (
    <>
      <button ref={btnRef} type="button" onClick={toggle} aria-expanded={open} aria-haspopup="dialog" style={{ ...BTN, height: 28, padding: "0 10px", whiteSpace: "nowrap" }}>
        + Build assembly
      </button>
      {at && (
        <div
          ref={popRef}
          role="dialog"
          aria-label="Build an assembly"
          data-no-nudge
          style={{
            position: "fixed",
            left: at.left,
            bottom: at.bottom,
            width: 360,
            maxHeight: `calc(100vh - ${at.bottom + 16}px)`,
            overflowY: "auto",
            zIndex: 60,
            borderRadius: 10,
            boxShadow: "0 10px 30px rgba(22,24,29,.18)",
          }}
        >
          <AssembliesPanel parts={ed.parts} initialOpen onChanged={() => ed.router.refresh()} />
        </div>
      )}
    </>
  );
}

/* ------------------------------- library ------------------------------- */

export default function ProductLibrary({ ed }: { ed: GridEditor }) {
  const { parts, fabrics, deviceTypes, favorites, setFavorites, recent, armedPartId, armedCurtainType, partLayerHidden, enterTool, disarm, busy, symbolCtx } = ed;
  const canMap = useCanMap();
  const [sel, setSel] = useState<LibrarySel>({ kind: "all" });
  const [expanded, setExpanded] = useState<GridLayer | null>(null);
  const [search, setSearch] = useState("");
  const [mfr, setMfr] = useState("");
  const [starErr, setStarErr] = useState<string | null>(null);
  const [, startStar] = useTransition();
  // #314: a design drawn from an estimate opens on its From estimate tray.
  const hasTray = !!ed.estimateTray;
  const [trayOn, setTrayOn] = useState(true);
  const showTray = hasTray && trayOn;

  const activeTypes = useMemo(() => deviceTypes.filter((t) => !t.archived), [deviceTypes]);
  const favSet = useMemo(() => new Set(favorites), [favorites]);
  const assemblies = useMemo(() => assemblyParts(parts.filter((p) => !p.virtual), search), [parts, search]);
  const assemblyCount = useMemo(() => parts.filter((p) => p.kind === "assembly" && !p.virtual).length, [parts]);
  // The last assembly deleted: fall back to All rather than an orphaned node.
  const current = useMemo<LibrarySel>(() => (sel.kind === "assemblies" && assemblyCount === 0 ? { kind: "all" } : sel), [sel, assemblyCount]);
  const query = useMemo(() => libraryQuery(current, search, mfr), [current, search, mfr]);
  const view = useMemo(() => (query ? paletteView(parts, query, activeTypes, favorites, recent) : null), [parts, query, activeTypes, favorites, recent]);
  // Tree counts: the All view (search-aware), with the expanded scope's type chips.
  const counts = useMemo(
    () => paletteView(parts, { tab: "all", search, scope: expanded ?? "", typeKey: "", mfr: "" }, activeTypes, favorites, recent),
    [parts, search, expanded, activeTypes, favorites, recent]
  );
  const tree = useMemo(
    () =>
      libraryTree({
        scopeCounts: counts.scopeCounts,
        favorites: favorites.length,
        recent: recent.length,
        assemblies: assemblyCount,
        open: expanded ? { kind: "scope", scope: expanded } : { kind: "all" },
        typeChips: counts.typeChips,
      }),
    [counts, favorites.length, recent.length, assemblyCount, expanded]
  );
  const armedPart = armedPartId ? parts.find((p) => p.id === armedPartId) ?? null : null;

  const pick = (s: LibrarySel) => {
    setTrayOn(false);
    setSel(s);
    setMfr("");
    if (s.kind === "scope" || s.kind === "type") setExpanded(s.scope);
  };
  const toggleScope = (s: GridLayer) => {
    const next = expanded === s ? null : s;
    setExpanded(next);
    // A selected type node under a scope that just collapsed would vanish while still
    // filtering the tiles — fall back to that type's scope.
    if (sel.kind === "type" && sel.scope !== next) setSel({ kind: "scope", scope: sel.scope });
  };
  // Moved from the old device palette — optimistic, rolled back on error.
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
    current.kind === "favorites"
      ? search ? "No favorite matches." : "Star a part (☆) to keep it here."
      : current.kind === "recent"
        ? search ? "No recent part matches." : "Parts you place show up here."
        : "Nothing matches.";

  const hint = armedCurtainType
    ? `Dropping a ${armedCurtainType.toLowerCase()}: click the plan, then give it a name and size.`
    : armedPart
      ? `Painting: ${armedPart.sku} — click the plan to place. Esc stops.`
      : current.kind === "curtains"
        ? "Pick a type, click the plan, then specify name, size, fullness and fabric. Priced like the estimator."
        : "Pick a part, then click the plan for each unit — or drag a tile onto the plan.";

  const curtainColor = symbolCtx.colors.Curtains;

  return (
    <div style={{ display: "grid", gridTemplateColumns: "180px minmax(0,1fr)", height: "100%", minHeight: 0, overflow: "hidden" }}>
      <nav aria-label="Library categories" style={{ minHeight: 0, overflowY: "auto", borderRight: "1px solid #edeff3", padding: "6px 4px", background: "#fff" }}>
        {hasTray && (
          <button
            type="button"
            onClick={() => setTrayOn(true)}
            aria-current={showTray ? "true" : undefined}
            style={{
              display: "flex",
              alignItems: "center",
              width: "100%",
              border: "none",
              borderRadius: 6,
              background: showTray ? SELECTED_BG : "transparent",
              padding: "4px 6px 4px 18px",
              marginBottom: 2,
              fontFamily: "inherit",
              fontSize: 12,
              fontWeight: showTray ? 600 : 500,
              color: "#16181d",
              cursor: "pointer",
              textAlign: "left",
            }}
          >
            From estimate
          </button>
        )}
        <TreeRows nodes={tree} depth={0} selected={showTray ? "" : selKey(current)} expanded={expanded} onPick={pick} onToggle={toggleScope} />
      </nav>

      <div style={{ minWidth: 0, minHeight: 0, display: "flex", flexDirection: "column" }}>
        <div style={{ flex: "0 0 auto", display: "flex", flexWrap: "wrap", alignItems: "center", gap: 6, padding: "7px 10px", borderBottom: "1px solid #edeff3", background: "#fff" }}>
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search parts or MFR #"
            aria-label="Search the library"
            style={{ ...FIELD, width: 220, maxWidth: "100%" }}
          />
          {view && (view.manufacturers.length > 1 || mfr) && (
            <select aria-label="Manufacturer" value={mfr} onChange={(e) => setMfr(e.target.value)} style={{ ...FIELD, maxWidth: 200 }}>
              <option value="">All manufacturers</option>
              {mfr && !view.manufacturers.includes(mfr) && <option value={mfr}>{mfr}</option>}
              {view.manufacturers.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          )}
          {view && view.hiddenUnmapped > 0 && (
            <span style={{ fontSize: 10.5, color: "#8c919c", lineHeight: 1.4 }}>
              {view.hiddenUnmapped} unmapped {view.hiddenUnmapped === 1 ? "part" : "parts"} hidden —{" "}
              {canMap ? (
                <Link href="/catalog/device-types" style={{ color: "var(--accent)" }}>
                  map them in Catalog → Device types
                </Link>
              ) : (
                "search to find them"
              )}
              .
            </span>
          )}
          <span
            style={{
              flex: 1,
              minWidth: 160,
              fontSize: 11,
              lineHeight: 1.4,
              color: armedPart || armedCurtainType ? "#2e7d55" : "#8c919c",
              fontWeight: armedPart || armedCurtainType ? 600 : 400,
            }}
          >
            {hint}
          </span>
          <BuildAssembly ed={ed} />
        </div>

        <div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: 10 }}>
          {armedPart && partLayerHidden(armedPart) && (
            <div style={{ marginBottom: 8, padding: "5px 9px", borderRadius: 7, background: "#fbf0ea", fontSize: 11, color: "#a0442b", lineHeight: 1.4 }}>
              That part&apos;s layer is hidden, so what you place won&apos;t show until you turn it back on.
            </div>
          )}
          {starErr && <div style={{ marginBottom: 8, fontSize: 11, color: "#a0442b" }}>{starErr}</div>}

          {showTray ? (
            <EstimateTray ed={ed} />
          ) : current.kind === "curtains" ? (
            <>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(104px, 1fr))", gap: 8 }}>
                {GRID_CURTAIN_TYPES.map((t, i) => {
                  const on = t === armedCurtainType;
                  return (
                    <button
                      key={t}
                      type="button"
                      disabled={busy}
                      aria-pressed={on}
                      title={`${t} curtain — click, then click the plan`}
                      onClick={() => (on ? disarm() : enterTool("curtain", { curtainType: t }))}
                      style={tileStyle(on)}
                    >
                      <span style={BADGE}>{i + 1}</span>
                      <SymbolIcon iconId="curtain" color={curtainColor} size={34} />
                      <span style={NAME}>{t}s</span>
                    </button>
                  );
                })}
              </div>
              {fabrics.length === 0 && (
                <div style={{ marginTop: 8, fontSize: 10.5, color: "#a0442b" }}>No fabric rows in the catalog yet, and a curtain needs one to price.</div>
              )}
            </>
          ) : current.kind === "assemblies" ? (
            <DevicePalette ed={ed} rows={assemblies} favSet={favSet} onStar={star} emptyText="No assembly matches." />
          ) : (
            <DevicePalette ed={ed} rows={view?.rows ?? []} favSet={favSet} onStar={star} emptyText={emptyText} />
          )}

        </div>
      </div>
    </div>
  );
}
