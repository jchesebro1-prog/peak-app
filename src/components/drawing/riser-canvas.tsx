import type { PointerEvent as ReactPointerEvent, Ref } from "react";
import { formatMeasure, type MeasureUnit } from "@/lib/annotations";
import { SymbolShape } from "@/components/design/symbol-shape";
import {
  NODE_HEAD,
  NODE_ROW,
  RISER_H,
  RISER_W,
  type EndAnchor,
  type RiserNodeBox,
  type RiserNote,
  type RiserView,
  type RiserViewNode,
} from "@/lib/design/grid-riser-doc";
import { bezierAt, placeChip, type Bezier, type Pt, type Rect } from "@/lib/design/drawing-labels";

/**
 * The riser, drawn (#209). One pure SVG renderer for the riser editor
 * (client, with handlers) and the drawing set's E-501 (server, no handlers):
 * nodes with device rows, wire routes (solid), RiserLinks (dash-dot, marked
 * "typed"), conduits (grey dashed annotation, never priced) and level lines.
 * Edge chips carry the cable's short code + length and are placed clear of
 * every node and each other (drawing-labels placeChip).
 * No "use client" — without handlers nothing on it is interactive.
 */

export type RiserCanvasHandlers = {
  onNodeDown?: (key: string, e: ReactPointerEvent<SVGGElement>) => void;
  onRowClick?: (key: string, partId: string) => void;
  onEdgeClick?: (id: string, kind: "route" | "link") => void;
  onConduitClick?: (id: string) => void;
  onLevelDown?: (id: string, e: ReactPointerEvent<SVGGElement>) => void;
  onBackgroundDown?: (e: ReactPointerEvent<SVGRectElement>) => void;
  onMove?: (e: ReactPointerEvent<SVGSVGElement>) => void;
  onUp?: (e: ReactPointerEvent<SVGSVGElement>) => void;
};

export type RiserSelection = {
  nodeKey?: string;
  row?: { key: string; partId: string };
  edgeId?: string;
  conduitId?: string;
  levelId?: string;
} | null;

type Anchor = { p: Pt; row: boolean; dir: 1 | -1 };
type Curve = { d: string; pts: Bezier; side?: 1 | -1 };

const r1 = (v: number) => Math.round(v * 10) / 10;
const fit = (s: string, max: number) => (s.length > max ? `${s.slice(0, Math.max(1, max - 1))}…` : s);
const pxBox = (b: RiserNodeBox) => ({ x: b.x * RISER_W, y: b.y * RISER_H, w: b.w * RISER_W, h: b.h * RISER_H });
const rowCenterY = (top: number, i: number) => top + NODE_HEAD + 6 + i * NODE_ROW + NODE_ROW / 2;
const CHIP_H = 16;
const chipW = (label: string) => label.length * 5.6 + 12;
/** Keeps chips on the canvas: left, right and top walls. */
const WALLS: Rect[] = [
  { x: -1e4, y: -1e4, w: 1e4, h: 3e4 },
  { x: RISER_W, y: -1e4, w: 1e4, h: 3e4 },
  { x: -1e4, y: -1e4, w: 3e4, h: 1e4 },
];

/** A device end sits on its row's left/right edge (whichever faces the other
 *  end); a space end sits on the node's bottom centre. */
function anchorAt(a: EndAnchor, node: RiserViewNode, box: RiserNodeBox, towardX: number): Anchor {
  const b = pxBox(box);
  if (a.partId) {
    const i = node.groups.findIndex((g) => g.partId === a.partId);
    if (i >= 0) {
      const right = towardX >= b.x + b.w / 2;
      return { p: { x: right ? b.x + b.w : b.x, y: rowCenterY(b.y, i) }, row: true, dir: right ? 1 : -1 };
    }
  }
  return { p: { x: b.x + b.w / 2, y: b.y + b.h }, row: false, dir: 1 };
}

function curve(a: Anchor, b: Anchor): Curve {
  const A = a.p;
  const B = b.p;
  const span = Math.max(40, Math.abs(B.x - A.x) / 2);
  // Both ends on one vertical edge: a loop out AWAY from the box (review I2).
  const loop = a.row && b.row && a.dir === b.dir && Math.abs(A.x - B.x) < 1;
  let c1: Pt = a.row ? { x: A.x + (loop ? a.dir * span : B.x >= A.x ? span : -span), y: A.y } : { x: A.x, y: A.y + 50 };
  let c2: Pt = b.row ? { x: B.x + (loop ? b.dir * span : A.x > B.x ? span : -span), y: B.y } : { x: B.x, y: B.y + 50 };
  if (loop && Math.abs(A.y - B.y) < 1) {
    c1 = { x: A.x + a.dir * 40, y: A.y - 24 };
    c2 = { x: A.x + a.dir * 40, y: A.y + 24 };
  }
  return {
    d: `M ${r1(A.x)} ${r1(A.y)} C ${r1(c1.x)} ${r1(c1.y)}, ${r1(c2.x)} ${r1(c2.y)}, ${r1(B.x)} ${r1(B.y)}`,
    pts: [A, c1, c2, B],
    ...(loop ? { side: a.dir } : {}),
  };
}

function Chip({ r, label, color, italic = false }: { r: Rect; label: string; color: string; italic?: boolean }) {
  return (
    <g>
      <rect x={r1(r.x)} y={r1(r.y)} width={r1(r.w)} height={r1(r.h)} rx={4} fill="#fff" stroke="#c4c9d2" strokeWidth={0.8} />
      <text x={r1(r.x + r.w / 2)} y={r1(r.y + r.h / 2 + 3.5)} fontSize={10} fontWeight={600} fill={color} textAnchor="middle" fontStyle={italic ? "italic" : undefined}>
        {label}
      </text>
    </g>
  );
}

type PlacedChip = { id: string; kind: "edge" | "conduit"; edgeKind?: "route" | "link"; r: Rect; label: string; color: string; italic: boolean };

export function RiserCanvas({
  view,
  boxes,
  levelYs,
  svgRef,
  handlers,
  selected = null,
  fill = false,
}: {
  view: RiserView;
  /** Live (dragging) node boxes that override the view's. */
  boxes?: Record<string, RiserNodeBox>;
  /** Live (dragging) level positions. */
  levelYs?: Record<string, number>;
  svgRef?: Ref<SVGSVGElement>;
  handlers?: RiserCanvasHandlers;
  selected?: RiserSelection;
  /** Fill the parent's height too (the E-501 drawing area). */
  fill?: boolean;
}) {
  const h: RiserCanvasHandlers = handlers || {};
  const interactive = Boolean(handlers);
  const pointer = interactive ? { cursor: "pointer" } : undefined;
  const nodeMap = new Map(view.nodes.map((n) => [n.key, n]));
  // A live (dragged) box keeps its position, but never a height shorter than
  // the node now needs — devices added after the drag must not clip.
  const boxOf = (n: RiserViewNode): RiserNodeBox => {
    const live = boxes?.[n.key];
    return live ? { ...live, h: Math.max(live.h, n.box.h) } : n.box;
  };
  const levelY = (id: string, y: number) => (levelYs?.[id] ?? y) * RISER_H;
  const connect = (from: EndAnchor, to: EndAnchor): Curve | null => {
    const nf = nodeMap.get(from.key);
    const nt = nodeMap.get(to.key);
    if (!nf || !nt) return null;
    const bf = pxBox(boxOf(nf));
    const bt = pxBox(boxOf(nt));
    return curve(anchorAt(from, nf, boxOf(nf), bt.x + bt.w / 2), anchorAt(to, nt, boxOf(nt), bf.x + bf.w / 2));
  };

  // Paths first, then nodes (their white fill masks any path under them),
  // then every chip on top — each placed clear of the node boxes and of the
  // chips before it (review I2). Priced edges claim spots before conduits.
  const edgeCurves = view.edges.map((e) => ({ e, k: connect(e.from, e.to) }));
  const conduitCurves = view.conduits.map((c) => ({ c, k: connect(c.from, c.to) }));
  const obstacles: Rect[] = [...WALLS, ...view.nodes.map((n) => {
    const b = pxBox(boxOf(n));
    return { x: b.x - 3, y: b.y - 3, w: b.w + 6, h: b.h + 6 };
  })];
  const chips: PlacedChip[] = [];
  const tags: Array<{ tag: string; label: string }> = [];
  const place = (id: string, kind: "edge" | "conduit", k: Curve, label: string, color: string, italic: boolean, edgeKind?: "route" | "link") => {
    let r = placeChip(k, chipW(label), CHIP_H, obstacles);
    let text = label;
    if (!r) {
      // Nowhere clear for the full chip: a short tag, spelled out in the key.
      text = `W${tags.length + 1}`;
      tags.push({ tag: text, label });
      const w = chipW(text);
      r = placeChip(k, w, CHIP_H, obstacles);
      if (!r) {
        const p = bezierAt(k.pts, 0.5);
        r = { x: p.x - w / 2, y: p.y - CHIP_H / 2, w, h: CHIP_H };
      }
    }
    obstacles.push(r);
    chips.push({ id, kind, edgeKind, r, label: text, color, italic });
  };
  for (const { e, k } of edgeCurves) {
    if (!k) continue;
    const len = e.lengthFt !== null ? formatMeasure(e.lengthFt, e.unit as MeasureUnit) : "unmeasured";
    place(e.id, "edge", k, `${fit(e.code || e.partId, 18)} · ${len}${e.kind === "link" ? " (typed)" : ""}`, "#3155a8", false, e.kind);
  }
  for (const { c, k } of conduitCurves) {
    if (k) place(c.id, "conduit", k, fit(c.label, 40), "#5b616e", true);
  }

  const bottom = Math.max(
    view.height - 24,
    ...view.nodes.map((n) => {
      const b = boxOf(n);
      return (b.y + b.h) * RISER_H;
    }),
    ...view.levels.map((l) => levelY(l.id, l.y)),
    ...chips.map((c) => c.r.y + c.r.h)
  );
  const keyTop = Math.ceil(bottom + 24);
  const KEY_LINE = 14;
  const H = Math.max(RISER_H, tags.length ? keyTop + 12 + tags.length * KEY_LINE + 8 : keyTop);
  const onEdge = (id: string, kind: "route" | "link") => (h.onEdgeClick ? () => h.onEdgeClick?.(id, kind) : undefined);
  const onConduit = (id: string) => (h.onConduitClick ? () => h.onConduitClick?.(id) : undefined);

  return (
    <svg
      ref={svgRef}
      viewBox={`0 0 ${RISER_W} ${H}`}
      width="100%"
      height={fill ? "100%" : undefined}
      preserveAspectRatio="xMidYMid meet"
      style={{ display: "block", touchAction: interactive ? "none" : undefined, userSelect: "none", fontFamily: "inherit" }}
      onPointerMove={h.onMove}
      onPointerUp={h.onUp}
      data-riser-canvas=""
    >
      <rect x={0} y={0} width={RISER_W} height={H} fill="#fff" onPointerDown={h.onBackgroundDown} />

      {view.levels.map((l) => {
        const y = levelY(l.id, l.y);
        const on = selected?.levelId === l.id;
        return (
          <g
            key={l.id}
            data-level={l.id}
            onPointerDown={h.onLevelDown ? (e) => h.onLevelDown?.(l.id, e) : undefined}
            style={interactive ? { cursor: "ns-resize" } : undefined}
          >
            {interactive && <rect x={0} y={r1(y - 7)} width={RISER_W} height={14} fill="transparent" />}
            <line x1={0} x2={RISER_W} y1={r1(y)} y2={r1(y)} stroke={on ? "#16181d" : "#5b616e"} strokeWidth={on ? 1.8 : 1.2} strokeDasharray="14 6" />
            <text x={6} y={r1(y - 5)} fontSize={10.5} fontWeight={700} fill="#5b616e">
              {`${l.label}${l.elevation ? ` · ${l.elevation}` : ""}`}
            </text>
          </g>
        );
      })}

      {conduitCurves.map(({ c, k }) => {
        if (!k) return null;
        const on = selected?.conduitId === c.id;
        return (
          <g key={c.id} data-conduit={c.id} onClick={onConduit(c.id)} style={pointer}>
            {interactive && <path d={k.d} fill="none" stroke="transparent" strokeWidth={12} />}
            <path d={k.d} fill="none" stroke="#8c919c" strokeWidth={on ? 2.4 : 1.5} strokeDasharray="8 5" />
          </g>
        );
      })}

      {edgeCurves.map(({ e, k }) => {
        if (!k) return null;
        const on = selected?.edgeId === e.id;
        return (
          <g key={e.id} data-edge={e.kind} onClick={onEdge(e.id, e.kind)} style={pointer}>
            {interactive && <path d={k.d} fill="none" stroke="transparent" strokeWidth={12} />}
            <path d={k.d} fill="none" stroke="#3155a8" strokeWidth={on ? 2.8 : 1.8} strokeDasharray={e.kind === "link" ? "10 3 2 3" : undefined} />
          </g>
        );
      })}

      {view.nodes.map((n) => {
        const b = pxBox(boxOf(n));
        const on = selected?.nodeKey === n.key;
        const maxChars = Math.max(6, Math.floor((b.w - 34) / 6));
        return (
          <g key={n.key} data-node={n.key}>
            <rect x={r1(b.x)} y={r1(b.y)} width={r1(b.w)} height={r1(b.h)} rx={8} fill="#fff" stroke={n.color} strokeWidth={on ? 2.6 : 1.5} />
            <g onPointerDown={h.onNodeDown ? (e) => h.onNodeDown?.(n.key, e) : undefined} style={interactive ? { cursor: "grab" } : undefined}>
              <rect x={r1(b.x)} y={r1(b.y)} width={r1(b.w)} height={NODE_HEAD} rx={8} fill={n.color} opacity={0.16} />
              <text x={r1(b.x + 10)} y={r1(b.y + 16)} fontSize={12} fontWeight={700} fill="#16181d">
                {fit(n.name, maxChars + 4)}
              </text>
            </g>
            {n.groups.length === 0 ? (
              <text x={r1(b.x + 12)} y={r1(rowCenterY(b.y, 0) + 4)} fontSize={10.5} fill="#9aa0ab">
                no devices
              </text>
            ) : (
              n.groups.map((g, i) => {
                const cy = rowCenterY(b.y, i);
                const rowOn = selected?.row?.key === n.key && selected.row.partId === g.partId;
                return (
                  <g key={g.partId} data-row={g.partId} onClick={h.onRowClick ? () => h.onRowClick?.(n.key, g.partId) : undefined} style={pointer}>
                    <rect x={r1(b.x + 4)} y={r1(cy - NODE_ROW / 2)} width={r1(b.w - 8)} height={NODE_ROW} rx={3} fill={rowOn ? "#eef3ff" : "transparent"} />
                    <SymbolShape iconId={g.iconId} x={r1(b.x + 16)} y={r1(cy)} w={12} h={12} color={g.color} />
                    <text x={r1(b.x + 28)} y={r1(cy + 4)} fontSize={11} fill="#3d424e">
                      {fit(`${g.qty}× ${g.desc}`, maxChars)}
                    </text>
                  </g>
                );
              })
            )}
          </g>
        );
      })}

      {chips.map((c) => (
        <g
          key={`chip-${c.id}`}
          data-chip={c.kind}
          onClick={c.kind === "edge" && c.edgeKind ? onEdge(c.id, c.edgeKind) : c.kind === "conduit" ? onConduit(c.id) : undefined}
          style={pointer}
        >
          <Chip r={c.r} label={c.label} color={c.color} italic={c.italic} />
        </g>
      ))}

      {tags.length > 0 && (
        <g data-wire-key="">
          <text x={6} y={keyTop + 4} fontSize={9.5} fontWeight={700} fill="#5b616e" letterSpacing={0.8}>
            WIRE KEY
          </text>
          {tags.map((t, i) => (
            <text key={t.tag} x={6} y={keyTop + 4 + (i + 1) * KEY_LINE} fontSize={10} fill="#3d424e">
              {`${t.tag}  ${t.label}`}
            </text>
          ))}
        </g>
      )}
    </svg>
  );
}

/** The numbered riser notes block (E-501 and the riser page's print). */
export function RiserNotes({ notes }: { notes: RiserNote[] }) {
  if (!notes.length) return null;
  return (
    <ol className="pk-riser-notes">
      {notes.map((n) => (
        <li key={n.id} value={n.n}>
          {/* Explicit numbers: Tailwind's preflight strips list markers. */}
          <span className="pk-dw-num">{`${n.n}.`}</span> {n.text}
        </li>
      ))}
    </ol>
  );
}
