"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { RiserCanvas, RiserNotes, type RiserCanvasHandlers, type RiserSelection } from "@/components/drawing/riser-canvas";
import { measureSheetAspect } from "@/components/design/sheet-aspect";
import { formatMeasure, type MeasureUnit } from "@/lib/annotations";
import {
  RISER_H,
  RISER_W,
  UNASSIGNED_KEY,
  connectKind,
  marginSpaceRect,
  type EndRef,
  type RiserNodeBox,
  type RiserOp,
  type RiserView,
} from "@/lib/design/grid-riser-doc";
import { addRouteAction, addSpaceAction, removeRouteAction } from "../actions";
import {
  addRiserLinkAction,
  patchRiserAction,
  riserAddDevicesAction,
  riserRemoveDevicesAction,
  riserReplacePartAction,
  riserSetQtyAction,
} from "./actions";
import {
  ConduitPanel,
  DevicePanel,
  EdgePanel,
  LevelPanel,
  NotesPanel,
  PairPanel,
  RowPanel,
  SpacePanel,
  type RiserPartOption,
} from "./riser-panels";

/**
 * The editable riser (#209, spec §4). The graph is derived server-side and
 * arrives as `view`; every edit goes through a server action, then
 * router.refresh() re-derives it. Only in-flight drags and the half-picked
 * Connect/Conduit end live here.
 */

export type RiserSheetLite = { id: string; name: string; mime: string; src: string };

type Tool = "select" | "device" | "connect" | "conduit" | "level" | "space" | "note";
type Res = { ok: true } | { ok: false; error: string };
type End = { ref: EndRef; label: string };
type Panel =
  | { kind: "device"; nodeKey: string }
  | { kind: "row"; nodeKey: string; partId: string }
  | { kind: "space" }
  | { kind: "pair"; tool: "connect" | "conduit"; from: EndRef; to: EndRef; fromLabel: string; toLabel: string }
  | { kind: "level"; y: number }
  | { kind: "levelEdit"; id: string }
  | { kind: "edge"; id: string; edgeKind: "route" | "link" }
  | { kind: "conduit"; id: string }
  | null;
type Drag = { kind: "node"; key: string; dx: number; dy: number; box: RiserNodeBox } | { kind: "level"; id: string };

const TOOLS: Array<{ key: Tool; label: string; hint: string }> = [
  { key: "select", label: "Select", hint: "Drag a node by its header or a level line to move it; click a device row, connection or conduit to edit it." },
  { key: "device", label: "+ Device", hint: "Click a node to add devices — they land on the plan inside that space." },
  { key: "connect", label: "Connect", hint: "Click a device row or a node header, then the other end, then pick the cable." },
  { key: "conduit", label: "Conduit", hint: "Click two ends to draw a conduit annotation — never priced." },
  { key: "level", label: "Level line", hint: "Click the canvas where the level line goes." },
  { key: "space", label: "Space", hint: "Adds a small room on the plan's lower margin — reshape it on the plan." },
  { key: "note", label: "Note", hint: "Type a numbered note below — notes print on the riser sheet." },
];

export default function RiserEditor({
  projectId,
  optionId,
  view,
  devices,
  cables,
  sheets,
  spaces,
  placements,
  calibrations,
}: {
  projectId: string;
  optionId: string;
  view: RiserView;
  devices: RiserPartOption[];
  cables: RiserPartOption[];
  sheets: RiserSheetLite[];
  spaces: Array<{ sheetId: string; page: number }>;
  placements: Array<{ id: string; sheetId: string; page: number; x: number; y: number }>;
  calibrations: Array<{ docId: string; page: number }>;
}) {
  const router = useRouter();
  const svgRef = useRef<SVGSVGElement | null>(null);
  const noteRef = useRef<HTMLInputElement | null>(null);
  const drag = useRef<Drag | null>(null);
  const [tool, setTool] = useState<Tool>("select");
  const [panel, setPanel] = useState<Panel>(null);
  const [first, setFirst] = useState<End | null>(null);
  const [liveBoxes, setLiveBoxes] = useState<Record<string, RiserNodeBox>>({});
  const [liveLevels, setLiveLevels] = useState<Record<string, number>>({});
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const nodeByKey = new Map(view.nodes.map((n) => [n.key, n]));

  async function run(fn: () => Promise<Res>): Promise<boolean> {
    setBusy(true);
    setErr(null);
    try {
      const r = await fn();
      if (!r.ok) {
        setErr(r.error);
        return false;
      }
      router.refresh();
      return true;
    } catch {
      setErr("Something went wrong — please try again.");
      return false;
    } finally {
      setBusy(false);
    }
  }

  /** For ConfirmButton: throws on { ok: false } so the button shows the error. */
  async function mustOk(fn: () => Promise<Res>): Promise<void> {
    const r = await fn();
    if (!r.ok) throw new Error(r.error);
    router.refresh();
  }

  const patch = (op: RiserOp) => run(() => patchRiserAction(projectId, optionId, op));

  function toUnit(e: { clientX: number; clientY: number }): { x: number; y: number } | null {
    const svg = svgRef.current;
    const m = svg?.getScreenCTM();
    if (!svg || !m) return null;
    const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(m.inverse());
    return { x: p.x / RISER_W, y: p.y / RISER_H };
  }

  function choose(t: Tool) {
    setTool(t);
    setPanel(t === "space" ? { kind: "space" } : null);
    setFirst(null);
    setErr(null);
    if (t === "note") noteRef.current?.focus();
  }

  function dropLive(key: string) {
    setLiveBoxes((b) => {
      const next = { ...b };
      delete next[key];
      return next;
    });
  }

  function dropLiveLevel(id: string) {
    setLiveLevels((l) => {
      const next = { ...l };
      delete next[id];
      return next;
    });
  }

  /** A device row → its oldest placement (a representative device end); a
   *  node header → the space itself. */
  function endOf(nodeKey: string, partId: string | null): End | null {
    const n = nodeByKey.get(nodeKey);
    if (!n) return null;
    if (!partId) return { ref: { kind: "space", spaceId: nodeKey === UNASSIGNED_KEY ? null : nodeKey }, label: n.name };
    const g = n.groups.find((x) => x.partId === partId);
    const id = g?.ids[0];
    return g && id ? { ref: { kind: "placement", placementId: id }, label: `${g.desc} (${n.name})` } : null;
  }

  function pick(nodeKey: string, partId: string | null) {
    const end = endOf(nodeKey, partId);
    if (!end) {
      setErr("That row has no device to connect.");
      return;
    }
    if (!first) {
      setFirst(end);
      return;
    }
    const sameEnd =
      first.ref.kind === end.ref.kind &&
      (first.ref.kind === "placement"
        ? first.ref.placementId === (end.ref as EndRef & { kind: "placement" }).placementId
        : first.ref.spaceId === (end.ref as EndRef & { kind: "space" }).spaceId);
    if (sameEnd) {
      setErr("Pick two different ends.");
      setFirst(null);
      return;
    }
    setPanel({ kind: "pair", tool: tool === "conduit" ? "conduit" : "connect", from: first.ref, to: end.ref, fromLabel: first.label, toLabel: end.label });
    setFirst(null);
  }

  async function saveRow(nodeKey: string, fromPartId: string, fromQty: number, partId: string, qty: number) {
    if (partId !== fromPartId && !(await run(() => riserReplacePartAction(projectId, { optionId, nodeKey, fromPartId, toPartId: partId })))) return;
    if (qty !== fromQty && !(await run(() => riserSetQtyAction(projectId, { optionId, nodeKey, partId, qty })))) return;
    setPanel(null);
  }

  async function addSpace(name: string, sheetId: string) {
    const count = spaces.filter((s) => s.sheetId === sheetId && s.page === 1).length;
    if (await run(() => addSpaceAction(projectId, { sheetId, page: 1, name, points: marginSpaceRect(count) }))) choose("select");
  }

  async function connect(from: EndRef, to: EndRef, partId: string, lengthFt: number | null) {
    if (connectKind(from, to, placements, calibrations) === "route" && from.kind === "placement" && to.kind === "placement") {
      const fromId = from.placementId;
      const toId = to.placementId;
      const a = placements.find((p) => p.id === fromId);
      const b = placements.find((p) => p.id === toId);
      const sheet = sheets.find((s) => s.id === a?.sheetId);
      if (!a || !b || !sheet) {
        setErr("Those devices are no longer on the plan — refresh the page.");
        return;
      }
      let aspect: number;
      try {
        aspect = await measureSheetAspect(sheet, a.page);
      } catch {
        setErr("Couldn't open the plan sheet to measure this run — try again.");
        return;
      }
      const ok = await run(() =>
        addRouteAction(projectId, {
          sheetId: a.sheetId,
          page: a.page,
          partId,
          points: [
            { x: a.x, y: a.y },
            { x: b.x, y: b.y },
          ],
          aspect,
          optionId,
          fromPlacementId: a.id,
          toPlacementId: b.id,
        })
      );
      if (ok) setPanel(null);
      return;
    }
    if (lengthFt === null) return;
    if (await run(() => addRiserLinkAction(projectId, { optionId, from, to, partId, lengthFt }))) setPanel(null);
  }

  const handlers: RiserCanvasHandlers = {
    onNodeDown: (key, e) => {
      if (busy) return;
      if (tool === "device") {
        setPanel({ kind: "device", nodeKey: key });
        return;
      }
      if (tool === "connect" || tool === "conduit") {
        pick(key, null);
        return;
      }
      if (tool !== "select") return;
      const n = nodeByKey.get(key);
      const p = toUnit(e);
      if (!n || !p) return;
      // A kept live box never shrinks below the node's current height (devices
      // added since the last drag grow n.box.h) — same rule as RiserCanvas.
      const live = liveBoxes[key];
      const box = live ? { ...live, h: Math.max(live.h, n.box.h) } : n.box;
      drag.current = { kind: "node", key, dx: p.x - box.x, dy: p.y - box.y, box };
      e.currentTarget.setPointerCapture(e.pointerId);
    },
    onRowClick: (key, partId) => {
      if (tool === "connect" || tool === "conduit") pick(key, partId);
      else if (tool === "device") setPanel({ kind: "device", nodeKey: key });
      else if (tool === "select") setPanel({ kind: "row", nodeKey: key, partId });
    },
    onEdgeClick: (id, kind) => {
      if (tool === "select") setPanel({ kind: "edge", id, edgeKind: kind });
    },
    onConduitClick: (id) => {
      if (tool === "select") setPanel({ kind: "conduit", id });
    },
    onLevelDown: (id, e) => {
      if (tool !== "select" || busy) return;
      setPanel({ kind: "levelEdit", id });
      drag.current = { kind: "level", id };
      e.currentTarget.setPointerCapture(e.pointerId);
    },
    onBackgroundDown: (e) => {
      if (tool !== "level") return;
      const p = toUnit(e);
      if (p) setPanel({ kind: "level", y: p.y });
    },
    onMove: (e) => {
      const d = drag.current;
      if (!d) return;
      const p = toUnit(e);
      if (!p) return;
      if (d.kind === "node") {
        setLiveBoxes((b) => ({
          ...b,
          [d.key]: { ...d.box, x: Math.max(0, Math.min(1 - d.box.w, p.x - d.dx)), y: Math.max(0, p.y - d.dy) },
        }));
      } else {
        setLiveLevels((l) => ({ ...l, [d.id]: Math.max(0, p.y) }));
      }
    },
    onUp: () => {
      const d = drag.current;
      drag.current = null;
      if (!d) return;
      if (d.kind === "node") {
        const box = liveBoxes[d.key];
        if (!box) return;
        void patch({ op: "moveNode", key: d.key, box }).then((ok) => {
          if (!ok) dropLive(d.key);
        });
        return;
      }
      const y = liveLevels[d.id];
      if (y === undefined) return;
      void patch({ op: "updateLevel", id: d.id, y }).then((ok) => {
        if (!ok) dropLiveLevel(d.id);
      });
    },
  };

  const rowGroup = panel?.kind === "row" ? nodeByKey.get(panel.nodeKey)?.groups.find((g) => g.partId === panel.partId) : undefined;
  const edge = panel?.kind === "edge" ? view.edges.find((e) => e.id === panel.id) : undefined;
  const conduit = panel?.kind === "conduit" ? view.conduits.find((c) => c.id === panel.id) : undefined;
  const level = panel?.kind === "levelEdit" ? view.levels.find((l) => l.id === panel.id) : undefined;
  const selected: RiserSelection =
    panel?.kind === "row"
      ? { row: { key: panel.nodeKey, partId: panel.partId } }
      : panel?.kind === "device"
        ? { nodeKey: panel.nodeKey }
        : panel?.kind === "edge"
          ? { edgeId: panel.id }
          : panel?.kind === "conduit"
            ? { conduitId: panel.id }
            : panel?.kind === "levelEdit"
              ? { levelId: panel.id }
              : first && first.ref.kind === "space"
                ? { nodeKey: first.ref.spaceId ?? UNASSIGNED_KEY }
                : null;

  return (
    <div>
      <div className="pk-no-print" style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 8 }}>
        {TOOLS.map((t) => (
          <button
            key={t.key}
            type="button"
            className={tool === t.key ? "pk-btn-accent" : "pk-btn-outline"}
            style={{ fontSize: 12 }}
            aria-pressed={tool === t.key}
            onClick={() => choose(t.key)}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div className="pk-no-print" style={{ fontSize: 12, color: "#8c919c", marginBottom: 10 }}>
        {TOOLS.find((t) => t.key === tool)?.hint}
        {first ? ` — from ${first.label}; now click the other end.` : ""}
      </div>
      {err && (
        <div className="pk-no-print" role="alert" style={{ fontSize: 12.5, color: "#b4543a", background: "#f9ece8", border: "1px solid #f0d6cd", borderRadius: 8, padding: "8px 12px", marginBottom: 10 }}>
          {err}
        </div>
      )}
      <div className="pk-no-print">
        {panel?.kind === "device" && (
          <DevicePanel
            key={`dev-${panel.nodeKey}`}
            nodeName={nodeByKey.get(panel.nodeKey)?.name || "Unassigned"}
            devices={devices}
            busy={busy}
            onCancel={() => setPanel(null)}
            onAdd={async (partId, qty) => {
              if (await run(() => riserAddDevicesAction(projectId, { optionId, nodeKey: panel.nodeKey, partId, qty }))) setPanel(null);
            }}
          />
        )}
        {panel?.kind === "row" && rowGroup && (
          <RowPanel
            key={`row-${panel.nodeKey}-${rowGroup.partId}-${rowGroup.qty}`}
            nodeName={nodeByKey.get(panel.nodeKey)?.name || "Unassigned"}
            partId={rowGroup.partId}
            desc={rowGroup.desc}
            qty={rowGroup.qty}
            devices={devices}
            busy={busy}
            onCancel={() => setPanel(null)}
            onSave={(partId, qty) => void saveRow(panel.nodeKey, rowGroup.partId, rowGroup.qty, partId, qty)}
            onDelete={() =>
              mustOk(() => riserRemoveDevicesAction(projectId, { optionId, nodeKey: panel.nodeKey, partId: rowGroup.partId })).then(() => setPanel(null))
            }
          />
        )}
        {panel?.kind === "space" && (
          <SpacePanel sheets={sheets} busy={busy} onCancel={() => choose("select")} onAdd={(name, sheetId) => void addSpace(name, sheetId)} />
        )}
        {panel?.kind === "pair" && (
          <PairPanel
            key={`pair-${JSON.stringify(panel.from)}-${JSON.stringify(panel.to)}`}
            tool={panel.tool}
            kind={connectKind(panel.from, panel.to, placements, calibrations)}
            fromLabel={panel.fromLabel}
            toLabel={panel.toLabel}
            cables={cables}
            busy={busy}
            onCancel={() => setPanel(null)}
            onConnect={(partId, lengthFt) => void connect(panel.from, panel.to, partId, lengthFt)}
            onConduit={async (label) => {
              if (await patch({ op: "addConduit", from: panel.from, to: panel.to, label })) setPanel(null);
            }}
          />
        )}
        {panel?.kind === "level" && (
          <LevelPanel
            key={`lvl-${panel.y}`}
            title="New level line"
            busy={busy}
            onCancel={() => setPanel(null)}
            onSave={async (label, elevation) => {
              if (await patch({ op: "addLevel", label, elevation, y: panel.y })) setPanel(null);
            }}
          />
        )}
        {panel?.kind === "levelEdit" && level && (
          <LevelPanel
            key={`lvle-${level.id}-${level.label}-${level.elevation || ""}`}
            title="Level line"
            initialLabel={level.label}
            initialElevation={level.elevation || ""}
            busy={busy}
            onCancel={() => setPanel(null)}
            onSave={(label, elevation) => void patch({ op: "updateLevel", id: level.id, label, elevation })}
            onDelete={() => mustOk(() => patchRiserAction(projectId, optionId, { op: "removeLevel", id: level.id })).then(() => setPanel(null))}
          />
        )}
        {panel?.kind === "edge" && edge && (
          <EdgePanel
            title={`${edge.desc} · ${edge.lengthFt !== null ? formatMeasure(edge.lengthFt, edge.unit as MeasureUnit) : "unmeasured"}`}
            detail={
              edge.kind === "route"
                ? "A wire run drawn on the plan — deleting it removes it from the plan and the BOM."
                : "A typed-length riser link — deleting it removes its footage from the BOM."
            }
            busy={busy}
            onCancel={() => setPanel(null)}
            onDelete={() =>
              mustOk(() => (edge.kind === "route" ? removeRouteAction(projectId, edge.id) : patchRiserAction(projectId, optionId, { op: "removeLink", id: edge.id }))).then(() =>
                setPanel(null)
              )
            }
          />
        )}
        {panel?.kind === "conduit" && conduit && (
          <ConduitPanel
            key={`cd-${conduit.id}-${conduit.label}`}
            label={conduit.label}
            busy={busy}
            onCancel={() => setPanel(null)}
            onSave={(label) => void patch({ op: "updateConduit", id: conduit.id, label })}
            onDelete={() => mustOk(() => patchRiserAction(projectId, optionId, { op: "removeConduit", id: conduit.id })).then(() => setPanel(null))}
          />
        )}
      </div>
      <div className="pk-card grid-riser-card" style={{ padding: 12 }}>
        {view.nodes.length === 0 && (
          <div className="pk-no-print" style={{ fontSize: 13, color: "#8c919c", marginBottom: 8 }}>
            No spaces yet — use Space to add one, or draw rooms on the plan.
          </div>
        )}
        <RiserCanvas view={view} boxes={liveBoxes} levelYs={liveLevels} svgRef={svgRef} handlers={handlers} selected={selected} />
      </div>
      <NotesPanel
        notes={view.notes}
        busy={busy}
        inputRef={noteRef}
        onAdd={(text) => patch({ op: "addNote", text })}
        onSave={(id, text) => void patch({ op: "updateNote", id, text })}
        onDelete={(id) => mustOk(() => patchRiserAction(projectId, optionId, { op: "removeNote", id }))}
      />
      {/* The notes print under the riser; the editable panel above does not. */}
      <style>{`.grid-riser-print-notes { display: none; } @media print { .grid-riser-print-notes { display: block; margin-top: 12px; font-size: 11pt; } }`}</style>
      <div className="grid-riser-print-notes">
        <RiserNotes notes={view.notes} />
      </div>
    </div>
  );
}
