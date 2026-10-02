"use client";
/**
 * #296 — the interactive layer over one face of a RackElevation: a transparent
 * <svg> with the static drawing's viewBox, sized identically, holding the
 * placement ghost, selection outlines, issue markers and one focusable rect per
 * slot. Pointer coordinates map to drawing inches by the overlay's bounding box.
 * Pure rules (canPlace, ruFromPointer, laneFromPointer, ghostRect) do the work.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { ghostRect, laneFromPointer, RACK_GEOM, ruFromPointer, slotAriaLabel, type RackSlot } from "@/lib/rack/geometry";
import { canPlace, laneCountOf, occupiedSpan } from "@/lib/rack/layout";
import { RU_IN, type PlacementKind, type RackFace, type RackIssue, type RackLayout, type RackPartLookup, type RackPlacement, type RackWidthClass } from "@/lib/rack/types";

export type RackTarget = { ruStart: number; lane: 0 | 1 | 2 };
export type RackArmed = { sku: string; kind: PlacementKind; ruHeight: number; width: RackWidthClass; label?: string };

const GHOST_ID = "\u0000ghost";
const DRAG_PX = 4;
const LONG_PRESS_MS = 500;
const NSS = "non-scaling-stroke";

/** Client (px) → drawing inches for an element drawn at the viewBox's aspect. */
export function clientToDrawing(el: Element | null, clientX: number, clientY: number, viewBox: { w: number; h: number }): { x: number; y: number } | null {
  const r = el?.getBoundingClientRect();
  if (!r || !r.width || !r.height) return null;
  return { x: ((clientX - r.left) / r.width) * viewBox.w, y: ((clientY - r.top) / r.height) * viewBox.h };
}

/** Where a part `ruHeight` tall and `width` wide lands under a drawing point. */
export function targetAt(layout: RackLayout, pt: { x: number; y: number }, ruHeight: number, width: RackWidthClass | undefined): RackTarget {
  return { ruStart: ruFromPointer(pt.y, layout.config, ruHeight), lane: laneFromPointer(pt.x, laneCountOf(width)) };
}

/** The probe an armed part would be at `t` on `face`. */
export function armedProbe(armed: RackArmed, face: RackFace, t: RackTarget): RackPlacement {
  const n = laneCountOf(armed.width);
  return {
    id: GHOST_ID,
    kind: armed.kind,
    ...(armed.kind !== "reserved" ? { sku: armed.sku } : {}),
    ruStart: t.ruStart,
    ruHeight: Math.max(1, Math.ceil(armed.ruHeight)),
    face,
    ...(n > 1 ? { lane: t.lane, laneCount: n } : {}),
  };
}

type Drag = { id: string; pointerId: number; x0: number; y0: number; active: boolean };
type DragGhost = RackTarget & { id: string; copy: boolean };

export type ElevationOverlayProps = {
  layout: RackLayout;
  lookup: RackPartLookup;
  face: RackFace;
  mode: "edit" | "view";
  selection: string[];
  armed?: RackArmed | null;
  issues?: RackIssue[];
  slots: RackSlot[];
  viewBox: { w: number; h: number };
  scale: number;
  /** Armed-hover / drop ghost position, owned by the face panel (drag-and-drop sets it too). */
  hover: RackTarget | null;
  onHover: (t: RackTarget | null) => void;
  onPlace?: (p: { ruStart: number; face: RackFace; lane: 0 | 1 | 2 }) => void;
  onMove?: (id: string, to: { ruStart: number; face: RackFace; lane: 0 | 1 | 2 }, copy: boolean) => void;
  onSelect?: (ids: string[]) => void;
  onMenu?: (id: string, at: { x: number; y: number }) => void;
};

export function ElevationOverlay(props: ElevationOverlayProps) {
  const { layout, lookup, face, mode, selection, armed, issues, slots, viewBox, scale, hover, onHover, onPlace, onMove, onSelect, onMenu } = props;
  const edit = mode === "edit";
  const svgRef = useRef<SVGSVGElement>(null);
  const dragRef = useRef<Drag | null>(null);
  const pressTimer = useRef<number | null>(null);
  const pressMenu = useRef(false); // a long-press opened the menu, so the browser's own contextmenu must not open it again
  const suppressClick = useRef(false);
  const [dragGhost, setDragGhost] = useState<DragGhost | null>(null);

  useEffect(() => {
    const t = pressTimer;
    return () => {
      if (t.current !== null) window.clearTimeout(t.current);
    };
  }, []);

  const byId = useMemo(() => new Map(layout.placements.map((p) => [p.id, p])), [layout]);
  const selected = useMemo(() => new Set(selection), [selection]);
  const issueBy = useMemo(() => {
    const m = new Map<string, { level: RackIssue["level"]; messages: string[] }>();
    for (const i of issues ?? [])
      for (const id of i.placementIds) {
        const cur = m.get(id) ?? { level: "warning" as const, messages: [] };
        m.set(id, { level: cur.level === "error" || i.level === "error" ? "error" : "warning", messages: [...cur.messages, i.message] });
      }
    return m;
  }, [issues]);

  const { marginIn, railIn, panelIn } = RACK_GEOM;
  const panelX0 = marginIn + railIn;
  const top = marginIn;
  const bodyH = layout.config.ruCount * RU_IN;
  const toDrawing = (e: { clientX: number; clientY: number }) => clientToDrawing(svgRef.current, e.clientX, e.clientY, viewBox);

  const clearPress = () => {
    if (pressTimer.current !== null) window.clearTimeout(pressTimer.current);
    pressTimer.current = null;
  };
  const openMenu = (id: string, at: { x: number; y: number }) => {
    if (!onMenu) return;
    if (!selected.has(id)) onSelect?.([id]);
    onMenu(id, at);
  };
  const toggle = (id: string, additive: boolean) => {
    if (!onSelect) return;
    if (additive) onSelect(selected.has(id) ? selection.filter((s) => s !== id) : [...selection, id]);
    else onSelect([id]);
  };

  /** A dragged placement's target: a shelf's device keeps its shelf's RU unless it's being copied off. */
  const dragTarget = (p: RackPlacement, pt: { x: number; y: number }, copy: boolean): RackTarget => {
    const span = !copy && p.kind === "shelf" ? occupiedSpan(layout, p) : null;
    const h = span ? span.hi - span.lo + 1 : p.ruHeight;
    const t = { ruStart: ruFromPointer(pt.y, layout.config, h), lane: laneFromPointer(pt.x, p.laneCount ?? 1) };
    return p.shelfId && !copy ? { ...t, ruStart: p.ruStart } : t;
  };

  /* ---- the ghost being drawn (a drag wins over an armed hover) ---- */
  const ghost = (() => {
    if (dragGhost) {
      const p = byId.get(dragGhost.id);
      if (!p) return null;
      const probe: RackPlacement = { ...p, ruStart: dragGhost.ruStart, face, ...((p.laneCount ?? 1) > 1 ? { lane: dragGhost.lane } : {}) };
      if (dragGhost.copy) {
        probe.id = GHOST_ID;
        delete probe.shelfId;
      }
      const span = occupiedSpan(layout, probe);
      const lo = span?.lo ?? probe.ruStart;
      const h = span ? span.hi - span.lo + 1 : probe.ruHeight;
      return { rect: ghostRect(layout.config, lo, h, probe.lane ?? 0, probe.laneCount ?? 1), check: canPlace(layout, probe) };
    }
    if (hover && armed && edit) {
      const probe = armedProbe(armed, face, hover);
      return { rect: ghostRect(layout.config, probe.ruStart, probe.ruHeight, probe.lane ?? 0, probe.laneCount ?? 1), check: canPlace(layout, probe) };
    }
    return null;
  })();

  /* ---- pointer handlers ---- */
  const onPointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const d = dragRef.current;
    if (d && e.pointerId === d.pointerId) {
      if (!d.active && Math.hypot(e.clientX - d.x0, e.clientY - d.y0) > DRAG_PX) {
        d.active = true;
        clearPress();
      }
      const p = byId.get(d.id);
      const pt = toDrawing(e);
      if (d.active && p && pt) {
        const t = dragTarget(p, pt, e.altKey);
        setDragGhost((g) => (g && g.id === d.id && g.ruStart === t.ruStart && g.lane === t.lane && g.copy === e.altKey ? g : { ...t, id: d.id, copy: e.altKey }));
      }
      return;
    }
    if (!edit || !armed || e.pointerType === "touch") return;
    const pt = toDrawing(e);
    if (!pt) return;
    const t = targetAt(layout, pt, armed.ruHeight, armed.width);
    if (!hover || hover.ruStart !== t.ruStart || hover.lane !== t.lane) onHover(t);
  };

  const endDrag = () => {
    clearPress();
    dragRef.current = null;
    setDragGhost(null);
  };

  const onPointerUp = (e: React.PointerEvent<SVGSVGElement>) => {
    const d = dragRef.current;
    if (!d || e.pointerId !== d.pointerId) return;
    const p = byId.get(d.id);
    const pt = toDrawing(e);
    if (d.active) {
      suppressClick.current = true;
      if (p && pt && onMove) onMove(d.id, { ...dragTarget(p, pt, e.altKey), face }, e.altKey);
    } else if (!e.shiftKey && selection.length > 1) {
      onSelect?.([d.id]); // a plain click inside a multi-selection narrows it
    }
    endDrag();
  };

  const onSlotPointerDown = (e: React.PointerEvent<SVGRectElement>, id: string) => {
    pressMenu.current = false;
    if (e.button !== 0) return; // right-click opens the menu through contextmenu
    toggle(id, e.shiftKey);
    if (!edit) return;
    try {
      svgRef.current?.setPointerCapture(e.pointerId);
    } catch {
      /* capture is a nicety; dragging still works inside the panel */
    }
    dragRef.current = { id, pointerId: e.pointerId, x0: e.clientX, y0: e.clientY, active: false };
    clearPress();
    if (e.pointerType === "touch" && onMenu) {
      const at = { x: e.clientX, y: e.clientY };
      pressTimer.current = window.setTimeout(() => {
        pressTimer.current = null;
        if (dragRef.current?.active) return;
        dragRef.current = null;
        suppressClick.current = true;
        pressMenu.current = true;
        openMenu(id, at);
      }, LONG_PRESS_MS);
    }
  };

  const onSlotContextMenu = (e: React.MouseEvent<SVGRectElement>, id: string) => {
    e.preventDefault();
    if (pressMenu.current) {
      pressMenu.current = false; // the long-press already opened it
      return;
    }
    if (!edit) return;
    clearPress();
    dragRef.current = null;
    openMenu(id, { x: e.clientX, y: e.clientY });
  };

  const menuFromElement = (el: Element, id: string) => {
    const r = el.getBoundingClientRect();
    openMenu(id, { x: r.left, y: r.bottom });
  };

  const onSlotKeyDown = (e: React.KeyboardEvent<SVGRectElement>, id: string) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      e.stopPropagation();
      toggle(id, e.shiftKey);
    } else if (edit && (e.key === "ContextMenu" || (e.key === "F10" && e.shiftKey))) {
      e.preventDefault();
      e.stopPropagation();
      menuFromElement(e.currentTarget, id);
    }
  };

  const onBackgroundClick = (e: React.MouseEvent<SVGRectElement>) => {
    if (suppressClick.current) {
      suppressClick.current = false;
      return;
    }
    if (edit && armed && onPlace) {
      const pt = toDrawing(e);
      if (pt) onPlace({ ...targetAt(layout, pt, armed.ruHeight, armed.width), face });
      return;
    }
    if (selection.length) onSelect?.([]);
  };

  const single = edit && onMenu && selection.length === 1 ? slots.find((s) => s.placementId === selection[0]) : undefined;
  const singleP = single ? byId.get(single.placementId) : undefined;

  return (
    <>
    <svg
      ref={svgRef}
      viewBox={`0 0 ${viewBox.w} ${viewBox.h}`}
      width={viewBox.w * scale}
      height={viewBox.h * scale}
      style={{ position: "absolute", inset: 0, overflow: "visible", userSelect: "none", WebkitTouchCallout: "none" } as React.CSSProperties}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={endDrag}
      onPointerLeave={() => {
        if (!dragRef.current && hover) onHover(null);
      }}
    >
      <rect x={panelX0} y={top} width={panelIn} height={bodyH} fill="transparent" onClick={onBackgroundClick} style={{ cursor: edit && armed ? "copy" : "default" }} />

      {slots.map((s) => {
        const p = byId.get(s.placementId);
        if (!p) return null;
        const info = p.sku ? lookup(p.sku) : undefined;
        const iss = issueBy.get(p.id);
        const base = slotAriaLabel(p, info, layout.config, layout);
        const label = iss ? `${base}. ${iss.level === "error" ? "Error" : "Warning"}: ${iss.messages.join(" ")}` : base;
        const tip = [[info?.mfr, p.sku].filter(Boolean).join(" "), ...(iss?.messages ?? [])].filter(Boolean).join("\n");
        return (
          <rect
            key={s.placementId}
            x={s.x}
            y={s.y}
            width={s.w}
            height={s.h}
            fill="transparent"
            tabIndex={0}
            role="button"
            aria-label={label}
            aria-pressed={selected.has(p.id)}
            vectorEffect={NSS}
            className="outline-none focus-visible:[stroke:var(--accent)] focus-visible:[stroke-width:2px] focus-visible:[stroke-dasharray:4_2]"
            style={{ pointerEvents: edit && armed ? "none" : "auto", touchAction: edit ? "none" : "auto", cursor: edit ? "grab" : onSelect ? "pointer" : "default" }}
            onPointerDown={(e) => onSlotPointerDown(e, p.id)}
            onContextMenu={(e) => onSlotContextMenu(e, p.id)}
            onKeyDown={(e) => onSlotKeyDown(e, p.id)}
          >
            {tip ? <title>{tip}</title> : null}
          </rect>
        );
      })}

      {slots
        .filter((s) => selected.has(s.placementId))
        .map((s) => (
          <rect key={`sel-${s.placementId}`} x={s.x} y={s.y} width={s.w} height={s.h} fill="none" vectorEffect={NSS} pointerEvents="none" style={{ stroke: "var(--accent)", strokeWidth: 2 }} />
        ))}

      {slots
        .filter((s) => issueBy.has(s.placementId))
        .map((s) => {
          const err = issueBy.get(s.placementId)!.level === "error";
          const r = Math.min(0.32, s.h / 2 - 0.05);
          return (
            <g key={`iss-${s.placementId}`} pointerEvents="none" aria-hidden="true">
              <circle cx={s.x + r + 0.08} cy={s.y + r + 0.08} r={r} style={{ fill: err ? "var(--red)" : "var(--amber)" }} />
              <text x={s.x + r + 0.08} y={s.y + r * 1.45 + 0.08} fontSize={r * 1.4} textAnchor="middle" fontWeight="bold" fill="#fff">
                !
              </text>
            </g>
          );
        })}

      {single && singleP ? (
        <g
          role="button"
          tabIndex={0}
          aria-label={`Options for ${slotAriaLabel(singleP, singleP.sku ? lookup(singleP.sku) : undefined, layout.config, layout)}`}
          className="outline-none"
          style={{ cursor: "pointer" }}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => menuFromElement(e.currentTarget, single.placementId)}
          onKeyDown={(e) => {
            if (e.key !== "Enter" && e.key !== " ") return;
            e.preventDefault();
            e.stopPropagation();
            menuFromElement(e.currentTarget, single.placementId);
          }}
        >
          <rect x={single.x + single.w - 1.05} y={single.y + 0.08} width={0.95} height={Math.min(1.5, single.h - 0.16)} rx={0.15} vectorEffect={NSS} style={{ fill: "#fff", stroke: "var(--accent)", strokeWidth: 1 }} />
          {[0, 1, 2].map((i) => (
            <circle key={i} cx={single.x + single.w - 0.575} cy={single.y + 0.08 + Math.min(1.5, single.h - 0.16) / 2 + (i - 1) * 0.28} r={0.08} style={{ fill: "var(--ink)" }} />
          ))}
        </g>
      ) : null}

      {ghost ? (
        <rect
          x={ghost.rect.x}
          y={ghost.rect.y}
          width={ghost.rect.w}
          height={ghost.rect.h}
          vectorEffect={NSS}
          pointerEvents="none"
          style={
            ghost.check.ok
              ? { fill: "color-mix(in srgb, var(--green) 22%, transparent)", stroke: "var(--accent)", strokeWidth: 2 }
              : { fill: "color-mix(in srgb, var(--red) 12%, transparent)", stroke: "var(--red)", strokeWidth: 2, strokeDasharray: "5 3" }
          }
        >
          <title>{ghost.check.ok ? "Fits here" : ghost.check.reason}</title>
        </rect>
      ) : null}
    </svg>
    {ghost && !ghost.check.ok ? (
      <div
        role="status"
        style={{
          position: "absolute",
          left: panelX0 * scale,
          top: Math.min((ghost.rect.y + ghost.rect.h) * scale + 4, viewBox.h * scale - 24),
          maxWidth: panelIn * scale,
          pointerEvents: "none",
          fontSize: 11,
          lineHeight: 1.25,
          color: "var(--red)",
          background: "#fff",
          border: "1px solid var(--red)",
          borderRadius: 4,
          padding: "2px 6px",
        }}
      >
        {ghost.check.reason}
      </div>
    ) : null}
    </>
  );
}
