"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type * as React from "react";
import { ROOM_TYPES, ROOM_TYPE_KEYS, type RoomShape, type RoomTypeKey, type ShapePt, type ShapeRoom } from "@/lib/design/room-shape/types";
import { arcInfo, bounds, bulgeThrough, dist, edgeMid, outlinePoints, sampleEdge, signedArea, sub, wallBands } from "@/lib/design/room-shape/geometry";
import { applyEdit, type EditOp } from "@/lib/design/room-shape/edit";
import { snapCorner } from "@/lib/design/room-shape/snap";
import { labelPoint, pathD } from "@/lib/design/room-shape/svg";
import { SHAPE_HINT } from "@/lib/design/room-shape/copy";
import LengthInput from "./length-input";

type View = { x: number; y: number; w: number; h: number };
type Sel = null | { room: string; edge?: number; corner?: number };
type Drag =
  | { kind: "corner"; room: string; i: number; base: RoomShape }
  | { kind: "bulge"; room: string; edge: number; base: RoomShape }
  | { kind: "handle"; room: string; edge: number; which: "c1" | "c2"; base: RoomShape }
  | { kind: "pan"; from: { x: number; y: number }; view: View; moved: boolean };

const HEIGHT = 520;
const HANDLE_PX = 11;
const ACCENT = "var(--accent)";
const btn: React.CSSProperties = { border: "1px solid #e4e7ec", background: "#fff", borderRadius: 7, padding: "5px 10px", fontSize: 12, fontWeight: 600, cursor: "pointer" };

function fitView(shape: RoomShape, aspect: number): View {
  const b = bounds(shape.rooms.flatMap((r) => outlinePoints(r, 1, 16)));
  let w = b.maxX - b.minX + 12, h = b.maxY - b.minY + 12;
  if (w / h < aspect) w = h * aspect;
  else h = w / aspect;
  return { x: (b.minX + b.maxX) / 2 - w / 2, y: (b.minY + b.maxY) / 2 - h / 2, w, h };
}

/**
 * #370: the room shape editor — click a room for its corners (squares) and wall midpoints (dots); drag corners
 * (snapped), drag a curved wall's midpoint to bow it, drag a free-form wall's handles; the toolbar does the rest.
 * Every change goes through applyEdit; the parent owns the shape, this keeps undo / redo.
 */
export default function RoomShapeEditor({ shape, onChange }: { shape: RoomShape; onChange: (next: RoomShape) => void }) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [boxW, setBoxW] = useState(900);
  const [view, setView] = useState<View>(() => fitView(shape, 900 / HEIGHT));
  const [sel, setSel] = useState<Sel>(null);
  const [live, setLive] = useState<RoomShape | null>(null);
  const liveRef = useRef<RoomShape | null>(null);
  const [guide, setGuide] = useState<[ShapePt, ShapePt] | null>(null);
  const [note, setNote] = useState("");
  const [undo, setUndo] = useState<RoomShape[]>([]);
  const [redo, setRedo] = useState<RoomShape[]>([]);
  const drag = useRef<Drag | null>(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef<{ d0: number; view: View; mid: ShapePt } | null>(null);
  const shown = live ?? shape;
  const pxPerFt = Math.min(boxW / view.w, HEIGHT / view.h);
  const hFt = HANDLE_PX / pxPerFt;

  useEffect(() => {
    const el = svgRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => {
      const w = el.clientWidth;
      if (w > 0) {
        setBoxW(w);
        setView((v) => ({ ...v, h: v.w * (HEIGHT / w) }));
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const onWheel = (ev: WheelEvent) => {
      ev.preventDefault();
      const m = el.getScreenCTM();
      if (!m) return;
      const p = new DOMPoint(ev.clientX, ev.clientY).matrixTransform(m.inverse());
      const k = Math.exp(ev.deltaY * 0.0015);
      setView((v) => {
        const w = Math.min(4000, Math.max(5, v.w * k)), s = w / v.w;
        return { x: p.x - (p.x - v.x) * s, y: p.y - (p.y - v.y) * s, w, h: v.h * s };
      });
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  const flash = (m: string) => {
    setNote(m);
    window.setTimeout(() => setNote((cur) => (cur === m ? "" : cur)), 4000);
  };
  const commit = (next: RoomShape) => {
    setUndo((u) => [...u.slice(-99), shape]);
    setRedo([]);
    onChange(next);
  };
  const run = (op: EditOp) => {
    const r = applyEdit(shape, op);
    if (!r.ok) return flash(r.reason);
    commit(r.shape);
  };
  const doUndo = () => {
    const prev = undo[undo.length - 1];
    if (!prev) return;
    setUndo(undo.slice(0, -1));
    setRedo([...redo, shape]);
    onChange(prev);
  };
  const doRedo = () => {
    const nx = redo[redo.length - 1];
    if (!nx) return;
    setRedo(redo.slice(0, -1));
    setUndo([...undo, shape]);
    onChange(nx);
  };

  const toFt = (e: { clientX: number; clientY: number }): ShapePt => {
    const m = svgRef.current?.getScreenCTM();
    if (!m) return { x: 0, y: 0 };
    const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(m.inverse());
    return { x: p.x, y: p.y };
  };
  const begin = (e: React.PointerEvent, d: Drag) => {
    e.stopPropagation();
    svgRef.current?.setPointerCapture?.(e.pointerId);
    drag.current = d;
  };

  const onBgDown = (e: React.PointerEvent) => {
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    svgRef.current?.setPointerCapture?.(e.pointerId);
    if (pointers.current.size === 2) {
      const [p, q] = [...pointers.current.values()];
      drag.current = null;
      pinch.current = { d0: Math.hypot(p.x - q.x, p.y - q.y) || 1, view, mid: toFt({ clientX: (p.x + q.x) / 2, clientY: (p.y + q.y) / 2 }) };
      return;
    }
    drag.current = { kind: "pan", from: { x: e.clientX, y: e.clientY }, view, moved: false };
  };

  const onMove = (e: React.PointerEvent) => {
    if (pointers.current.has(e.pointerId)) pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pinch.current && pointers.current.size === 2) {
      const [p, q] = [...pointers.current.values()];
      const s = pinch.current.d0 / (Math.hypot(p.x - q.x, p.y - q.y) || 1);
      const v0 = pinch.current.view, m = pinch.current.mid;
      const w = Math.min(4000, Math.max(5, v0.w * s)), k = w / v0.w;
      setView({ x: m.x - (m.x - v0.x) * k, y: m.y - (m.y - v0.y) * k, w, h: v0.h * k });
      return;
    }
    const d = drag.current;
    if (!d) return;
    if (d.kind === "pan") {
      const k = d.view.w / boxW;
      const dx = e.clientX - d.from.x, dy = e.clientY - d.from.y;
      if (Math.abs(dx) + Math.abs(dy) > 3) d.moved = true;
      setView({ ...d.view, x: d.view.x - dx * k, y: d.view.y - dy * k });
      return;
    }
    const p = toFt(e);
    const room = d.base.rooms.find((r) => r.id === d.room);
    if (!room) return;
    const n = room.pts.length, at = (k: number) => room.pts[((k % n) + n) % n];
    let op: EditOp;
    if (d.kind === "corner") {
      const s = snapCorner(p, [{ at: at(d.i - 1), wallDir: sub(at(d.i - 1), at(d.i - 2)) }, { at: at(d.i + 1), wallDir: sub(at(d.i + 1), at(d.i + 2)) }], { gridFt: e.shiftKey ? 1 : 0.5, angles: true });
      setGuide(s.guide);
      op = { op: "move", room: d.room, i: d.i, to: s.pt, glue: !e.altKey };
    } else if (d.kind === "bulge") {
      op = { op: "setBulge", room: d.room, edge: d.edge, bulge: bulgeThrough(at(d.edge), at(d.edge + 1), p) };
    } else {
      const e0 = room.edges[d.edge];
      if (e0.kind !== "curve") return;
      op = { op: "setHandles", room: d.room, edge: d.edge, c1: d.which === "c1" ? p : e0.c1, c2: d.which === "c2" ? p : e0.c2 };
    }
    const r = applyEdit(d.base, op);
    if (r.ok) {
      liveRef.current = r.shape;
      setLive(r.shape);
      setNote("");
    } else setNote(r.reason);
  };

  const onUp = (e: React.PointerEvent) => {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2) pinch.current = null;
    const d = drag.current;
    drag.current = null;
    setGuide(null);
    if (d?.kind === "pan" && !d.moved) setSel(null);
    if (d && d.kind !== "pan" && liveRef.current) commit(liveRef.current);
    liveRef.current = null;
    setLive(null);
  };

  const onKey = (e: React.KeyboardEvent) => {
    const meta = e.metaKey || e.ctrlKey;
    if (meta && e.key.toLowerCase() === "z") {
      e.preventDefault();
      return e.shiftKey ? doRedo() : doUndo();
    }
    if (e.key === "Escape") return setSel(null);
    if ((e.key === "Delete" || e.key === "Backspace") && sel?.corner !== undefined && !(e.target instanceof HTMLInputElement)) {
      e.preventDefault();
      run({ op: "deletePoint", room: sel.room, i: sel.corner });
      setSel({ room: sel.room });
    }
  };

  const ordered = useMemo(
    () => [...shown.rooms].sort((a, b) => Math.abs(signedArea(outlinePoints(b, 2, 8))) - Math.abs(signedArea(outlinePoints(a, 2, 8)))),
    [shown]
  );
  const selRoom: ShapeRoom | null = sel ? shown.rooms.find((r) => r.id === sel.room) ?? null : null;
  const nSel = selRoom?.pts.length ?? 0;
  const selEdge = selRoom && sel?.edge !== undefined && sel.edge < nSel ? sel.edge : undefined;
  const selCorner = selRoom && sel?.corner !== undefined && sel.corner < nSel ? sel.corner : undefined;

  return (
    <div data-testid="room-shape-editor" tabIndex={0} onKeyDown={onKey} style={{ outline: "none" }}>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center", marginBottom: 8, minHeight: 32 }}>
        <button type="button" style={btn} onClick={doUndo} disabled={!undo.length}>Undo</button>
        <button type="button" style={btn} onClick={doRedo} disabled={!redo.length}>Redo</button>
        <button type="button" style={btn} onClick={() => setView(fitView(shape, boxW / HEIGHT))}>Fit</button>
        <span style={{ width: 1, height: 22, background: "#e4e7ec" }} />
        {selRoom && selEdge !== undefined && (() => {
          const i = selEdge, a = selRoom.pts[i], b = selRoom.pts[(i + 1) % nSel], e = selRoom.edges[i];
          const A = e.kind === "arc" ? arcInfo(a, b, e.bulge) : null;
          return (
            <>
              <button type="button" style={btn} onClick={() => run({ op: "addPoint", room: selRoom.id, edge: i })}>Add point</button>
              {e.kind !== "arc" && <button type="button" style={btn} onClick={() => run({ op: "setBulge", room: selRoom.id, edge: i, bulge: 0.25 })}>Curve</button>}
              {e.kind !== "curve" && <button type="button" style={btn} onClick={() => run({ op: "toFreeform", room: selRoom.id, edge: i })}>Free-form</button>}
              {e.kind !== "line" && <button type="button" style={btn} onClick={() => run({ op: "straighten", room: selRoom.id, edge: i })}>Straighten</button>}
              {selRoom.kind === "room" && (
                <button type="button" style={btn} onClick={() => run({ op: "setOpen", room: selRoom.id, edge: i, open: !e.open })}>{e.open ? "Opening → Wall" : "Wall → Opening"}</button>
              )}
              {e.kind === "line" && <LengthInput label="Length" value={dist(a, b)} onCommit={(ft, alt) => run({ op: "setLength", room: selRoom.id, edge: i, ft, from: alt ? "near" : "far" })} />}
              {A && <LengthInput label="Radius" value={A.r} onCommit={(ft) => run({ op: "setRadius", room: selRoom.id, edge: i, ft })} />}
              {A && <LengthInput label="Arc length" value={A.length} onCommit={(ft) => run({ op: "setArcLength", room: selRoom.id, edge: i, ft })} />}
            </>
          );
        })()}
        {selRoom && selCorner !== undefined && (
          <button type="button" style={btn} onClick={() => { run({ op: "deletePoint", room: selRoom.id, i: selCorner }); setSel({ room: selRoom.id }); }}>Delete point</button>
        )}
        {selRoom && selEdge === undefined && selCorner === undefined && (
          <>
            <input
              key={selRoom.id}
              aria-label="Room name"
              defaultValue={selRoom.name}
              onBlur={(e) => e.target.value !== selRoom.name && run({ op: "rename", room: selRoom.id, name: e.target.value })}
              onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
              style={{ fontSize: 12, padding: "5px 8px", border: "1px solid #e4e7ec", borderRadius: 6, width: 170 }}
            />
            <select aria-label="Room type" value={selRoom.type} onChange={(e) => run({ op: "retype", room: selRoom.id, type: e.target.value as RoomTypeKey })} style={{ fontSize: 12, padding: "5px 6px", border: "1px solid #e4e7ec", borderRadius: 6 }}>
              {ROOM_TYPE_KEYS.map((k) => <option key={k} value={k}>{ROOM_TYPES[k].label}</option>)}
            </select>
            <span style={{ fontSize: 12, color: "#737985" }}>{Math.round(Math.abs(signedArea(outlinePoints(selRoom))))} sq ft · {selRoom.kind === "zone" ? "zone" : "room"}</span>
            <button type="button" style={btn} onClick={() => { run({ op: "deleteRoom", room: selRoom.id }); setSel(null); }}>Delete room</button>
          </>
        )}
      </div>
      <svg
        ref={svgRef}
        width="100%"
        height={HEIGHT}
        viewBox={`${view.x} ${view.y} ${view.w} ${view.h}`}
        preserveAspectRatio="xMidYMid meet"
        onPointerDown={onBgDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
        style={{ display: "block", background: "#fafbfc", border: "1px solid #ececf0", borderRadius: 10, touchAction: "none", userSelect: "none" }}
      >
        {ordered.map((r) => (
          <path
            key={`f-${r.id}`}
            data-k={r.kind === "zone" ? "zone" : "room"}
            d={pathD(outlinePoints(r))}
            fill={r.kind === "zone" ? "rgba(107,114,128,0.06)" : "#f1f2f5"}
            stroke={r.kind === "zone" ? "#6b7280" : sel?.room === r.id ? ACCENT : "none"}
            strokeWidth={r.kind === "zone" ? 0.15 : 0.12}
            strokeDasharray={r.kind === "zone" ? "1 0.6" : undefined}
            onPointerDown={(e) => { e.stopPropagation(); setSel({ room: r.id }); }}
            style={{ cursor: "pointer" }}
          />
        ))}
        {ordered.flatMap((r) => wallBands(r).map((band, k) => <path key={`w-${r.id}-${k}`} data-k="wall" d={pathD(band)} fill="#3a3f4a" pointerEvents="none" />))}
        {ordered.map((r) => {
          const p = labelPoint(r);
          return <text key={`t-${r.id}`} x={p.x} y={p.y} textAnchor="middle" dominantBaseline="middle" fontSize={1.1} fontWeight={600} fill="#3a3f4a" fontFamily="IBM Plex Mono, monospace" pointerEvents="none">{r.name}</text>;
        })}
        {selRoom && selEdge !== undefined && (() => {
          const a = selRoom.pts[selEdge], b = selRoom.pts[(selEdge + 1) % nSel], e = selRoom.edges[selEdge];
          const pts = [...sampleEdge(a, b, e, 0.25, 64), b];
          return <path d={`M${pts.map((q) => `${q.x} ${q.y}`).join("L")}`} fill="none" stroke={ACCENT} strokeWidth={hFt * 0.35} pointerEvents="none" />;
        })()}
        {selRoom && selEdge !== undefined && selRoom.edges[selEdge].kind === "curve" && (() => {
          const e = selRoom.edges[selEdge] as { c1: ShapePt; c2: ShapePt };
          const a = selRoom.pts[selEdge], b = selRoom.pts[(selEdge + 1) % nSel];
          return (
            <>
              <line x1={a.x} y1={a.y} x2={e.c1.x} y2={e.c1.y} stroke={ACCENT} strokeWidth={hFt * 0.12} />
              <line x1={b.x} y1={b.y} x2={e.c2.x} y2={e.c2.y} stroke={ACCENT} strokeWidth={hFt * 0.12} />
              <circle cx={e.c1.x} cy={e.c1.y} r={hFt * 0.45} fill={ACCENT} onPointerDown={(ev) => begin(ev, { kind: "handle", room: selRoom.id, edge: selEdge, which: "c1", base: shape })} style={{ cursor: "grab" }} />
              <circle cx={e.c2.x} cy={e.c2.y} r={hFt * 0.45} fill={ACCENT} onPointerDown={(ev) => begin(ev, { kind: "handle", room: selRoom.id, edge: selEdge, which: "c2", base: shape })} style={{ cursor: "grab" }} />
            </>
          );
        })()}
        {selRoom && selRoom.pts.map((p, i) => {
          const m = edgeMid(p, selRoom.pts[(i + 1) % nSel], selRoom.edges[i]);
          return (
            <circle
              key={`m-${i}`}
              data-k="mid"
              cx={m.x}
              cy={m.y}
              r={hFt * 0.42}
              fill={selEdge === i ? ACCENT : "#fff"}
              stroke={ACCENT}
              strokeWidth={hFt * 0.14}
              onPointerDown={(ev) => {
                setSel({ room: selRoom.id, edge: i });
                if (selRoom.edges[i].kind === "arc") begin(ev, { kind: "bulge", room: selRoom.id, edge: i, base: shape });
                else ev.stopPropagation();
              }}
              style={{ cursor: "pointer" }}
            />
          );
        })}
        {selRoom && selRoom.pts.map((p, i) => (
          <rect
            key={`c-${i}`}
            data-k="corner"
            x={p.x - hFt / 2}
            y={p.y - hFt / 2}
            width={hFt}
            height={hFt}
            fill={selCorner === i ? ACCENT : "#fff"}
            stroke={ACCENT}
            strokeWidth={hFt * 0.14}
            onPointerDown={(ev) => { setSel({ room: selRoom.id, corner: i }); begin(ev, { kind: "corner", room: selRoom.id, i, base: shape }); }}
            style={{ cursor: "move" }}
          />
        ))}
        {guide && <line x1={guide[0].x} y1={guide[0].y} x2={guide[1].x} y2={guide[1].y} stroke={ACCENT} strokeWidth={hFt * 0.1} strokeDasharray={`${hFt * 0.5} ${hFt * 0.4}`} pointerEvents="none" />}
      </svg>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, marginTop: 6, fontSize: 11.5, color: "#9aa0ab" }}>
        <span>{SHAPE_HINT}</span>
        {note && <span role="status" style={{ color: "#b4543a" }}>{note}</span>}
      </div>
    </div>
  );
}
