"use client";

import dynamic from "next/dynamic";
import { useEffect, useMemo, useRef, useState } from "react";
import { formatMeasure, MEASURE_UNITS, type MeasureUnit, type Point } from "@/lib/annotations";
import { placementQty, routeLengthFt } from "@/lib/design/grid-bom";
import { markerColor } from "@/lib/design/grid-symbols";
import { symbolLook } from "@/lib/design/grid-icons";
import { SymbolShape } from "@/components/design/symbol-shape";
import { ObjectSymbol } from "@/components/design/object-symbol";
import { polygonCentroid } from "@/lib/design/grid-geometry";
import { isSeedPlaceholder } from "@/lib/design/grid-seed";
import { markerBox } from "@/lib/design/grid-symbol-display";
import { DESIGNATOR_DUPLICATE_COLOR, formatDesignator } from "@/lib/design/designators";
import CurtainDrop from "./curtain-drop";
import PlanLegend from "./plan-legend";
import type { GridEditor } from "./use-grid-editor";

const PdfCanvas = dynamic(() => import("@/components/design/pdf-canvas"), { ssr: false });

/**
 * The Grid's plan (#299) — the sheet render, the SVG overlay of spaces,
 * routes and markers, the legend and the on-canvas popovers, moved out of
 * editor.tsx unchanged. Adds the hand tool (H, or Space held), the
 * cursor-position feed and the palette drop target.
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

const INPUT: React.CSSProperties = {
  borderWidth: 1, borderStyle: "solid", borderColor: "#dfe2e8",
  borderRadius: 7,
  padding: "5px 8px",
  fontSize: 12,
  fontFamily: "inherit",
  background: "#fff",
  color: "#16181d",
  width: "100%",
};

const PANEL_LABEL: React.CSSProperties = {
  fontSize: 10,
  fontWeight: 700,
  letterSpacing: ".06em",
  textTransform: "uppercase",
  color: "#9aa0ab",
  marginBottom: 7,
};

/** The palette's drag payload type (a part id). */
export const GRID_PART_MIME = "application/x-grid-part";

/** Space held as the hand tool: never while typing. */
function isEditable(target: EventTarget | null): boolean {
  const t = target instanceof Element ? target : null;
  const tag = t?.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || (t instanceof HTMLElement && t.isContentEditable);
}

export default function PlanCanvas(props: { ed: GridEditor; onDropPart?: (partId: string, at: Point) => void }) {
  const { ed, onDropPart } = props;
  const {
    project,
    fabrics,
    specKeys,
    symbolCtx,
    symbolDisplay,
    symbolUrls,
    designatorDupes,
    designatorDigits,
    selectedIds,
    marquee,
    cancelGesture,
    sheet,
    isPdf,
    page,
    zoom,
    size,
    setSize,
    busy,
    armedCurtainType,
    curtainAt,
    setCurtainAt,
    drag,
    calibrating,
    calDraft,
    pending,
    setPending,
    entry,
    setEntry,
    calUnit,
    setCalUnit,
    spaceDrawing,
    spaceDraft,
    setSpaceDraft,
    selectedSpaceId,
    wireDrawing,
    wireDraft,
    selectedRouteId,
    wrapRef,
    scrollRef,
    fileRef,
    onLoaded,
    onSize,
    partById,
    lookOf,
    visiblePlacements,
    planLegendRows,
    pageSpaces,
    visibleRoutes,
    armedPart,
    onDown,
    onMove,
    onUp,
    dropCurtain,
    confirmSpace,
    confirmCalibration,
    toNorm,
    tool,
    spaceHeld,
    setSpaceHeld,
    clearCursorAt,
    snap,
  } = ed;

  // The sheet's rendered pixel size (#299 snap dots) — observed rather than
  // derived, so it tracks zoom, a PDF page re-render and a sheet switch alike.
  const [boxPx, setBoxPx] = useState<{ w: number; h: number } | null>(null);
  const sheetId = sheet?.id;
  useEffect(() => {
    const el = wrapRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(([entry]) => {
      const w = entry.contentRect.width;
      const h = entry.contentRect.height;
      setBoxPx((prev) => (prev && prev.w === w && prev.h === h ? prev : { w, h }));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [wrapRef, sheetId]);
  /** The snap grid's dot pattern, or null: snap off, no size yet, or a step
   *  under 6 px on screen (too dense to read — snapping still applies). */
  const dotStep = snap && boxPx ? { x: snap.stepX * boxPx.w, y: snap.stepY * boxPx.h } : null;
  const dots = dotStep && dotStep.x >= 6 && dotStep.y >= 6 ? dotStep : null;

  // Space held = the hand tool while it's down. Bound to the window (the plan
  // has no focus of its own); a text field keeps its space bar, and the page
  // only loses its space-to-scroll while the pointer is over the plan.
  const overRef = useRef(false);
  /** Every selected device gets the dashed ring (#299 multi-select). */
  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.code !== "Space" || isEditable(e.target)) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (overRef.current) e.preventDefault();
      setSpaceHeld(true);
    };
    const up = (e: KeyboardEvent) => {
      if (e.code === "Space") setSpaceHeld(false);
    };
    // A keyup lost to another window must not leave the hand stuck on.
    const blur = () => setSpaceHeld(false);
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", blur);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", blur);
    };
  }, [setSpaceHeld]);

  // The pan gesture: scroll the box by however far the pointer travelled.
  const panStart = useRef<{ x: number; y: number; left: number; top: number } | null>(null);
  const [grabbing, setGrabbing] = useState(false);
  const panOn = tool === "pan" || spaceHeld;
  const panCursor = grabbing ? "grabbing" : panOn ? "grab" : null;

  return (
    <div
      ref={scrollRef}
      onPointerEnter={() => {
        overRef.current = true;
      }}
      onPointerLeave={() => {
        overRef.current = false;
      }}
      // Clicking the plan takes focus out of a field (the device search…) so
      // V/H/Escape/Delete work again. Capture phase = before any other handling;
      // the inline popovers (curtain, calibrate, space) keep their own focus.
      onPointerDownCapture={(e) => {
        const hit = e.target instanceof Element ? e.target : null;
        if (hit?.closest("[data-plan-popover], input, select, textarea, label")) return;
        const ae = document.activeElement;
        if (ae instanceof HTMLElement && ae !== document.body && isEditable(ae)) ae.blur();
      }}
      // Pan (#299). Runs on the box, so the plan's own onDown sees the same
      // pointerdown and bails (it checks the hand tool first); capture keeps
      // the plan's onMove/onUp out of the gesture entirely.
      onPointerDown={(e) => {
        const hit = e.target instanceof Element ? e.target : null;
        if (!panOn || e.button !== 0 || !sheet) return;
        // Let the no-sheet upload button (and any control) take its own click.
        if (hit?.closest("button, a, input, select, textarea, label")) return;
        const box = e.currentTarget;
        panStart.current = { x: e.clientX, y: e.clientY, left: box.scrollLeft, top: box.scrollTop };
        setGrabbing(true);
        box.setPointerCapture?.(e.pointerId);
        e.preventDefault();
      }}
      onPointerMove={(e) => {
        const start = panStart.current;
        if (!start) return;
        const box = e.currentTarget;
        box.scrollLeft = start.left - (e.clientX - start.x);
        box.scrollTop = start.top - (e.clientY - start.y);
      }}
      onPointerUp={() => {
        panStart.current = null;
        setGrabbing(false);
      }}
      onPointerCancel={() => {
        panStart.current = null;
        setGrabbing(false);
      }}
      onLostPointerCapture={() => {
        panStart.current = null;
        setGrabbing(false);
      }}
      // #299: fills the workspace's center pane (flex: 1 in its column). The
      // sheet centres by its own auto margins, not justify-content — centred
      // flex content that overflows is cut off on the left, past scrolling.
      style={{ flex: 1, minHeight: 0, overflow: "auto", background: "#6d7076", padding: 18, display: "flex", justifyContent: sheet ? undefined : "center", cursor: panCursor ?? undefined }}
    >
      {!sheet ? (
        <div style={{ alignSelf: "center", color: "#e6e8ec", fontSize: 13.5, textAlign: "center", lineHeight: 1.6 }}>
          No plan sheets yet.
          <br />
          <button style={{ ...BTN, marginTop: 10 }} disabled={busy} onClick={() => fileRef.current?.click()}>
            Upload a PDF or image
          </button>
        </div>
      ) : (
        <div
          ref={wrapRef}
          onPointerDown={onDown}
          onPointerMove={onMove}
          onPointerUp={onUp}
          // A cancelled pointer (browser gesture, lost capture) abandons
          // the drag rather than committing wherever it stopped.
          onPointerCancel={cancelGesture}
          onPointerLeave={clearCursorAt}
          // Palette drag-and-drop (#299): a drop places one unit where it
          // lands and arms nothing.
          onDragOver={(e) => {
            if (e.dataTransfer.types.includes(GRID_PART_MIME)) e.preventDefault();
          }}
          onDrop={(e) => {
            const id = e.dataTransfer.getData(GRID_PART_MIME);
            if (!id) return;
            e.preventDefault();
            const p = toNorm(e);
            if (p) onDropPart?.(id, p);
          }}
          style={{
            position: "relative",
            // Auto margins centre the sheet when it is smaller than the box
            // and stop it stretching to the box's height (the overlay and
            // toNorm read this box's size — it must be exactly the sheet).
            margin: "auto",
            flex: "0 0 auto",
            lineHeight: 0,
            cursor:
              panCursor ??
              (drag?.moved
                ? "grabbing"
                : pending || curtainAt
                  ? "default"
                  : calibrating || armedPart || armedCurtainType || spaceDrawing || wireDrawing
                    ? "crosshair"
                    : "default"),
            touchAction: "none",
            background: "#fff",
            boxShadow: "0 2px 14px rgba(0,0,0,.28)",
          }}
        >
          {isPdf ? (
            <PdfCanvas key={sheet.id} dataUrl={sheet.dataUrl} page={page} zoom={zoom} onLoaded={onLoaded} onSize={onSize} />
          ) : (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={sheet.dataUrl}
              alt={sheet.name}
              // The browser's own image drag would start on any press-and-move
              // and cancel the pointer (pointercancel), killing marker drags
              // and the marquee (#299) on image sheets.
              draggable={false}
              // Intrinsic dimensions, not clientWidth: onLoad can fire
              // before layout (and never fires for cached images), which
              // left size at 0×0 and broke the calibration math. The
              // callback ref covers already-complete images; aspect only
              // needs the ratio, so natural units are exactly right.
              // The functional update MUST return the same object when
              // nothing changed — an inline ref runs on every commit, and
              // unconditionally setting fresh state here is a render loop.
              ref={(el) => {
                if (el && el.complete && el.naturalWidth) {
                  const w = el.naturalWidth;
                  const h = el.naturalHeight;
                  setSize((s) => (s.w === w && s.h === h ? s : { w, h }));
                }
              }}
              onLoad={(e) =>
                setSize({
                  w: e.currentTarget.naturalWidth || e.currentTarget.clientWidth,
                  h: e.currentTarget.naturalHeight || e.currentTarget.clientHeight,
                })
              }
              style={{ width: `${Math.round(900 * zoom)}px`, height: "auto", display: "block" }}
            />
          )}

          {dots && (
            // Snap grid dots: over the sheet, under the overlay. The pattern
            // is shifted half a tile so each dot sits ON a grid point (a
            // radial gradient centres in its tile).
            <div
              aria-hidden
              data-snap-dots
              style={{
                position: "absolute",
                inset: 0,
                pointerEvents: "none",
                backgroundImage: "radial-gradient(rgba(0,0,0,.28) 1px, transparent 1.2px)",
                backgroundSize: `${dots.x}px ${dots.y}px`,
                backgroundPosition: `${-dots.x / 2}px ${-dots.y / 2}px`,
              }}
            />
          )}
          <svg
            width={size.w}
            height={size.h}
            viewBox={`0 0 ${size.w} ${size.h}`}
            style={{ position: "absolute", inset: 0, width: "100%", height: "100%", pointerEvents: "none" }}
          >
            {/* spaces render UNDER the device markers */}
            {pageSpaces.map((s) => {
              const pts = s.points.map((p) => `${p.x * size.w},${p.y * size.h}`).join(" ");
              const c = polygonCentroid(s.points);
              const on = s.id === selectedSpaceId;
              return (
                <g key={s.id}>
                  <polygon
                    points={pts}
                    fill={s.color}
                    opacity={on ? 0.22 : 0.13}
                    stroke={s.color}
                    strokeWidth={on ? 2.5 : 1.5}
                    strokeOpacity={0.55}
                    strokeDasharray={on ? "6 4" : undefined}
                  />
                  <g>
                    <rect
                      x={c.x * size.w - s.name.length * 3.6 - 6}
                      y={c.y * size.h - 9}
                      width={s.name.length * 7.2 + 12}
                      height={18}
                      rx={5}
                      fill="#fff"
                      stroke={s.color}
                      strokeWidth={1}
                      opacity={0.92}
                    />
                    <text
                      x={c.x * size.w}
                      y={c.y * size.h + 4}
                      fill={s.color}
                      fontSize={11}
                      fontWeight={700}
                      textAnchor="middle"
                      style={{ fontFamily: "inherit" }}
                    >
                      {s.name}
                    </text>
                  </g>
                </g>
              );
            })}
            {/* space being drawn: open polyline + corner dots */}
            {spaceDraft.length > 0 && (
              <g>
                <polyline
                  points={spaceDraft.map((p) => `${p.x * size.w},${p.y * size.h}`).join(" ")}
                  fill="none"
                  stroke="#8a6d3b"
                  strokeWidth={2}
                  strokeDasharray="5 4"
                />
                {spaceDraft.map((p, i) => (
                  <circle
                    key={i}
                    cx={p.x * size.w}
                    cy={p.y * size.h}
                    r={i === 0 ? 7 : 4}
                    fill={i === 0 ? "#fff" : "#8a6d3b"}
                    stroke="#8a6d3b"
                    strokeWidth={2}
                  />
                ))}
              </g>
            )}
            {pending?.kind === "space" && (
              <polygon
                points={pending.points.map((p) => `${p.x * size.w},${p.y * size.h}`).join(" ")}
                fill="#8a6d3b"
                opacity={0.15}
                stroke="#8a6d3b"
                strokeWidth={2}
              />
            )}
            {/* wire routes (D110) - dashed polylines with a length chip.
                Hidden scopes take their wires with them (#48). */}
            {visibleRoutes.map((r) => {
              const part = partById.get(r.partId);
              const c = markerColor(part?.category || "Wire");
              const on = r.id === selectedRouteId;
              const pts = r.points.map((q) => `${q.x * size.w},${q.y * size.h}`).join(" ");
              const midIdx = Math.floor((r.points.length - 1) / 2);
              const mA = r.points[midIdx];
              const mB = r.points[Math.min(midIdx + 1, r.points.length - 1)];
              const mx = ((mA.x + mB.x) / 2) * size.w;
              const my = ((mA.y + mB.y) / 2) * size.h;
              const ft = routeLengthFt(r, project.calibrations);
              const calHere = project.calibrations.find(
                (cc) => cc.docId === r.sheetId && cc.page === r.page
              );
              const label = ft !== null && calHere ? formatMeasure(ft, calHere.unit) : "unmeasured";
              return (
                <g key={r.id}>
                  <polyline
                    points={pts}
                    fill="none"
                    stroke={c}
                    strokeWidth={on ? 4 : 2.5}
                    strokeDasharray="8 5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                  {r.points.map((q, i) => (
                    <circle key={i} cx={q.x * size.w} cy={q.y * size.h} r={3} fill={c} />
                  ))}
                  <g>
                    <rect x={mx - 30} y={my - 20} width={60} height={16} rx={4} fill="#fff" stroke={c} strokeWidth={1} opacity={0.95} />
                    <text x={mx} y={my - 8} fill={c} fontSize={10.5} fontWeight={700} textAnchor="middle" style={{ fontFamily: "inherit" }}>
                      {label}
                    </text>
                  </g>
                </g>
              );
            })}
            {wireDraft.length > 0 && (
              <g>
                <polyline
                  points={wireDraft.map((q) => `${q.x * size.w},${q.y * size.h}`).join(" ")}
                  fill="none"
                  stroke="#3155a8"
                  strokeWidth={2.5}
                  strokeDasharray="8 5"
                />
                {wireDraft.map((q, i) => (
                  <circle
                    key={i}
                    cx={q.x * size.w}
                    cy={q.y * size.h}
                    r={i === wireDraft.length - 1 ? 6 : 3}
                    fill={i === wireDraft.length - 1 ? "#fff" : "#3155a8"}
                    stroke="#3155a8"
                    strokeWidth={2}
                  />
                ))}
              </g>
            )}
            {visiblePlacements.map((pl) => {
              const part = partById.get(pl.partId);
              // A seeded-but-unassigned placement (#38) has no part; its
              // own system-function category still picks a sensible badge.
              const look = part ? lookOf(part) : symbolLook({ category: pl.category }, symbolCtx);
              // A curtain reads as the Curtains group's resolved colour
              // (final fix wave, so an admin's Grid Settings colour edit
              // reaches curtains too — not the old hard-coded hash swatch)
              // and a drape glyph, so a plan full of devices doesn't
              // swallow it (#48/#49).
              const c = pl.curtain ? symbolCtx.colors.Curtains : look.color;
              const x = pl.x * size.w;
              const y = pl.y * size.h;
              const on = selectedSet.has(pl.id);
              // The design's symbol Size (#300) scales the marker, its
              // children, the label offset and the selection ring.
              const s = symbolDisplay.scale;
              // A seeded-but-unassigned placement (#38 Task 2) has no
              // catalog part to name it, so its own category — the
              // human system-function label grid-seed.ts stamped it
              // with — reads far better on the plan than the raw
              // placeholder partId.
              const q = placementQty(pl);
              const name = part?.desc || part?.sku || (isSeedPlaceholder(pl.partId) ? pl.category : undefined) || pl.partId;
              // #320: a device reads by its designator — a lot by its range, so
              // no ×N; a device not yet numbered falls back to its description.
              // Curtains keep their name.
              const tag = pl.curtain ? "" : formatDesignator(pl.designator, q, designatorDigits);
              const label = pl.curtain ? pl.curtain.name + (q > 1 ? ` ×${q}` : "") : tag || name + (q > 1 ? ` ×${q}` : "");
              const ink = !pl.curtain && designatorDupes.has(pl.id) ? DESIGNATOR_DUPLICATE_COLOR : c;
              const model = part?.virtual ? "" : part?.modelNumber || part?.sku || "";
              const hover = pl.curtain ? pl.curtain.name : [tag, model !== name ? model : "", name].filter(Boolean).join(" · ");
              return (
                <g key={pl.id}>
                  <title>{hover}</title>
                  {pl.curtain ? (
                    <>
                      <rect x={x - 11 * s} y={y - 8 * s} width={22 * s} height={16 * s} rx={2 * s} fill={c} opacity={0.92} />
                      <rect x={x - 11 * s} y={y - 8 * s} width={22 * s} height={16 * s} rx={2 * s} fill="none" stroke="#fff" strokeWidth={1.5} />
                      <path
                        d={`M ${x - 7 * s} ${y - 6 * s} L ${x - 7 * s} ${y + 6 * s} M ${x} ${y - 6 * s} L ${x} ${y + 6 * s} M ${x + 7 * s} ${y - 6 * s} L ${x + 7 * s} ${y + 6 * s}`}
                        stroke="#fff"
                        strokeWidth={1}
                        opacity={0.75}
                      />
                    </>
                  ) : (
                    <>
                      {(() => {
                        const { w, h } = markerBox(part, s);
                        // #300 (D608/D609): in Object mode a part with a
                        // drawing (its own, else its device type's) draws it,
                        // fitted in the same marker box; everything else keeps
                        // the generic badge. An assembly never has a drawing
                        // (symbolUrlsFor never maps one): it always draws its
                        // badge and its generic member children.
                        // The generic badge — also what a drawing that fails to load falls back to.
                        const generic = (
                          <>
                            {/* Stock-symbol badge (spec 2026-09-25); ring + label below are unchanged. */}
                            <SymbolShape iconId={look.iconId} x={x} y={y} w={w} h={h} color={c} />
                            {part?.kind === "assembly" && (part.assemblyMembers || []).map((member) => {
                              const child = partById.get(member.symbolId);
                              const childLook = lookOf(child);
                              const cx = x + (member.x - 0.5) * w;
                              const cy = y + (member.y - 0.5) * h;
                              return (
                                <SymbolShape
                                  key={member.symbolId}
                                  iconId={childLook.iconId}
                                  x={cx}
                                  y={cy}
                                  w={10 * s}
                                  h={8 * s}
                                  color={childLook.color}
                                  opacity={1}
                                />
                              );
                            })}
                          </>
                        );
                        const drawing = symbolDisplay.mode === "object" ? symbolUrls[pl.partId]?.plan : undefined;
                        if (drawing) return <ObjectSymbol href={drawing} x={x} y={y} w={w} h={h} selected={on} fallback={generic} />;
                        return generic;
                      })()}
                    </>
                  )}
                  <rect x={x + 12 * s} y={y - 8} width={Math.max(22, label.length * 6.4) + 8} height={16} rx={4} fill="#fff" stroke={ink} strokeWidth={1} opacity={0.95} />
                  <text x={x + 12 * s + 4} y={y + 4} fill={ink} fontSize={10.5} fontWeight={700} style={{ fontFamily: "inherit" }}>
                    {label}
                  </text>
                  {on && (
                    <circle cx={x} cy={y} r={Math.max(6, 15 * s)} fill="none" stroke="#16181d" strokeDasharray="4 3" strokeWidth={1.5} />
                  )}
                </g>
              );
            })}
            {/* marquee select (#299) — dragged on empty plan */}
            {marquee && (
              <rect
                x={marquee.x0 * size.w}
                y={marquee.y0 * size.h}
                width={(marquee.x1 - marquee.x0) * size.w}
                height={(marquee.y1 - marquee.y0) * size.h}
                strokeDasharray="4 3"
                strokeWidth={1}
                style={{ fill: "color-mix(in srgb, var(--accent) 10%, transparent)", stroke: "var(--accent)" }}
              />
            )}
            {calDraft && (
              <line
                x1={calDraft[0].x * size.w}
                y1={calDraft[0].y * size.h}
                x2={calDraft[calDraft.length - 1].x * size.w}
                y2={calDraft[calDraft.length - 1].y * size.h}
                stroke="#d5342a"
                strokeWidth={2}
                strokeLinecap="round"
              />
            )}
          </svg>

          {/* plan legend (stock symbols) — every badge on this sheet */}
          <PlanLegend rows={planLegendRows} note={symbolDisplay.mode === "object" ? "Product drawings shown where available" : undefined} />

          {/* curtain drop-in (punch #49) - anchored where it was dropped,
              same on-canvas idiom as the calibration/space entry */}
          {curtainAt && armedCurtainType && (
            <div
              style={{
                position: "absolute",
                left: `${curtainAt.x * 100}%`,
                top: `${curtainAt.y * 100}%`,
                transform: "translate(6px, 6px)",
                zIndex: 6,
              }}
            >
              <CurtainDrop
                type={armedCurtainType}
                fabrics={fabrics}
                specKeys={specKeys}
                busy={busy}
                onConfirm={dropCurtain}
                onCancel={() => setCurtainAt(null)}
              />
            </div>
          )}

          {/* inline entry — window.prompt is unavailable here */}
          {pending && (() => {
            const anchor =
              pending.kind === "calibrate" ? pending.b : pending.points[pending.points.length - 1];
            const cancel = () => {
              setPending(null);
              setEntry("");
              setSpaceDraft([]);
            };
            return (
              <div
                data-plan-popover
                style={{
                  position: "absolute",
                  left: `${anchor.x * 100}%`,
                  top: `${anchor.y * 100}%`,
                  transform: "translate(6px, 6px)",
                  background: "#fff",
                  border: "1px solid #c4c9d2",
                  borderRadius: 9,
                  padding: 10,
                  boxShadow: "0 6px 20px rgba(0,0,0,.22)",
                  width: 232,
                  lineHeight: 1.4,
                  zIndex: 5,
                }}
                onPointerDown={(e) => e.stopPropagation()}
              >
                <div style={{ ...PANEL_LABEL, marginBottom: 6 }}>
                  {pending.kind === "calibrate" ? "Reference length" : "Name this space"}
                </div>
                <div style={{ display: "flex", gap: 5 }}>
                  <input
                    value={entry}
                    onChange={(e) => setEntry(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        if (pending.kind === "calibrate") confirmCalibration();
                        else confirmSpace();
                      }
                      if (e.key === "Escape") cancel();
                    }}
                    placeholder={pending.kind === "calibrate" ? "e.g. 40" : "Stage, House, Booth…"}
                    inputMode={pending.kind === "calibrate" ? "decimal" : "text"}
                    style={INPUT}
                    autoFocus
                  />
                  {pending.kind === "calibrate" && (
                    <select value={calUnit} onChange={(e) => setCalUnit(e.target.value as MeasureUnit)} style={{ ...INPUT, width: 66 }}>
                      {MEASURE_UNITS.map((u) => (
                        <option key={u} value={u}>{u}</option>
                      ))}
                    </select>
                  )}
                </div>
                <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
                  <button
                    style={{ ...BTN, flex: 1 }}
                    disabled={busy}
                    onClick={pending.kind === "calibrate" ? confirmCalibration : confirmSpace}
                  >
                    {pending.kind === "calibrate" ? "Set scale" : "Create space"}
                  </button>
                  <button style={BTN} onClick={cancel}>Cancel</button>
                </div>
              </div>
            );
          })()}
        </div>
      )}
    </div>
  );
}
