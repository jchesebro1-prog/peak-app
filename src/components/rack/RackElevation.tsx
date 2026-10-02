"use client";
/**
 * #296 — the shared rack elevation (RK-4): controlled and presentational — no
 * fetching, no persistence. The Assembly Builder's rack sidebar mounts it now;
 * the Grid's enclosure view adopts it later.
 *
 * Each face panel is the static drawing from `elevationSvgFor` — the same
 * string the printed rack sheets use — under an interactive overlay
 * (`elevation-overlay.tsx`) with the same viewBox.
 */
import { useId, useMemo, useState } from "react";
import { rackGeometry } from "@/lib/rack/geometry";
import { elevationSvgFor } from "@/lib/rack/svg";
import { RACK_WIDTHS, type PlacementKind, type RackFace, type RackIssue, type RackLayout, type RackPartLookup, type RackWidthClass } from "@/lib/rack/types";
import { clientToDrawing, ElevationOverlay, targetAt, type RackTarget } from "./elevation-overlay";

export type { RackArmed } from "./elevation-overlay";

/** The picker's drag payload type: JSON `{ sku, ruHeight, width, kind, label }`. */
export const RACK_PART_MIME = "application/x-rack-part";
export type RackPartDrag = { sku: string; ruHeight: number; width: RackWidthClass; kind: PlacementKind; label?: string };

const KINDS: readonly PlacementKind[] = ["device", "shelf", "blank", "vent", "reserved"];

/** Read a picker drag payload; null when it isn't one. */
export function parseRackPartDrag(raw: string): RackPartDrag | null {
  try {
    const v = JSON.parse(raw) as Record<string, unknown>;
    if (!v || typeof v !== "object" || typeof v.sku !== "string") return null;
    const ruHeight = typeof v.ruHeight === "number" && Number.isFinite(v.ruHeight) && v.ruHeight > 0 ? v.ruHeight : 1;
    const width = typeof v.width === "string" && (RACK_WIDTHS as readonly string[]).includes(v.width) ? (v.width as RackWidthClass) : "full";
    const kind = typeof v.kind === "string" && KINDS.includes(v.kind as PlacementKind) ? (v.kind as PlacementKind) : "device";
    return { sku: v.sku, ruHeight, width, kind, ...(typeof v.label === "string" ? { label: v.label } : {}) };
  } catch {
    return null;
  }
}

export type RackElevationProps = {
  layout: RackLayout;
  lookup: RackPartLookup;
  face: RackFace | "both";
  mode: "edit" | "view";
  selection: string[];
  armed?: { sku: string; kind: PlacementKind; ruHeight: number; width: RackWidthClass; label?: string } | null;
  issues?: RackIssue[];
  onPlace?: (p: { ruStart: number; face: RackFace; lane: 0 | 1 | 2 }) => void; // armed click / drop from picker
  onMove?: (id: string, to: { ruStart: number; face: RackFace; lane: 0 | 1 | 2 }, copy: boolean) => void;
  onSelect?: (ids: string[]) => void;
  onMenu?: (id: string, at: { x: number; y: number }) => void;
  onKey?: (e: React.KeyboardEvent) => void;
  scale?: number; // px per inch, default 14
};

export function RackElevation(props: RackElevationProps) {
  const uid = useId();
  const faces: RackFace[] = props.face === "both" ? ["front", "rear"] : [props.face];
  return (
    <div
      tabIndex={0}
      role="group"
      aria-label={props.mode === "edit" ? "Rack elevation editor" : "Rack elevation"}
      onKeyDown={props.onKey}
      className="flex items-start gap-4 rounded outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
      style={{ color: "var(--ink)" }}
    >
      {faces.map((f) => (
        <FacePanel key={f} {...props} panelFace={f} idPrefix={`rk-${uid}-${f}`} caption={props.face === "both" ? (f === "front" ? "Front" : "Rear") : null} />
      ))}
    </div>
  );
}

function FacePanel(props: RackElevationProps & { panelFace: RackFace; idPrefix: string; caption: string | null }) {
  const { layout, lookup, panelFace: face, idPrefix, caption, mode, armed, onPlace } = props;
  const scale = props.scale ?? 14;
  const [hover, setHover] = useState<RackTarget | null>(null);
  // dangerouslySetInnerHTML is safe here: svg.ts is our own serializer and escapes every text and attribute value.
  const svg = useMemo(() => elevationSvgFor(layout, lookup, face, { idPrefix }), [layout, lookup, face, idPrefix]);
  const geom = useMemo(() => rackGeometry(layout, lookup, { face }), [layout, lookup, face]);
  const w = geom.viewBox.w * scale;
  const h = geom.viewBox.h * scale;
  const accepts = (e: React.DragEvent) => mode === "edit" && Array.from(e.dataTransfer.types).includes(RACK_PART_MIME);

  return (
    <figure className="m-0">
      {caption ? (
        <figcaption className="mb-1 text-xs font-semibold" style={{ color: "var(--muted)" }}>
          {caption}
        </figcaption>
      ) : null}
      <div
        style={{ position: "relative", width: w, height: h }}
        onDragOver={(e) => {
          if (!accepts(e)) return;
          e.preventDefault();
          e.dataTransfer.dropEffect = "copy";
          const pt = clientToDrawing(e.currentTarget, e.clientX, e.clientY, geom.viewBox);
          if (!pt || !armed) return; // the payload itself is only readable on drop; the parent arms on dragstart
          const t = targetAt(layout, pt, armed.ruHeight, armed.width);
          if (!hover || hover.ruStart !== t.ruStart || hover.lane !== t.lane) setHover(t);
        }}
        onDragLeave={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setHover(null);
        }}
        onDrop={(e) => {
          if (!accepts(e)) return;
          e.preventDefault();
          setHover(null);
          const part = parseRackPartDrag(e.dataTransfer.getData(RACK_PART_MIME));
          const pt = clientToDrawing(e.currentTarget, e.clientX, e.clientY, geom.viewBox);
          const dims = part ?? armed;
          if (!pt || !dims || !onPlace) return;
          onPlace({ ...targetAt(layout, pt, dims.ruHeight, dims.width), face });
        }}
      >
        <div aria-hidden="true" className="[&>svg]:block [&>svg]:h-full [&>svg]:w-full" style={{ width: w, height: h }} dangerouslySetInnerHTML={{ __html: svg }} />
        <ElevationOverlay
          layout={layout}
          lookup={lookup}
          face={face}
          mode={mode}
          selection={props.selection}
          armed={armed}
          issues={props.issues}
          slots={geom.slots}
          viewBox={geom.viewBox}
          scale={scale}
          hover={hover}
          onHover={setHover}
          onPlace={onPlace}
          onMove={props.onMove}
          onSelect={props.onSelect}
          onMenu={props.onMenu}
        />
      </div>
    </figure>
  );
}
