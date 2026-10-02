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
import { parseRackPartDrag } from "@/lib/rack/drag";
import { rackGeometry } from "@/lib/rack/geometry";
import { elevationSvgFor } from "@/lib/rack/svg";
import type { PlacementKind, RackFace, RackIssue, RackLayout, RackPartLookup, RackWidthClass } from "@/lib/rack/types";
import { armedTarget, clientToDrawing, ElevationOverlay, type RackTarget } from "./elevation-overlay";

export type { RackArmed, RackDrop } from "./elevation-overlay";
export { parseRackPartDrag, type RackPartDrag } from "@/lib/rack/drag";

/** The picker's drag payload type: JSON `{ sku, ruHeight, width, kind, label }` (read with `parseRackPartDrag`). */
export const RACK_PART_MIME = "application/x-rack-part";

export type RackElevationProps = {
  layout: RackLayout;
  lookup: RackPartLookup;
  face: RackFace | "both";
  mode: "edit" | "view";
  selection: string[];
  armed?: { sku: string; kind: PlacementKind; ruHeight: number; width: RackWidthClass; label?: string } | null;
  issues?: RackIssue[];
  /** Armed click / drop from the picker. `shelfId`: a device dropped on a shelf (`ruStart` is the shelf's) — place it with that shelfId. */
  onPlace?: (p: { ruStart: number; face: RackFace; lane: 0 | 1 | 2; shelfId?: string }) => void;
  /** A drag ended. `shelfId` set = onto that shelf; absent = top-level (off a shelf if it was on one). Commit with `reparent`, or `place` for a copy. */
  onMove?: (id: string, to: { ruStart: number; face: RackFace; lane: 0 | 1 | 2; shelfId?: string }, copy: boolean) => void;
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
      data-rack-elevation=""
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
  // A layout change (a placement, an undo…) makes the hover ghost's probe stale: drop it until the pointer moves again.
  const [hoverLayout, setHoverLayout] = useState(layout);
  if (hoverLayout !== layout) {
    setHoverLayout(layout);
    if (hover) setHover(null);
  }
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
          const t = armedTarget(layout, geom.slots, pt, armed);
          if (!hover || hover.ruStart !== t.ruStart || hover.lane !== t.lane || hover.shelfId !== t.shelfId) setHover(t);
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
          onPlace({ ...armedTarget(layout, geom.slots, pt, dims), face });
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
