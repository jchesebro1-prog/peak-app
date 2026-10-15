"use client";

/* InkPad (#344 C3) — full-screen, Apple-Pencil-first drawing dialog for sketch pads (over an SVG
   background) and photo markup (over a photo). Once a Pencil touches any pad this session, the pen
   draws and fingers only pan / pinch-zoom (palm never draws); without a pen, mouse and finger draw.
   Doc coordinates are background units; view math lives in src/lib/ink/view.ts. */

import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type PointerEvent as RPointerEvent, type Ref } from "react";
import { createPortal, flushSync } from "react-dom";
import { INK_CAPS, INK_COLORS, createHistory, emptyInk, eraseAt, fitInkTo, inkCapHit, inkId, moveLabel, renderInk, serializeInk, simplify, type InkDoc, type InkLabel } from "@/lib/ink/model";
import { strokesFitUploadCap } from "@/lib/field-files/files";
import { flattenInk, type InkBackground } from "./flatten";
import {
  approxLabelWidth, clampView, docToScreen, eraserRadius, fitScale, fitView, hitLabel, isDoubleTap, isTap,
  labelSizeFor, panStarted, penWidthFor, pinchView, pointPressure, pointerRole, refitView, screenToDoc, svgDataUrl, zoomAt, type Pt, type Tap, type View,
} from "@/lib/ink/view";

export type { InkBackground };
export type InkPadProps = {
  open: boolean;
  title: string;
  background: InkBackground;
  initial?: InkDoc;
  onCancel: () => void;
  /** May return a Promise; the pad stays "Saving…" until it settles (if the parent keeps it open). */
  onDone: (result: { doc: InkDoc; jpeg: Blob }) => void | Promise<unknown>;
};

type Tool = "pen" | "eraser" | "text";
type Gesture =
  | { kind: "draw"; id: number; ptype: string; pts: number[]; color: string; width: number }
  | { kind: "erase"; id: number; ptype: string; doc: InkDoc; r: number }
  | { kind: "label"; id: number; ptype: string; labelId: string; dx: number; dy: number; doc: InkDoc; down: Pt; moved: boolean }
  | { kind: "place"; id: number; ptype: string; at: Pt; down: Pt }
  /* `origin`: the view before this run of touches began — restored when the Pencil takes over from a palm. */
  | { kind: "pan"; id: number; view: View; origin: View; sx: number; sy: number; down: Tap; started: boolean }
  | { kind: "pinch"; a: number; b: number; view: View; origin: View; a0: Pt; b0: Pt };
type CapAdd = { pts?: number; label?: boolean };
type Editing = { x: number; y: number; value: string };

const COLOR_NAMES = ["Black", "Red", "Blue"];

/* The first `pointerType === "pen"` flips every pad into Pencil mode — remembered on the device (#344 C-final B), so a
   palm before the first Pencil stroke of a visit never draws. Storage that throws (private mode) = session-only. */
const PEN_SEEN_KEY = "ink:penSeen";
let penSeen: boolean | null = null;
const hasPen = (): boolean => {
  if (penSeen === null) {
    try { penSeen = typeof localStorage !== "undefined" && localStorage.getItem(PEN_SEEN_KEY) === "1"; } catch { penSeen = false; }
  }
  return penSeen;
};
const notePen = () => {
  penSeen = true;
  try { localStorage.setItem(PEN_SEEN_KEY, "1"); } catch { /* remembered for this session only */ }
};

export function InkPad(props: InkPadProps) {
  if (!props.open || typeof document === "undefined") return null;
  // Portalled so no transformed ancestor can break `position: fixed`.
  return createPortal(<InkPadDialog {...props} />, document.body);
}
export default InkPad;

function InkPadDialog({ title, background, initial, onCancel, onDone }: InkPadProps) {
  const titleId = useId();
  const dw = background.w, dh = background.h;
  const [startDoc] = useState<InkDoc>(() => (initial ? fitInkTo(initial, dw, dh) : emptyInk(dw, dh)));
  const [hist] = useState(() => createHistory(startDoc));
  const histRef = useRef(hist); // read inside memoised painters (the compiler can't track hist.current)
  const [doc, setDoc] = useState<InkDoc>(startDoc);
  const [tool, setTool] = useState<Tool>("pen");
  const [color, setColor] = useState<string>(INK_COLORS[0]);
  const [pen, setPen] = useState<boolean>(hasPen);
  const [view, setViewState] = useState<View | null>(null);
  const [stage, setStage] = useState<{ w: number; h: number } | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [editing, setEditing] = useState<Editing | null>(null);
  const [confirm, setConfirm] = useState<null | "discard" | "clear">(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const rootRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const firstBtnRef = useRef<HTMLButtonElement>(null);
  const keepBtnRef = useRef<HTMLButtonElement>(null);
  const viewRef = useRef<View | null>(null);
  const sizeRef = useRef<{ w: number; h: number } | null>(null);
  const dprRef = useRef(1);
  const rectRef = useRef<DOMRect | null>(null);
  const gestureRef = useRef<Gesture | null>(null);
  const touchesRef = useRef(new Map<number, Pt>());
  /** Pointers consumed until they lift: palms the Pencil took over from, a press that committed a label. */
  const ignoredRef = useRef(new Set<number>());
  const capRef = useRef<CapAdd | null>(null);
  const lastTapRef = useRef<Tap | null>(null);
  const selRef = useRef<string | null>(null);
  const editingRef = useRef<Editing | null>(null);
  const keyRef = useRef<(e: KeyboardEvent) => void>(() => {});

  const penW = penWidthFor(dw, dh);
  const labelSize = labelSizeFor(dw, dh);
  const fit = stage ? fitScale(stage.w, stage.h, dw, dh) : 1;
  const dirty = doc !== startDoc || !!editing?.value.trim();
  const bgSrc = background.kind === "svg" ? svgDataUrl(background.svg) : background.url;

  /* ── view + painting ── */
  const scaleNow = useCallback(() => {
    const sz = sizeRef.current, v = viewRef.current;
    return sz && v ? fitScale(sz.w, sz.h, dw, dh) * v.z : 1;
  }, [dw, dh]);

  const setView = useCallback((v: View) => {
    const sz = sizeRef.current;
    if (!sz) return;
    const c = clampView(v, fitScale(sz.w, sz.h, dw, dh), sz.w, sz.h, dw, dh);
    viewRef.current = c;
    setViewState(c);
  }, [dw, dh]);

  const measure = useCallback((l: InkLabel) => {
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx) return approxLabelWidth(l);
    ctx.save();
    ctx.font = `${l.size}px sans-serif`;
    const w = ctx.measureText(l.text).width;
    ctx.restore();
    return w;
  }, []);

  /** Stroke a run of the in-progress stroke (segments from index `from`) — no full re-render. */
  const drawLive = useCallback((g: Extract<Gesture, { kind: "draw" }>, from: number) => {
    const ctx = canvasRef.current?.getContext("2d"), v = viewRef.current;
    if (!ctx || !v) return;
    const s = scaleNow(), dpr = dprRef.current, p = g.pts, n = p.length / 3;
    ctx.save();
    ctx.setTransform(dpr * s, 0, 0, dpr * s, dpr * v.x, dpr * v.y);
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = g.color;
    for (let i = Math.max(0, from); i < n; i++) {
      const a = i === 0 ? 0 : i - 1;
      ctx.lineWidth = g.width * (0.5 + (p[a * 3 + 2] + p[i * 3 + 2]) / 2);
      ctx.beginPath();
      ctx.moveTo(p[a * 3], p[a * 3 + 1]);
      ctx.lineTo(p[i * 3], p[i * 3 + 1]);
      ctx.stroke();
    }
    ctx.restore();
  }, [scaleNow]);

  /** Full re-render: the committed doc (or a gesture's working doc), the selection box, any live stroke. */
  const paint = useCallback(() => {
    const c = canvasRef.current, v = viewRef.current;
    const ctx = c?.getContext("2d");
    if (!c || !ctx || !v) return;
    const g = gestureRef.current;
    const d = g && (g.kind === "erase" || g.kind === "label") ? g.doc : histRef.current.current;
    const s = scaleNow(), dpr = dprRef.current;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, c.width, c.height);
    ctx.save();
    ctx.setTransform(dpr * s, 0, 0, dpr * s, dpr * v.x, dpr * v.y);
    renderInk(ctx, d, 1);
    const sel = selRef.current && d.labels.find((l) => l.id === selRef.current);
    if (sel) {
      ctx.strokeStyle = "#5b6170";
      ctx.lineWidth = 1.5 / s;
      ctx.setLineDash([5 / s, 4 / s]);
      ctx.strokeRect(sel.x - 4 / s, sel.y - 4 / s, measure(sel) + 8 / s, sel.size * 1.2 + 8 / s);
    }
    ctx.restore();
    if (g?.kind === "draw") drawLive(g, 0);
  }, [scaleNow, measure, drawLive]);

  useLayoutEffect(() => { paint(); }, [doc, view, stage, selected, paint]);

  /* Stage size → canvas backing store (DPR ≤ 2) and the view. */
  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      const r = el.getBoundingClientRect();
      rectRef.current = r;
      if (r.width < 1 || r.height < 1) return;
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const was = sizeRef.current, pv = viewRef.current;
      sizeRef.current = { w: r.width, h: r.height };
      dprRef.current = dpr;
      const c = canvasRef.current;
      if (c) { c.width = Math.round(r.width * dpr); c.height = Math.round(r.height * dpr); }
      // First size fits; later ones (rotation, toolbar re-wrap) keep the zoom and the centred doc point.
      const v = was && pv ? refitView(pv, was.w, was.h, r.width, r.height, dw, dh) : fitView(r.width, r.height, dw, dh);
      viewRef.current = v;
      setStage({ w: r.width, h: r.height });
      setViewState(v);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [dw, dh]);

  /* Wheel: ctrl/⌘ (trackpad pinch) zooms about the cursor, plain wheel pans. Non-passive to keep the page still. */
  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const v = viewRef.current;
      if (!v || gestureRef.current) return;
      const r = el.getBoundingClientRect();
      if (e.ctrlKey || e.metaKey) setView(zoomAt(v, v.z * Math.exp(-e.deltaY * 0.01), e.clientX - r.left, e.clientY - r.top));
      else setView({ z: v.z, x: v.x - e.deltaX, y: v.y - e.deltaY });
    };
    const stopGesture = (e: Event) => e.preventDefault();
    el.addEventListener("wheel", onWheel, { passive: false });
    el.addEventListener("gesturestart", stopGesture);
    return () => { el.removeEventListener("wheel", onWheel); el.removeEventListener("gesturestart", stopGesture); };
  }, [setView]);

  /* Focus into the dialog, lock page scroll, restore both on close. */
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    firstBtnRef.current?.focus();
    return () => {
      document.body.style.overflow = overflow;
      if (prev && typeof prev.focus === "function" && document.contains(prev)) prev.focus();
    };
  }, []);

  useEffect(() => { if (confirm === "discard") keepBtnRef.current?.focus(); }, [confirm]);

  /* Release the stage canvas's backing store on close (iOS caps total canvas memory). */
  useEffect(() => {
    const c = canvasRef.current;
    return () => { if (c) { c.width = 0; c.height = 0; } };
  }, []);

  /* ── edits ── */
  const sync = () => {
    const cur = hist.current;
    if (capRef.current && !inkCapHit(cur, capRef.current)) { capRef.current = null; setNote(null); } // back under the cap
    setDoc(cur);
    paint();
  };
  const capNote = (before: InkDoc, add: CapAdd) => {
    const why = inkCapHit(before, add);
    if (!why) return;
    capRef.current = add;
    setNote(why === "labels" ? `A drawing holds up to ${INK_CAPS.labels} labels.`
      : why === "strokes" ? `This drawing is full (${INK_CAPS.strokes.toLocaleString()} strokes) — erase or undo to keep drawing.`
      : "This drawing is full (too much ink) — erase or undo to keep drawing.");
  };
  const select = (id: string | null) => { selRef.current = id; setSelected(id); };
  const undo = () => { if (gestureRef.current || busy) return; hist.undo(); select(null); sync(); };
  const redo = () => { if (gestureRef.current || busy) return; hist.redo(); select(null); sync(); };
  const removeSelected = () => {
    if (!selRef.current) return;
    hist.do({ t: "unlabel", id: selRef.current });
    select(null);
    sync();
    refocus();
  };
  const clearAll = () => { hist.do({ t: "clear" }); select(null); setConfirm(null); sync(); refocus(); };

  /** Keep keyboard focus inside the dialog when the focused control unmounts. */
  const refocus = () => requestAnimationFrame(() => {
    const root = rootRef.current;
    if (root && !root.contains(document.activeElement)) root.focus({ preventScroll: true });
  });
  const commitEdit = () => {
    const e = editingRef.current;
    if (!e) return;
    editingRef.current = null;
    setEditing(null);
    refocus();
    const text = e.value.trim();
    if (!text) return;
    const before = hist.current;
    hist.do({ t: "label", label: { id: inkId(), x: e.x, y: e.y, text, color, size: labelSize } });
    if (hist.current === before) capNote(before, { label: true });
    sync();
  };
  const cancelEdit = () => { editingRef.current = null; setEditing(null); refocus(); };
  const setEditValue = (value: string) => {
    if (!editingRef.current) return;
    editingRef.current = { ...editingRef.current, value };
    setEditing(editingRef.current);
  };

  const requestCancel = () => {
    if (busy) return;
    if (dirty) setConfirm("discard");
    else onCancel();
  };

  const done = async () => {
    if (busy) return;
    commitEdit();
    setBusy(true);
    setNote(null);
    capRef.current = null;
    try {
      const d = hist.current;
      // #344 C-final B: strokes past the upload cap would never upload — refuse here, with the pad still open
      if (!strokesFitUploadCap(serializeInk(d))) {
        setNote("This drawing is too big to save — erase some strokes or labels, then try Done again.");
        return;
      }
      const jpeg = await flattenInk(background, d);
      await onDone({ doc: d, jpeg });
    } catch {
      setNote("Couldn't save the drawing — try Done again.");
    } finally {
      setBusy(false); // a parent that keeps the pad open never leaves it stuck on "Saving…"
    }
  };

  /* ── pointers ── */
  const stagePt = (e: { clientX: number; clientY: number }): Pt => {
    const r = rectRef.current ?? stageRef.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  const docPt = (sp: Pt): Pt => {
    const sz = sizeRef.current, v = viewRef.current;
    if (!sz || !v) return sp;
    return screenToDoc(v, fitScale(sz.w, sz.h, dw, dh), sp.x, sp.y);
  };
  /** Drop a gesture without committing (second finger, cancel, pen arriving over a finger stroke). */
  const abortGesture = () => {
    const g = gestureRef.current;
    gestureRef.current = null;
    if (g && g.kind !== "pan" && g.kind !== "pinch" && g.kind !== "place") paint();
  };

  /** The Pencil wins: a palm's pan/pinch is undone and every finger on the glass is ignored until it lifts. */
  const penTakeover = () => {
    const g = gestureRef.current;
    if (g && (g.kind === "pan" || g.kind === "pinch")) { gestureRef.current = null; setView(g.origin); }
    else if (g && g.ptype === "touch") abortGesture();
    for (const id of touchesRef.current.keys()) ignoredRef.current.add(id);
    touchesRef.current.clear();
  };

  const onDown = (e: RPointerEvent<HTMLDivElement>) => {
    if (busy || confirm === "discard" || !viewRef.current) return;
    const type = e.pointerType, id = e.pointerId;
    if (type === "mouse" && e.button !== 0) return; // right / middle click never draws
    ignoredRef.current.delete(id); // a fresh press from an id whose pointerup was lost
    if (type === "pen") {
      if (!hasPen()) { notePen(); setPen(true); }
      penTakeover();
    }
    rectRef.current = stageRef.current!.getBoundingClientRect();
    const sp = stagePt(e);
    const stale = gestureRef.current;
    if (stale && "id" in stale && stale.id === id) abortGesture(); // its pointerup never arrived
    const role = pointerRole(type, hasPen());
    // A drawing press commits an open label and ends there; a finger pan in Pencil mode leaves the field open.
    if (editingRef.current && role === "draw") { commitEdit(); ignoredRef.current.add(id); return; }
    const g = gestureRef.current;
    if (type === "touch") {
      if (g && "ptype" in g && g.ptype === "pen") { ignoredRef.current.add(id); return; } // palm while the Pencil is down
      const touches = touchesRef.current;
      touches.set(id, sp);
      if (touches.size === 2) {
        const v = viewRef.current, origin = g?.kind === "pan" ? g.origin : v;
        abortGesture();
        const [a, b] = [...touches.keys()];
        gestureRef.current = { kind: "pinch", a, b, view: v, origin, a0: touches.get(a)!, b0: touches.get(b)! };
        try { e.currentTarget.setPointerCapture(id); } catch { /* already released */ }
        return;
      }
      if (touches.size > 2) return;
    }
    if (gestureRef.current) return;
    try { e.currentTarget.setPointerCapture(id); } catch { /* capture is best-effort */ }
    if (role === "nav") {
      const v = viewRef.current;
      gestureRef.current = { kind: "pan", id, view: v, origin: v, sx: sp.x, sy: sp.y, down: { t: e.timeStamp, ...sp }, started: false };
      return;
    }
    const d = docPt(sp);
    if (tool === "pen") {
      const g2: Gesture = { kind: "draw", id: e.pointerId, ptype: type, pts: [d.x, d.y, pointPressure(type, e.pressure)], color, width: penW };
      gestureRef.current = g2;
      drawLive(g2, 0);
    } else if (tool === "eraser") {
      const r = eraserRadius(penW, scaleNow());
      gestureRef.current = { kind: "erase", id: e.pointerId, ptype: type, doc: eraseAt(hist.current, d.x, d.y, r), r };
      paint();
    } else {
      const hit = hitLabel(hist.current.labels, d.x, d.y, measure, 6 / scaleNow());
      const l = hit ? hist.current.labels.find((x) => x.id === hit) : undefined;
      select(l ? l.id : null);
      gestureRef.current = l
        ? { kind: "label", id: e.pointerId, ptype: type, labelId: l.id, dx: d.x - l.x, dy: d.y - l.y, doc: hist.current, down: sp, moved: false }
        : { kind: "place", id: e.pointerId, ptype: type, at: d, down: sp };
    }
  };

  const onMove = (e: RPointerEvent<HTMLDivElement>) => {
    if (ignoredRef.current.has(e.pointerId)) return;
    const g = gestureRef.current;
    if (e.pointerType === "touch" && touchesRef.current.has(e.pointerId)) touchesRef.current.set(e.pointerId, stagePt(e));
    if (!g) return;
    if (g.kind === "pinch") {
      if (e.pointerId !== g.a && e.pointerId !== g.b) return;
      const t = touchesRef.current, a1 = t.get(g.a), b1 = t.get(g.b);
      if (a1 && b1) setView(pinchView(g.view, g.a0, g.b0, a1, b1));
      return;
    }
    if (e.pointerId !== g.id) return;
    if (g.kind === "pan") {
      const sp = stagePt(e);
      if (!g.started && !panStarted(sp.x - g.sx, sp.y - g.sy)) return; // a resting palm doesn't nudge the view
      g.started = true;
      setView({ z: g.view.z, x: g.view.x + sp.x - g.sx, y: g.view.y + sp.y - g.sy });
      return;
    }
    const ne = e.nativeEvent;
    const list = typeof ne.getCoalescedEvents === "function" ? ne.getCoalescedEvents() : [];
    const events = list.length ? list : [ne];
    if (g.kind === "draw") {
      const from = g.pts.length / 3;
      const minStep = 0.35 / scaleNow();
      for (const ce of events) {
        const d = docPt(stagePt(ce));
        const n = g.pts.length;
        if (Math.hypot(d.x - g.pts[n - 3], d.y - g.pts[n - 2]) < minStep) continue;
        g.pts.push(d.x, d.y, pointPressure(e.pointerType, ce.pressure));
      }
      drawLive(g, from);
    } else if (g.kind === "erase") {
      let next = g.doc;
      for (const ce of events) { const d = docPt(stagePt(ce)); next = eraseAt(next, d.x, d.y, g.r); }
      if (next !== g.doc) { g.doc = next; paint(); }
    } else if (g.kind === "label") {
      const sp = stagePt(e);
      if (!g.moved && Math.hypot(sp.x - g.down.x, sp.y - g.down.y) < 4) return;
      g.moved = true;
      const d = docPt(sp);
      g.doc = moveLabel(hist.current, g.labelId, d.x - g.dx, d.y - g.dy);
      paint();
    }
  };

  const onUp = (e: RPointerEvent<HTMLDivElement>) => {
    const g = gestureRef.current;
    const touches = touchesRef.current;
    touches.delete(e.pointerId);
    if (ignoredRef.current.delete(e.pointerId) || !g) return;
    if (g.kind === "pinch") {
      if (e.pointerId !== g.a && e.pointerId !== g.b) return;
      const rest = e.pointerId === g.a ? g.b : g.a;
      const p = touches.get(rest);
      const v = viewRef.current;
      gestureRef.current = p && v ? { kind: "pan", id: rest, view: v, origin: v, sx: p.x, sy: p.y, down: { t: -Infinity, ...p }, started: true } : null;
      return;
    }
    if (e.pointerId !== g.id) return;
    gestureRef.current = null;
    const sp = stagePt(e);
    if (g.kind === "pan") {
      const tap = { t: e.timeStamp, ...sp };
      if (!isTap(g.down, tap)) return;
      if (isDoubleTap(lastTapRef.current, tap) && sizeRef.current) {
        lastTapRef.current = null;
        setView(fitView(sizeRef.current.w, sizeRef.current.h, dw, dh));
      } else lastTapRef.current = tap;
    } else if (g.kind === "draw") {
      const before = hist.current;
      const pts = simplify(g.pts, Math.max(0.25, 0.6 / scaleNow()));
      hist.do({ t: "stroke", stroke: { id: inkId(), tool: "pen", color: g.color, width: g.width, pts } });
      if (hist.current === before) capNote(before, { pts: pts.length });
      sync();
    } else if (g.kind === "erase") {
      if (g.doc !== hist.current) hist.do({ t: "replace", doc: g.doc });
      sync();
    } else if (g.kind === "label") {
      const l = g.doc.labels.find((x) => x.id === g.labelId);
      if (g.moved && l) hist.do({ t: "move", id: l.id, x: l.x, y: l.y });
      sync();
    } else if (g.kind === "place" && Math.hypot(sp.x - g.down.x, sp.y - g.down.y) <= 10) {
      // Open the field inside the pointerup (a user activation) so iPad raises the keyboard / Scribble.
      editingRef.current = { x: g.at.x, y: g.at.y, value: "" };
      flushSync(() => setEditing(editingRef.current));
      inputRef.current?.focus();
    }
  };

  const onCancelPointer = (e: RPointerEvent<HTMLDivElement>) => {
    touchesRef.current.delete(e.pointerId);
    if (ignoredRef.current.delete(e.pointerId)) return;
    const g = gestureRef.current;
    if (!g) return;
    if (g.kind === "pinch" ? e.pointerId === g.a || e.pointerId === g.b : e.pointerId === g.id) abortGesture();
  };

  /* ── keyboard: Esc, ⌘Z / ⇧⌘Z, Delete, focus trap ── */
  const onKey = (e: KeyboardEvent) => {
    const root = rootRef.current;
    if (!root) return;
    if (e.key === "Tab") {
      const els = Array.from(root.querySelectorAll<HTMLElement>("button:not([disabled]), input"));
      if (!els.length) return;
      const first = els[0], last = els[els.length - 1], at = document.activeElement;
      if (!root.contains(at)) { e.preventDefault(); first.focus(); }
      else if (e.shiftKey && (at === first || at === root)) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && at === last) { e.preventDefault(); first.focus(); }
      return;
    }
    if ((e.target as HTMLElement | null)?.tagName === "INPUT") return; // the label field handles its own keys
    const mod = e.metaKey || e.ctrlKey;
    if (e.key === "Escape") {
      e.preventDefault();
      if (confirm) setConfirm(null);
      else requestCancel();
    } else if (mod && e.key.toLowerCase() === "z") {
      e.preventDefault();
      if (e.shiftKey) redo(); else undo();
    } else if (mod && e.key.toLowerCase() === "y") {
      e.preventDefault();
      redo();
    } else if ((e.key === "Delete" || e.key === "Backspace") && selected) {
      e.preventDefault();
      removeSelected();
    }
  };

  useEffect(() => { keyRef.current = onKey; });
  useEffect(() => {
    const h = (e: KeyboardEvent) => keyRef.current(e);
    document.addEventListener("keydown", h);
    return () => document.removeEventListener("keydown", h);
  }, []);

  const editAt = editing && view ? docToScreen(view, fit, editing.x, editing.y) : null;
  const s = fit * (view?.z ?? 1);
  const toolBtn = (t: Tool, label: string, ref?: Ref<HTMLButtonElement>) => (
    <button ref={ref} type="button" className="ink-btn" aria-pressed={tool === t} onClick={() => { setTool(t); if (t !== "text") select(null); }} disabled={busy}>
      {label}
    </button>
  );

  return (
    <div ref={rootRef} className="ink-root" role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1}>
      <style>{INK_CSS}</style>
      <div className="ink-bar">
        <h2 id={titleId} className="ink-title">{title}</h2>
        <div className="ink-tools" role="toolbar" aria-label="Drawing tools">
          <div className="ink-group">
            {toolBtn("pen", "Pen", firstBtnRef)}
            {INK_COLORS.map((c, i) => (
              <button key={c} type="button" className="ink-swatch" aria-label={`${COLOR_NAMES[i] ?? c} ink`} aria-pressed={color === c} disabled={busy}
                onClick={() => { setColor(c); if (tool === "eraser") setTool("pen"); }} style={{ background: c }} />
            ))}
            {toolBtn("eraser", "Eraser")}
            {toolBtn("text", "Text")}
          </div>
          <div className="ink-group">
            <button type="button" className="ink-btn" onClick={undo} disabled={busy || !hist.canUndo} aria-label="Undo">↶ Undo</button>
            <button type="button" className="ink-btn" onClick={redo} disabled={busy || !hist.canRedo} aria-label="Redo">↷ Redo</button>
            {/* Always laid out (hidden when nothing is selected) so selecting a label never re-wraps the toolbar. */}
            <button type="button" className="ink-btn" onClick={removeSelected} aria-label="Remove label" disabled={!selected || busy}
              aria-hidden={!selected} style={{ visibility: selected ? "visible" : "hidden" }}>✕ Label</button>
            {confirm === "clear" ? (
              <span className="ink-confirm" role="group" aria-label="Confirm clear">
                Clear all?
                <button type="button" className="ink-btn ink-danger" onClick={clearAll}>Clear</button>
                <button type="button" className="ink-btn" onClick={() => setConfirm(null)}>Keep</button>
              </span>
            ) : (
              <button type="button" className="ink-btn" onClick={() => setConfirm("clear")} disabled={busy || (!doc.strokes.length && !doc.labels.length)}>Clear</button>
            )}
            <button type="button" className="ink-btn" onClick={() => stage && setView(fitView(stage.w, stage.h, dw, dh))} aria-label="Fit to screen">Fit</button>
          </div>
          <div className="ink-group ink-end">
            <button type="button" className="ink-btn" onClick={requestCancel} disabled={busy}>Cancel</button>
            <button type="button" className="ink-btn ink-primary" onClick={done} disabled={busy}>{busy ? "Saving…" : "Done"}</button>
          </div>
        </div>
      </div>
      <div className="ink-hint" aria-live="polite">
        {note ?? (pen ? "Pencil draws · one finger pans · pinch to zoom · double-tap to fit" : "Draw with a finger or mouse · pinch or ⌘-scroll to zoom")}
      </div>
      {confirm === "discard" && (
        <div className="ink-discard" role="alertdialog" aria-label="Discard changes?">
          <span>Discard your changes to this drawing?</span>
          <button type="button" className="ink-btn ink-danger" onClick={onCancel}>Discard</button>
          <button ref={keepBtnRef} type="button" className="ink-btn" onClick={() => setConfirm(null)}>Keep drawing</button>
        </div>
      )}
      <div
        ref={stageRef}
        className="ink-stage"
        style={{ touchAction: "none", cursor: tool === "text" ? "text" : "crosshair" }}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onCancelPointer}
        onLostPointerCapture={onCancelPointer}
        onMouseDown={(e) => { if ((e.target as HTMLElement).tagName !== "INPUT") e.preventDefault(); }}
        onContextMenu={(e) => e.preventDefault()}
      >
        {view && (
          // eslint-disable-next-line @next/next/no-img-element -- a data:/blob:/photo URL drawn under the canvas, never optimised
          <img className="ink-bg" src={bgSrc} alt="" draggable={false}
            style={{ left: view.x, top: view.y, width: dw * s, height: dh * s }} />
        )}
        <canvas ref={canvasRef} className="ink-canvas" aria-hidden="true" />
        {editing && editAt && (
          <input
            ref={inputRef}
            className="ink-label-input"
            aria-label="Label text"
            value={editing.value}
            maxLength={INK_CAPS.labelChars}
            onChange={(e) => setEditValue(e.target.value)}
            onBlur={commitEdit}
            onPointerDown={(e) => e.stopPropagation()}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.nativeEvent.isComposing && e.keyCode !== 229) { e.preventDefault(); commitEdit(); } // not mid-IME
              else if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); cancelEdit(); }
            }}
            // ≥ 16px so iOS Safari doesn't zoom the page on focus; the committed label draws at its real size.
            style={{ left: editAt.x, top: editAt.y, color, fontSize: Math.max(16, labelSize * s) }}
          />
        )}
      </div>
    </div>
  );
}

const INK_CSS = `
.ink-root { position: fixed; inset: 0; z-index: 1000; display: flex; flex-direction: column; background: #2b2e35;
  padding: env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left); outline: none;
  touch-action: none; -webkit-user-select: none; user-select: none; -webkit-touch-callout: none; }
.ink-bar { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 14px; padding: 8px 12px; background: #fff; border-bottom: 1px solid #e2e4ea; }
.ink-title { font-size: 15px; font-weight: 700; margin: 0; color: #16181d; max-width: 30ch; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ink-tools { display: flex; flex: 1 1 auto; flex-wrap: wrap; align-items: center; gap: 8px 14px; min-width: 0; }
.ink-group { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.ink-end { margin-left: auto; }
.ink-btn { min-height: 40px; min-width: 44px; padding: 0 12px; border-radius: 8px; border: 1px solid #d4d7de; background: #fff; color: #16181d;
  font: inherit; font-size: 14px; font-weight: 600; cursor: pointer; touch-action: manipulation; }
.ink-btn[aria-pressed="true"] { background: var(--accent-soft, #f4ecdc); border-color: var(--accent, #b08d4a); color: var(--accent-ink, #8a6c34); }
.ink-btn:disabled { opacity: .45; cursor: default; }
.ink-btn:focus-visible, .ink-swatch:focus-visible { outline: 2px solid var(--accent, #b08d4a); outline-offset: 2px; }
.ink-primary { background: #16181d; border-color: #16181d; color: #fff; }
.ink-danger { background: #b4342a; border-color: #b4342a; color: #fff; }
.ink-swatch { width: 34px; height: 34px; border-radius: 50%; border: 3px solid #fff; box-shadow: 0 0 0 1px #c9ccd3; cursor: pointer; touch-action: manipulation; }
.ink-swatch[aria-pressed="true"] { box-shadow: 0 0 0 2px var(--accent, #b08d4a); }
.ink-confirm { display: inline-flex; align-items: center; gap: 6px; font-size: 13.5px; font-weight: 600; color: #b4342a; }
.ink-hint { padding: 4px 12px; font-size: 12px; color: #c9ccd3; background: #2b2e35; }
.ink-discard { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; padding: 10px 12px; background: #fff6e5; color: #5a4210; font-size: 14px; font-weight: 600; }
.ink-stage { position: relative; flex: 1; overflow: hidden; background: #e7e9ee; user-select: none; -webkit-user-select: none; -webkit-touch-callout: none; }
.ink-bg { position: absolute; max-width: none; background: #fff; pointer-events: none; user-select: none; box-shadow: 0 2px 12px rgba(0,0,0,.18); }
.ink-canvas { position: absolute; inset: 0; width: 100%; height: 100%; pointer-events: none; }
.ink-label-input { position: absolute; min-width: 8ch; padding: 0 2px; border: 1px dashed #5b6170; background: rgba(255,255,255,.85);
  font-family: sans-serif; line-height: 1.2; outline: none; -webkit-user-select: text; user-select: text; touch-action: manipulation; }
`;
