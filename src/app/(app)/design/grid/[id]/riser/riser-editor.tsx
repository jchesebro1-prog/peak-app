"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { RiserCanvas, RiserNotes, type RiserCanvasHandlers, type RiserSelection } from "@/components/drawing/riser-canvas";
import { RISER_H, RISER_W, marginSpaceRect, type RiserNodeBox, type RiserView } from "@/lib/design/grid-riser-doc";
import { addSpaceAction } from "../actions";
import { patchRiserAction, riserAddDevicesAction, riserRemoveDevicesAction, riserReplacePartAction, riserSetQtyAction } from "./actions";
import { DevicePanel, RowPanel, SpacePanel, type RiserPartOption } from "./riser-panels";

/**
 * The editable riser (#GDS, spec §4). The graph is derived server-side and
 * arrives as `view`; every edit goes through a server action, then
 * router.refresh() re-derives it. Only in-flight drag positions live here.
 */

export type RiserSheetLite = { id: string; name: string; mime: string; src: string };

type Tool = "select" | "device" | "space";
type Res = { ok: true } | { ok: false; error: string };
type Panel = { kind: "device"; nodeKey: string } | { kind: "row"; nodeKey: string; partId: string } | { kind: "space" } | null;
type Drag = { key: string; dx: number; dy: number; box: RiserNodeBox };

const TOOLS: Array<{ key: Tool; label: string; hint: string }> = [
  { key: "select", label: "Select", hint: "Drag a node by its header to move it; click a device row to edit or delete it." },
  { key: "device", label: "+ Device", hint: "Click a node to add devices — they land on the plan inside that space." },
  { key: "space", label: "Space", hint: "Adds a small room on the plan's lower margin — reshape it on the plan." },
];

export default function RiserEditor({
  projectId,
  optionId,
  view,
  devices,
  sheets,
  spaces,
}: {
  projectId: string;
  optionId: string;
  view: RiserView;
  devices: RiserPartOption[];
  sheets: RiserSheetLite[];
  spaces: Array<{ sheetId: string; page: number }>;
}) {
  const router = useRouter();
  const svgRef = useRef<SVGSVGElement | null>(null);
  const drag = useRef<Drag | null>(null);
  const [tool, setTool] = useState<Tool>("select");
  const [panel, setPanel] = useState<Panel>(null);
  const [liveBoxes, setLiveBoxes] = useState<Record<string, RiserNodeBox>>({});
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
    setErr(null);
  }

  function dropLive(key: string) {
    setLiveBoxes((b) => {
      const next = { ...b };
      delete next[key];
      return next;
    });
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

  const handlers: RiserCanvasHandlers = {
    onNodeDown: (key, e) => {
      if (busy) return;
      if (tool === "device") {
        setPanel({ kind: "device", nodeKey: key });
        return;
      }
      if (tool !== "select") return;
      const n = nodeByKey.get(key);
      const p = toUnit(e);
      if (!n || !p) return;
      const box = liveBoxes[key] || n.box;
      drag.current = { key, dx: p.x - box.x, dy: p.y - box.y, box };
      e.currentTarget.setPointerCapture(e.pointerId);
    },
    onRowClick: (key, partId) => {
      if (tool === "device") setPanel({ kind: "device", nodeKey: key });
      else if (tool === "select") setPanel({ kind: "row", nodeKey: key, partId });
    },
    onMove: (e) => {
      const d = drag.current;
      if (!d) return;
      const p = toUnit(e);
      if (!p) return;
      setLiveBoxes((b) => ({
        ...b,
        [d.key]: { ...d.box, x: Math.max(0, Math.min(1 - d.box.w, p.x - d.dx)), y: Math.max(0, p.y - d.dy) },
      }));
    },
    onUp: () => {
      const d = drag.current;
      drag.current = null;
      if (!d) return;
      const box = liveBoxes[d.key];
      if (!box) return;
      void run(() => patchRiserAction(projectId, optionId, { op: "moveNode", key: d.key, box })).then((ok) => {
        if (!ok) dropLive(d.key);
      });
    },
  };

  const rowGroup = panel?.kind === "row" ? nodeByKey.get(panel.nodeKey)?.groups.find((g) => g.partId === panel.partId) : undefined;
  const selected: RiserSelection =
    panel?.kind === "row" ? { row: { key: panel.nodeKey, partId: panel.partId } } : panel?.kind === "device" ? { nodeKey: panel.nodeKey } : null;

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
      </div>
      <div className="pk-card grid-riser-card" style={{ padding: 12 }}>
        {view.nodes.length === 0 && (
          <div className="pk-no-print" style={{ fontSize: 13, color: "#8c919c", marginBottom: 8 }}>
            No spaces yet — use Space to add one, or draw rooms on the plan.
          </div>
        )}
        <RiserCanvas view={view} boxes={liveBoxes} svgRef={svgRef} handlers={handlers} selected={selected} />
      </div>
      {view.notes.length > 0 && (
        <div className="pk-card" style={{ padding: "12px 16px", marginTop: 12, fontSize: 12.5 }}>
          <div style={{ fontWeight: 700, marginBottom: 6 }}>Riser notes</div>
          <RiserNotes notes={view.notes} />
        </div>
      )}
    </div>
  );
}
