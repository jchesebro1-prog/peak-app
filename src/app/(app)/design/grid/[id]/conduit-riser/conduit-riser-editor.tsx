"use client";

import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from "react";
import { useRouter } from "next/navigation";
import { ConfirmButton } from "@/components/confirm-button";
import { ConduitRiserFigure, CR_UNITS } from "@/components/drawing/conduit-riser-figure";
import { measureSheetAspect } from "@/components/design/sheet-aspect";
import { connectKind, type EndRef } from "@/lib/design/grid-riser-doc";
import { layoutDetail, type DetailLayout, type LaidItem } from "@/lib/design/conduit-riser/layout";
import { detailGeometry, type Geo } from "@/lib/design/conduit-riser/drawing";
import type { ViewDetail, ViewEnd } from "@/lib/design/conduit-riser/derive";
import type { CRBoxType, CRWireType } from "@/lib/design/conduit-riser/input";
import { isOverfilled, viewRunFill } from "@/lib/design/conduit-riser/fill";
import type { GridLevel } from "@/lib/design/grid-levels";
import type { PlacementTag, TagPatch } from "@/lib/design/conduit-riser/tags";
import { pairKey, type ConduitRiserDoc, type CROp, type RunEnd } from "@/lib/design/conduit-riser/model";
import {
  applyLayoutOps,
  historyFor,
  inverseLayoutOp,
  landHistory,
  recordEdit,
  snapIn,
  stepRedo,
  stepUndo,
  viewWithDoc,
  type Landed,
  type LayoutHistory,
  type LayoutOp,
} from "@/lib/design/conduit-riser/edit";
import { isPressKey, levelHitLabel, runHitLabel, stubHitLabel, tagHitLabel } from "@/lib/design/conduit-riser/editor-rules";
import { addRiserLinkAction } from "../riser/actions";
import { addRouteAction, saveLevelsAction, setTagFieldsAction } from "../actions";
import { acceptSuggestionsAction, dismissSuggestionAction, patchConduitRiserAction } from "./actions";
import {
  AlwaysShowPanel,
  AlwaysShowView,
  DefaultsPanel,
  DefaultsView,
  DetailPanel,
  DetailView,
  LevelLinePanel,
  LevelLineView,
  LevelsPanel,
  LevelsView,
  NewStubPanel,
  NOTHING_NEW,
  NotesPanel,
  NotesView,
  PairPanel,
  PowerTypesPanel,
  PowerTypesView,
  RunPanel,
  RunView,
  SharedLists,
  StubPanel,
  StubView,
  SuggestionsPanel,
  TagPanel,
  TagView,
  WarningsPanel,
  type RunSave,
  type SuggestionRow,
} from "./panels";
import type { RiserPartOption } from "../riser/riser-panels";

export type { SuggestionRow };

/**
 * The lighting control riser editor (#321). The view and its layout are
 * derived server-side and arrive as props; every edit goes through a server
 * action, then router.refresh() re-derives them. A drag previews by
 * applying its layout op to a copy of the document and re-running the pure
 * layout here — the same code the server runs — then commits on release.
 * Undo / redo covers only those layout ops, tied to the project's version.
 *
 * #321 polish: on a phone the riser is fully read-only (Jeff, 2026-10-10) —
 * no tools, no Accept, every panel shows its values as text. The canvas
 * hit targets are keyboard buttons (Tab, Enter / Space; Escape clears the
 * selection and a half-picked Connect end), and every write — including
 * the ConfirmButton ones — holds `busy` while it's in flight.
 */

type Tool = "select" | "connect" | "stub";
type Res = { ok: true; landed?: Landed } | { ok: false; error: string };
/** What one write tells `run`: a notice to show, or an error (and whether the page still changed). */
type Outcome = { ok: true; notice?: string; landed?: Landed } | { ok: false; error: string; refresh?: boolean };
const SOMETHING_WRONG = "Something went wrong — please try again.";
type SheetLite = { id: string; name: string; mime: string; src: string };
type Sel =
  | { kind: "tag"; id: string }
  | { kind: "stub"; id: string }
  | { kind: "run"; id: string }
  | { kind: "level"; id: string }
  | { kind: "pair"; a: RunEnd; b: RunEnd; aLabel: string; bLabel: string }
  | { kind: "newStub" }
  | null;
/** One press on the canvas; `dx`/`dy` = grab offset from the item's corner. */
type Drag = { kind: "tag" | "stub" | "level" | "run"; id: string; dx: number; dy: number; sx: number; sy: number; moved: boolean; op: LayoutOp | null };

const TOOLS: { key: Tool; label: string; hint: string }[] = [
  { key: "select", label: "Select", hint: "Click a tag, run, stub or level line to edit it. Drag tags, stubs, a run's lane or a level line to tidy the drawing." },
  { key: "connect", label: "Connect", hint: "Click two tags (or a tag and a stub) to run a conduit between them." },
  { key: "stub", label: "+ Stub", hint: "Name the stub — a line ending in a label such as \"TO FACP\"." },
];
const ZOOMS = [40, 56, 72, 96, 120, 150];
/** Pointer travel (inches) before a press becomes a drag. */
const DRAG_START = 0.04;
const PHONE_QUERY = "(max-width: 640px)";

function subscribePhone(cb: () => void) {
  const m = window.matchMedia(PHONE_QUERY);
  m.addEventListener("change", cb);
  return () => m.removeEventListener("change", cb);
}

export default function ConduitRiserEditor(props: {
  projectId: string;
  optionId: string;
  /** The project's `updatedAt` — the layout-undo stack is tied to it. */
  version: number;
  planHref: string;
  view: ViewDetail;
  layout: DetailLayout;
  figure: { geo: Geo[]; w: number; h: number };
  doc: ConduitRiserDoc;
  placementIds: string[];
  detailCount: number;
  warnings: string[];
  suggestions: SuggestionRow[];
  loose: { id: string; cable: string }[];
  levels: GridLevel[];
  spaces: { id: string; name: string }[];
  boxTypes: CRBoxType[];
  sizes: string[];
  wireTypes: CRWireType[];
  deviceTypes: { key: string; label: string }[];
  cables: RiserPartOption[];
  estimateOwned: boolean;
  sheets: SheetLite[];
  placements: { id: string; sheetId: string; page: number; x: number; y: number }[];
  calibrations: { docId: string; page: number }[];
  /** Each device's own tag fields (placement.tag) — the Tag panel saves against these. */
  tagOverrides: Record<string, PlacementTag>;
}) {
  const { projectId, optionId, view, doc, planHref } = props;
  const detailId = view.detail.id;
  const router = useRouter();
  const svgRef = useRef<SVGSVGElement | null>(null);
  const drag = useRef<Drag | null>(null);
  const pids = useMemo(() => new Set(props.placementIds), [props.placementIds]);
  const phone = useSyncExternalStore(subscribePhone, () => window.matchMedia(PHONE_QUERY).matches, () => false);
  const [toolPick, setTool] = useState<Tool>("select");
  // A phone is read-only: always Select (view), whatever was picked before the window narrowed.
  const tool: Tool = phone ? "select" : toolPick;
  // The newest version this editor's own writes landed on: until the refresh
  // brings it in as props.version, an edit made in between is still made
  // against the version the server actually has.
  const [landedAt, setLandedAt] = useState(0);
  const version = Math.max(props.version || 0, landedAt);
  const [sel, setSel] = useState<Sel>(null);
  const [first, setFirst] = useState<{ end: RunEnd; label: string; key: string } | null>(null);
  const [dragOp, setDragOp] = useState<LayoutOp | null>(null);
  // A committed layout edit awaiting the refresh — shown only while the
  // server data is still the document it was made against.
  const [pending, setPending] = useState<{ base: ConduitRiserDoc; op: LayoutOp } | null>(null);
  const [history, setHistory] = useState<LayoutHistory | null>(null);
  const [zoom, setZoom] = useState(72);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const awaiting = pending !== null && pending.base === doc;
  const waiting = busy || awaiting;
  const liveOps = [...(awaiting ? [pending!.op] : []), ...(dragOp ? [dragOp] : [])];
  let shownLayout = props.layout;
  let shownFigure = props.figure;
  if (liveOps.length) {
    const shownDoc = applyLayoutOps(doc, liveOps, pids);
    const v = viewWithDoc(view, shownDoc);
    shownLayout = layoutDetail(v, shownDoc);
    shownFigure = detailGeometry(shownLayout, v);
  }
  const stack = historyFor(history, doc, version);

  const deviceById = new Map(view.tags.map((t) => [t.device.id, t.device]));
  const stubById = new Map(doc.stubs.map((s) => [s.id, s]));
  const itemLabel = (it: LaidItem) => (it.kind === "tag" ? deviceById.get(it.id)?.label || it.id : it.label || it.id);
  const endLabel = (e: ViewEnd) => (e.kind === "tag" ? deviceById.get(e.id)?.label || e.id : e.kind === "stub" ? stubById.get(e.id)?.label || e.id : e.label);

  /** Carry the undo stack across one of this editor's own writes (none reported: the next render decides). */
  const carryHistory = (landed: Landed | undefined) => setHistory((h) => landHistory(h, landed));
  const noteLanded = (landed: Landed | undefined) => {
    if (landed) setLandedAt((v) => Math.max(v, landed.after));
  };

  /**
   * Every write goes through here: `busy` while it's in flight (drags and
   * every other edit wait), the error or notice shown, the stack carried,
   * the page refreshed. `rethrow` = for a ConfirmButton — the failure is
   * thrown so the button shows it, instead of the alert.
   */
  async function run(fn: () => Promise<Outcome>, opts: { land?: (landed: Landed | undefined) => void; rethrow?: boolean } = {}): Promise<boolean> {
    setBusy(true);
    setErr(null);
    setNotice(null);
    let failure: string | null = null;
    try {
      const r = await fn();
      if (!r.ok) {
        failure = r.error;
        if (r.refresh) router.refresh();
      } else {
        (opts.land ?? carryHistory)(r.landed);
        noteLanded(r.landed);
        if (r.notice) setNotice(r.notice);
        router.refresh();
        return true;
      }
    } catch {
      failure = SOMETHING_WRONG;
    } finally {
      setBusy(false);
    }
    if (opts.rethrow) throw new Error(failure ?? SOMETHING_WRONG);
    setErr(failure);
    return false;
  }

  /** For ConfirmButton (Reset layout, Remove run / stub, Delete detail, note delete): busy like any write; throws on failure so the button shows the error. */
  async function mustOk(fn: () => Promise<Res>): Promise<void> {
    await run(fn, { rethrow: true });
  }

  const patch = (op: CROp) => run(() => patchConduitRiserAction(projectId, optionId, op));

  /** Commit one layout op: previewed until the refresh lands; an edit joins the undo stack. */
  async function commitLayout(op: LayoutOp, after?: LayoutHistory) {
    const base = doc;
    const at = version;
    const inverse = after ? null : inverseLayoutOp(base, props.layout, op);
    setPending({ base, op });
    setDragOp(null);
    const ok = await run(() => patchConduitRiserAction(projectId, optionId, op), {
      // The stack as this edit leaves it, moved to the version the write landed on.
      land: (landed) => {
        if (after) setHistory(landHistory(after, landed));
        else if (inverse) setHistory((h) => landHistory(recordEdit(h, base, { forward: op, inverse }, pids, at), landed));
        else carryHistory(landed);
      },
    });
    if (!ok) setPending(null);
  }

  function undo() {
    const u = stepUndo(history, doc, pids, version);
    if (u && !waiting) void commitLayout(u.op, u.next);
  }
  function redo() {
    const r = stepRedo(history, doc, pids, version);
    if (r && !waiting) void commitLayout(r.op, r.next);
  }

  /** Escape: nothing selected, no half-picked Connect end. */
  function cancelAll() {
    setFirst(null);
    setSel(null);
    if (toolPick === "stub") setTool("select");
  }

  // Escape from anywhere in the editor (canvas or panels) — never from a
  // form field, where the typing isn't saved yet: leave the field first.
  // The listener reads the latest render through a ref.
  const rootRef = useRef<HTMLDivElement | null>(null);
  const escapeRef = useRef(cancelAll);
  useEffect(() => {
    escapeRef.current = cancelAll;
  });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      const t = e.target instanceof Element ? e.target : null;
      const inEditor = !t || t === document.body || !!rootRef.current?.contains(t);
      if (!inEditor || t?.closest("input, select, textarea, [contenteditable='true']")) return;
      escapeRef.current();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  function choose(t: Tool) {
    setTool(t);
    setFirst(null);
    setErr(null);
    setSel(t === "stub" ? { kind: "newStub" } : null);
  }

  function toIn(e: { clientX: number; clientY: number }): { x: number; y: number } | null {
    const m = svgRef.current?.getScreenCTM();
    if (!m) return null;
    const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(m.inverse());
    return { x: p.x / CR_UNITS, y: p.y / CR_UNITS };
  }

  /** Arm a drag; `corner` = the item's top-left, for tags and stubs. */
  function startDrag(e: ReactPointerEvent<SVGElement>, kind: Drag["kind"], id: string, corner?: { x: number; y: number }) {
    if (phone || waiting || tool !== "select") return;
    const p = toIn(e);
    if (!p) return;
    drag.current = { kind, id, dx: corner ? p.x - corner.x : 0, dy: corner ? p.y - corner.y : 0, sx: p.x, sy: p.y, moved: false, op: null };
    svgRef.current?.setPointerCapture(e.pointerId);
  }

  function opFor(d: Drag, p: { x: number; y: number }): LayoutOp {
    switch (d.kind) {
      case "tag":
        return { op: "moveTag", placementId: d.id, x: snapIn(p.x - d.dx), y: snapIn(p.y - d.dy), detailId };
      case "stub":
        return { op: "updateStub", id: d.id, x: snapIn(p.x - d.dx), y: snapIn(p.y - d.dy) };
      case "level":
        return { op: "moveLevel", detailId, levelId: d.id, y: snapIn(p.y) };
      case "run":
        return { op: "updateRun", id: d.id, laneX: snapIn(p.x) };
    }
  }

  function onMove(e: ReactPointerEvent<SVGSVGElement>) {
    const d = drag.current;
    if (!d) return;
    const p = toIn(e);
    if (!p) return;
    if (!d.moved && Math.hypot(p.x - d.sx, p.y - d.sy) < DRAG_START) return;
    d.moved = true;
    d.op = opFor(d, p);
    setDragOp(d.op);
  }

  function onUp() {
    const d = drag.current;
    drag.current = null;
    if (!d || !d.moved || !d.op) {
      setDragOp(null);
      return;
    }
    void commitLayout(d.op);
  }

  /** The browser took the pointer (a scroll, a system gesture): drop the
   *  drag and its preview — never commit a move the user didn't finish. */
  function onCancel() {
    drag.current = null;
    setDragOp(null);
  }

  function pickEnd(it: LaidItem) {
    if (it.kind === "ref") {
      setErr("That end is in another detail — connect it there.");
      return;
    }
    const end: RunEnd = it.kind === "tag" ? { kind: "placement", placementId: it.id } : { kind: "stub", stubId: it.id };
    const label = itemLabel(it);
    if (!first) {
      setFirst({ end, label, key: it.key });
      setErr(null);
      return;
    }
    if (first.key === it.key) {
      setErr("Pick two different ends.");
      setFirst(null);
      return;
    }
    if (first.end.kind === "stub" && end.kind === "stub") {
      setErr("Connect a tag to a stub — two stubs can't share a run.");
      setFirst(null);
      return;
    }
    setSel({ kind: "pair", a: first.end, b: end, aLabel: first.label, bLabel: label });
    setFirst(null);
  }

  /** Click, or Enter / Space on a focused tag or stub: select it, or pick it as a Connect end. Returns false when nothing happened. */
  function pressItem(it: LaidItem): boolean {
    if (tool === "connect") {
      pickEnd(it);
      return true;
    }
    if (tool !== "select") return false;
    if (it.kind === "tag") setSel({ kind: "tag", id: it.id });
    else if (it.kind === "stub") setSel({ kind: "stub", id: it.id });
    else return false;
    return true;
  }

  function itemDown(it: LaidItem, e: ReactPointerEvent<SVGElement>) {
    e.stopPropagation();
    if (pressItem(it) && tool === "select" && it.kind !== "ref") startDrag(e, it.kind, it.id, it.rect);
  }

  /** Enter / Space on a focused hit target presses it, like a button. */
  const onPress = (fn: () => void) => (e: ReactKeyboardEvent<SVGElement>) => {
    if (!isPressKey(e.key)) return;
    e.preventDefault();
    fn();
  };

  /** Connect → "With wire…": add the plan wire (measured route on a scaled
   *  shared page, else a typed-length link), then accept that pair. */
  async function connectWithWire(a: string, b: string, partId: string, lengthFt: number | null) {
    const from: EndRef = { kind: "placement", placementId: a };
    const to: EndRef = { kind: "placement", placementId: b };
    await run(async (): Promise<Outcome> => {
      let added: Res;
      if (connectKind(from, to, props.placements, props.calibrations) === "route") {
        const pa = props.placements.find((p) => p.id === a);
        const pb = props.placements.find((p) => p.id === b);
        const sheet = props.sheets.find((s) => s.id === pa?.sheetId);
        if (!pa || !pb || !sheet) return { ok: false, error: "Those devices are no longer on the plan — refresh the page." };
        let aspect: number;
        try {
          aspect = await measureSheetAspect(sheet, pa.page);
        } catch {
          return { ok: false, error: "Couldn't open the plan sheet to measure this wire — try again." };
        }
        added = await addRouteAction(projectId, {
          sheetId: pa.sheetId,
          page: pa.page,
          partId,
          points: [
            { x: pa.x, y: pa.y },
            { x: pb.x, y: pb.y },
          ],
          aspect,
          optionId,
          fromPlacementId: a,
          toPlacementId: b,
        });
      } else {
        if (lengthFt === null) return { ok: false, error: "Type the cable length." };
        added = await addRiserLinkAction(projectId, { optionId, from, to, partId, lengthFt });
      }
      if (!added.ok) return added;
      // The wire is on the plan from here on — a failure below still refreshes.
      const acc = await acceptSuggestionsAction(projectId, optionId, [pairKey(a, b)]);
      if (!acc.ok) return { ok: false, error: `The wire is on the plan, but the run wasn't added: ${acc.error}`, refresh: true };
      if (acc.accepted === 0) return { ok: true, notice: "The wire is on the plan, but it isn't a lighting control wire, so the riser didn't add a run for it.", landed: acc.landed };
      setSel(null);
      return { ok: true, landed: acc.landed };
    });
  }

  async function acceptKeys(keys: string[] | "all") {
    await run(async (): Promise<Outcome> => {
      const r = await acceptSuggestionsAction(projectId, optionId, keys);
      if (!r.ok) return { ...r, refresh: true };
      return r.accepted === 0 ? { ok: true, notice: `${NOTHING_NEW}.`, landed: r.landed } : { ok: true, landed: r.landed };
    });
  }

  const saveTag = (id: string, tagPatch: TagPatch) =>
    run(async () => {
      const r = await setTagFieldsAction(projectId, [{ id, patch: tagPatch }]);
      return r.ok ? { ok: true as const, landed: r.landed } : r;
    });

  function saveRun(id: string, v: RunSave) {
    void patch({ op: "updateRun", id, ...v });
  }

  // ---------------------------------------------------------------- render
  const accent = "var(--accent)";
  const selTag = sel?.kind === "tag" ? deviceById.get(sel.id) : undefined;
  const selStub = sel?.kind === "stub" ? stubById.get(sel.id) : undefined;
  const selRun = sel?.kind === "run" ? view.runs.find((r) => r.run.id === sel.id) : undefined;
  const selLevel = sel?.kind === "level" ? shownLayout.levels.find((l) => l.id === sel.id) : undefined;
  const pairCanWire = sel?.kind === "pair" && sel.a.kind === "placement" && sel.b.kind === "placement";
  const pairKind =
    sel?.kind === "pair" && sel.a.kind === "placement" && sel.b.kind === "placement"
      ? connectKind({ kind: "placement", placementId: sel.a.placementId }, { kind: "placement", placementId: sel.b.placementId }, props.placements, props.calibrations)
      : "link";
  const selItemKey = sel?.kind === "tag" ? `tag:${sel.id}` : sel?.kind === "stub" ? `stub:${sel.id}` : first?.key;
  const U = CR_UNITS;
  const canDrag = !phone && tool === "select";
  const runById = new Map(view.runs.map((r) => [r.run.id, r]));
  const runName = (runId: string) => {
    const vr = runById.get(runId);
    return vr ? runHitLabel(endLabel(vr.a), endLabel(vr.b), vr.run.size, vr.run.style) : "Run";
  };

  return (
    <div className="cr-editor-root" ref={rootRef}>
      <style>{`
        .cr-editor { display: grid; grid-template-columns: minmax(0, 1fr) 370px; gap: 16px; align-items: start; }
        @media (max-width: 980px) { .cr-editor { grid-template-columns: minmax(0, 1fr); } }
        .cr-hit { outline: none; }
        .cr-hit:focus-visible { stroke: var(--accent); stroke-width: 2px; stroke-dasharray: 4 3; }
        polyline.cr-hit:focus-visible { stroke: color-mix(in srgb, var(--accent) 35%, transparent); stroke-dasharray: none; }
      `}</style>
      <SharedLists sizes={props.sizes} boxTypes={props.boxTypes} />
      <div className="pk-no-print" style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 8, alignItems: "center" }}>
        {!phone &&
          TOOLS.map((t) => (
            <button key={t.key} type="button" className={tool === t.key ? "pk-btn-accent" : "pk-btn-outline"} style={{ fontSize: 12 }} aria-pressed={tool === t.key} onClick={() => choose(t.key)}>
              {t.label}
            </button>
          ))}
        <span style={{ width: 8 }} />
        <button type="button" className="pk-btn-outline" style={{ fontSize: 12 }} disabled={busy} title="Lay the drawing out again from the plan (pinned items stay put)" onClick={() => router.refresh()}>
          Re-layout
        </button>
        {!phone && (
          // Not undoable — every hand-placed position in the detail goes, so it asks first.
          <ConfirmButton
            className="pk-btn-outline"
            style={{ fontSize: 12 }}
            disabled={waiting}
            title="Un-pin every tag and stub in this detail and put lanes and level lines back"
            label="Reset layout"
            confirmLabel="Reset this detail's layout"
            pendingLabel="Resetting…"
            onConfirm={() => mustOk(() => patchConduitRiserAction(projectId, optionId, { op: "resetLayout", detailId, runIds: view.runs.map((r) => r.run.id) }))}
          />
        )}
        {!phone && (
          <>
            <button type="button" className="pk-btn-outline" style={{ fontSize: 12 }} disabled={waiting || !stack.undo.length} onClick={undo}>
              Undo
            </button>
            <button type="button" className="pk-btn-outline" style={{ fontSize: 12 }} disabled={waiting || !stack.redo.length} onClick={redo}>
              Redo
            </button>
          </>
        )}
        <span style={{ marginLeft: "auto", display: "inline-flex", gap: 4, alignItems: "center", fontSize: 12, color: "#5b616e" }}>
          <button type="button" className="pk-btn-outline" style={{ fontSize: 12, padding: "3px 9px" }} disabled={zoom <= ZOOMS[0]} onClick={() => setZoom(ZOOMS[Math.max(0, ZOOMS.indexOf(zoom) - 1)])} aria-label="Zoom out">
            −
          </button>
          <span style={{ minWidth: 42, textAlign: "center" }}>{Math.round((zoom / 96) * 100)}%</span>
          <button
            type="button"
            className="pk-btn-outline"
            style={{ fontSize: 12, padding: "3px 9px" }}
            disabled={zoom >= ZOOMS[ZOOMS.length - 1]}
            onClick={() => setZoom(ZOOMS[Math.min(ZOOMS.length - 1, ZOOMS.indexOf(zoom) + 1)])}
            aria-label="Zoom in"
          >
            +
          </button>
        </span>
      </div>
      <div className="pk-no-print" style={{ fontSize: 12, color: "#8c919c", marginBottom: 8 }}>
        {phone ? "View only on a phone — open the riser on a larger screen to edit it." : TOOLS.find((t) => t.key === tool)?.hint}
        {first ? ` — from ${first.label}; now click the other end.` : ""}
      </div>
      {err && (
        <div role="alert" style={{ fontSize: 12.5, color: "#b4543a", background: "#f9ece8", border: "1px solid #f0d6cd", borderRadius: 8, padding: "8px 12px", marginBottom: 10 }}>
          {err}
        </div>
      )}
      {notice && (
        <div role="status" style={{ fontSize: 12.5, color: "#3b404a", background: "#f1f4f8", border: "1px solid #e1e6ee", borderRadius: 8, padding: "8px 12px", marginBottom: 10 }}>
          {notice}
        </div>
      )}

      <div className="cr-editor">
        <div className="pk-card" style={{ padding: 8, overflow: "auto", maxHeight: "78vh", minHeight: 240 }}>
          {view.tags.length === 0 && view.stubs.length === 0 && (
            <div style={{ fontSize: 13, color: "#8c919c", padding: "8px 6px" }}>
              Nothing on this detail yet. Accept a run under From the plan, or place lighting control devices on the plan and wire them.
            </div>
          )}
          <ConduitRiserFigure
            geo={shownFigure.geo}
            w={shownFigure.w}
            h={shownFigure.h}
            scale={zoom}
            svgRef={svgRef}
            svgProps={{
              onPointerMove: onMove,
              onPointerUp: onUp,
              onPointerCancel: onCancel,
              onPointerDown: () => {
                // Empty canvas: clears the selection, or cancels a half-picked Connect end.
                if (tool === "select") setSel(null);
                else if (tool === "connect") setFirst(null);
              },
              style: { touchAction: canDrag ? "none" : "auto", userSelect: "none", WebkitUserSelect: "none", cursor: tool === "connect" ? "crosshair" : "default" },
              "aria-label": `Detail ${view.detail.n} — ${view.detail.name}`,
            }}
          >
            {/* Hit targets: level lines, then runs, then tags and stubs on top. */}
            {shownLayout.levels.map((l) => (
              <g key={`lv-${l.id}`}>
                {sel?.kind === "level" && sel.id === l.id && <line x1={l.x1 * U} y1={l.y * U} x2={l.x2 * U} y2={l.y * U} stroke={accent} strokeWidth={2.5} />}
                <rect
                  x={l.x1 * U}
                  y={(l.y - 0.06) * U}
                  width={(l.x2 - l.x1) * U}
                  height={0.12 * U}
                  fill="transparent"
                  className="cr-hit"
                  tabIndex={0}
                  role="button"
                  aria-label={levelHitLabel(l.label)}
                  aria-pressed={sel?.kind === "level" && sel.id === l.id}
                  style={{ cursor: canDrag ? "ns-resize" : "pointer" }}
                  onPointerDown={(e) => {
                    e.stopPropagation();
                    if (tool !== "select") return;
                    setSel({ kind: "level", id: l.id });
                    startDrag(e, "level", l.id);
                  }}
                  onKeyDown={onPress(() => {
                    if (tool === "select") setSel({ kind: "level", id: l.id });
                  })}
                >
                  <title>{canDrag ? `${l.label} — drag to move` : l.label}</title>
                </rect>
              </g>
            ))}
            {shownLayout.runs.map((r) => {
              const pts = r.path.map((p) => `${p.x * U},${p.y * U}`).join(" ");
              const on = sel?.kind === "run" && sel.id === r.runId;
              return (
                <g key={`run-${r.runId}`}>
                  {on && <polyline points={pts} fill="none" stroke={accent} strokeWidth={3} strokeLinejoin="round" />}
                  <polyline
                    points={pts}
                    fill="none"
                    stroke="transparent"
                    strokeWidth={0.12 * U}
                    className="cr-hit"
                    tabIndex={0}
                    role="button"
                    aria-label={runName(r.runId)}
                    aria-pressed={on}
                    style={{ pointerEvents: "stroke", cursor: canDrag ? "ew-resize" : "pointer" }}
                    onPointerDown={(e) => {
                      e.stopPropagation();
                      if (tool !== "select") return;
                      setSel({ kind: "run", id: r.runId });
                      startDrag(e, "run", r.runId);
                    }}
                    onKeyDown={onPress(() => {
                      if (tool === "select") setSel({ kind: "run", id: r.runId });
                    })}
                  >
                    <title>{phone ? "Conduit run" : "Conduit run — click to edit, drag sideways to move its lane"}</title>
                  </polyline>
                  {/* #328 B2: editor-only overfill flag beside the size label — the printed sheet and the DXF never draw it. */}
                  {(() => {
                    const vr = runById.get(r.runId);
                    const f = vr ? viewRunFill(vr) : null;
                    if (!vr || !isOverfilled(f)) return null;
                    const w = r.size.length * 0.112 * 0.56;
                    const x = r.sizeAnchor === "middle" ? r.sizeAt.x + w / 2 + 0.05 : r.sizeAt.x + w + 0.05;
                    return (
                      <text x={x * U} y={r.sizeAt.y * U} fontSize={0.13 * U} dominantBaseline="central" fill="#c47a00" fontWeight={700} pointerEvents="none" aria-hidden="true">
⚠
                      </text>
                    );
                  })()}
                </g>
              );
            })}
            {shownLayout.items.map((it) => (
              <g key={`it-${it.key}`}>
                {selItemKey === it.key && (
                  <rect x={(it.rect.x - 0.04) * U} y={(it.rect.y - 0.04) * U} width={(it.rect.w + 0.08) * U} height={(it.rect.h + 0.08) * U} fill="none" stroke={accent} strokeWidth={2} rx={3} />
                )}
                <rect
                  x={it.rect.x * U}
                  y={it.rect.y * U}
                  width={it.rect.w * U}
                  height={it.rect.h * U}
                  fill="transparent"
                  style={{ cursor: tool === "connect" ? "crosshair" : canDrag && it.kind !== "ref" ? "move" : "pointer" }}
                  onPointerDown={(e) => itemDown(it, e)}
                  // Another detail's end isn't a button here — only tags and stubs take focus.
                  {...(it.kind === "ref"
                    ? {}
                    : {
                        className: "cr-hit",
                        tabIndex: 0,
                        role: "button",
                        "aria-label": it.kind === "tag" ? tagHitLabel(itemLabel(it)) : stubHitLabel(itemLabel(it)),
                        "aria-pressed": selItemKey === it.key,
                        onKeyDown: onPress(() => void pressItem(it)),
                      })}
                >
                  <title>{it.kind === "ref" ? `${itemLabel(it)} (another detail)` : itemLabel(it)}</title>
                </rect>
              </g>
            ))}
          </ConduitRiserFigure>
        </div>

        <div className="pk-no-print">
          {sel?.kind === "tag" && selTag && (phone ? (
            <TagView device={selTag} powerTypes={doc.powerTypes} planHref={planHref} onClose={() => setSel(null)} />
          ) : (
            <TagPanel
              key={`tag-${selTag.id}-${JSON.stringify(selTag.tag)}`}
              device={selTag}
              overrides={props.tagOverrides[selTag.id]}
              powerTypes={doc.powerTypes}
              pinned={Object.prototype.hasOwnProperty.call(doc.tags, selTag.id)}
              planHref={planHref}
              busy={waiting}
              onSave={(p) => void saveTag(selTag.id, p)}
              onUnpin={() => void commitLayout({ op: "unpinTag", placementId: selTag.id })}
              onClose={() => setSel(null)}
            />
          ))}
          {sel?.kind === "run" && selRun && (phone ? (
            <RunView
              vr={selRun}
              aLabel={endLabel(selRun.a)}
              bLabel={endLabel(selRun.b)}
              wireTypes={props.wireTypes}
              defaults={doc.defaults}
              estimateOwned={props.estimateOwned}
              onClose={() => setSel(null)}
            />
          ) : (
            <RunPanel
              key={`run-${selRun.run.id}-${JSON.stringify(selRun.run)}`}
              vr={selRun}
              aLabel={endLabel(selRun.a)}
              bLabel={endLabel(selRun.b)}
              wireTypes={props.wireTypes}
              defaults={doc.defaults}
              estimateOwned={props.estimateOwned}
              busy={waiting}
              onSave={(v) => saveRun(selRun.run.id, v)}
              onRemove={() => mustOk(() => patchConduitRiserAction(projectId, optionId, { op: "removeRun", id: selRun.run.id })).then(() => setSel(null))}
              onClose={() => setSel(null)}
            />
          ))}
          {sel?.kind === "stub" && selStub && (phone ? (
            <StubView stub={selStub} onClose={() => setSel(null)} />
          ) : (
            <StubPanel
              key={`stub-${selStub.id}-${selStub.label}`}
              stub={selStub}
              busy={waiting}
              onRename={(label) => void patch({ op: "updateStub", id: selStub.id, label })}
              onRemove={() => mustOk(() => patchConduitRiserAction(projectId, optionId, { op: "removeStub", id: selStub.id })).then(() => setSel(null))}
              onClose={() => setSel(null)}
            />
          ))}
          {sel?.kind === "level" && selLevel && (phone ? (
            <LevelLineView label={selLevel.label} elevation={selLevel.elevation} onClose={() => setSel(null)} />
          ) : (
            <LevelLinePanel
              label={selLevel.label}
              moved={doc.levelY[detailId]?.[selLevel.id] !== undefined}
              busy={waiting}
              onReset={() => void commitLayout({ op: "moveLevel", detailId, levelId: selLevel.id, y: null })}
              onClose={() => setSel(null)}
            />
          ))}
          {!phone && sel?.kind === "newStub" && (
            <NewStubPanel
              busy={waiting}
              onAdd={async (label) => {
                if (await patch({ op: "addStub", label, detailId })) choose("select");
              }}
              onClose={() => choose("select")}
            />
          )}
          {!phone && sel?.kind === "pair" && (
            <PairPanel
              key={`pair-${JSON.stringify(sel.a)}-${JSON.stringify(sel.b)}`}
              aLabel={sel.aLabel}
              bLabel={sel.bLabel}
              canWire={pairCanWire}
              kind={pairKind}
              cables={props.cables}
              busy={waiting}
              onConduit={async () => {
                if (await patch({ op: "addConduitRun", a: sel.a, b: sel.b })) setSel(null);
              }}
              onWire={(partId, lengthFt) => {
                if (sel.a.kind === "placement" && sel.b.kind === "placement") void connectWithWire(sel.a.placementId, sel.b.placementId, partId, lengthFt);
              }}
              onClose={() => setSel(null)}
            />
          )}

          <SuggestionsPanel
            rows={props.suggestions}
            loose={props.loose}
            planHref={planHref}
            busy={waiting}
            readOnly={phone}
            onAccept={(keys) => void acceptKeys(keys)}
            onDismiss={(key) => void run(() => dismissSuggestionAction(projectId, optionId, key))}
          />
          {phone ? (
            <DetailView detail={view.detail} spaces={props.spaces} />
          ) : (
            <DetailPanel
              key={`detail-${JSON.stringify(view.detail)}`}
              detail={view.detail}
              spaces={props.spaces}
              detailCount={props.detailCount}
              busy={waiting}
              onSave={(v) => void patch({ op: "updateDetail", id: detailId, ...v })}
              onAdd={(name) => void patch({ op: "addDetail", name, allSpaces: false, spaceIds: [] })}
              onRemove={() => mustOk(() => patchConduitRiserAction(projectId, optionId, { op: "removeDetail", id: detailId }))}
            />
          )}
          {phone ? (
            <LevelsView levels={props.levels} />
          ) : (
            <LevelsPanel
              key={`levels-${JSON.stringify(props.levels)}`}
              levels={props.levels}
              busy={waiting}
              onSave={(rows) => void run(() => saveLevelsAction(projectId, rows))}
            />
          )}
          {phone ? (
            <PowerTypesView rows={doc.powerTypes} />
          ) : (
            <PowerTypesPanel key={`pt-${JSON.stringify(doc.powerTypes)}`} rows={doc.powerTypes} busy={waiting} onSave={(rows) => void patch({ op: "setPowerTypes", rows })} />
          )}
          {phone ? (
            <AlwaysShowView types={props.deviceTypes} selected={doc.alwaysShow} />
          ) : (
            <AlwaysShowPanel types={props.deviceTypes} selected={doc.alwaysShow} busy={waiting} onSave={(typeKeys) => void patch({ op: "setAlwaysShow", typeKeys })} />
          )}
          {phone ? (
            <DefaultsView defaults={doc.defaults} estimateOwned={props.estimateOwned} />
          ) : (
            <DefaultsPanel
              key={`def-${JSON.stringify(doc.defaults)}`}
              defaults={doc.defaults}
              estimateOwned={props.estimateOwned}
              busy={waiting}
              onSave={(v) => void patch({ op: "setDefaults", ...v })}
            />
          )}
          {phone ? (
            <NotesView notes={doc.notes} />
          ) : (
            <NotesPanel
              notes={doc.notes}
              busy={waiting}
              onAdd={(text) => patch({ op: "addNote", text })}
              onSave={(id, text) => void patch({ op: "updateNote", id, text })}
              onRemove={(id) => mustOk(() => patchConduitRiserAction(projectId, optionId, { op: "removeNote", id }))}
            />
          )}
          <WarningsPanel warnings={props.warnings} />
        </div>
      </div>
    </div>
  );
}
