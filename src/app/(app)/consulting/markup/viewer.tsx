"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useCallback, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  type Annotation,
  ANNOTATION_COLORS,
  type AnnotationTool,
  bounds,
  cloudPath,
  DEFAULT_COLOR,
  hitTest,
  isDragTool,
  polyPath,
  type Point,
  TOOL_LABEL,
} from "@/lib/annotations";
import {
  addAnnotationAction,
  commentOnAnnotationAction,
  deleteAnnotationAction,
} from "../actions";

const PdfCanvas = dynamic(() => import("./pdf-canvas"), { ssr: false });

/**
 * Markup viewer (D95) — PDF/image viewing with an SVG annotation layer.
 *
 * SVG rather than a second canvas: annotations stay crisp at any zoom, hit
 * testing is cheap, and each shape is a real element we can key by id.
 *
 * All geometry is stored NORMALIZED 0..1 (see lib/annotations.ts), so the
 * same markup lands identically at any zoom or screen size. Conversion to
 * pixels happens only at paint time, here.
 */

const TOOLS: AnnotationTool[] = ["rect", "ellipse", "arrow", "cloud", "freehand", "highlight", "text"];

const BTN: React.CSSProperties = {
  border: "1px solid #dfe2e8",
  background: "#fff",
  borderRadius: 7,
  padding: "5px 10px",
  fontSize: 12,
  fontWeight: 600,
  color: "#3d424e",
  cursor: "pointer",
  fontFamily: "inherit",
};

export type DocLite = { id: string; name: string; mime: string; dataUrl: string };

export default function MarkupViewer({
  engagementId,
  engagementName,
  phaseId,
  phaseName,
  docs,
  activeDocId,
  annotations,
  comments,
}: {
  engagementId: string;
  engagementName: string;
  phaseId: string;
  phaseName: string;
  docs: DocLite[];
  activeDocId: string;
  annotations: Annotation[];
  comments: Array<{ id: string; body: string; author: string; state: string }>;
}) {
  const router = useRouter();
  const doc = docs.find((d) => d.id === activeDocId) || docs[0];
  const isPdf = doc?.mime === "application/pdf" || doc?.name.toLowerCase().endsWith(".pdf");

  const [tool, setTool] = useState<AnnotationTool>("rect");
  const [color, setColor] = useState(DEFAULT_COLOR);
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(1);
  const [zoom, setZoom] = useState(1.25);
  const [size, setSize] = useState({ w: 900, h: 1200 });
  const [draft, setDraft] = useState<Point[] | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  const onLoaded = useCallback((n: number) => setPages(n), []);
  const onSize = useCallback((w: number, h: number) => setSize({ w, h }), []);

  const pageAnns = useMemo(
    () => annotations.filter((a) => a.docId === doc?.id && a.page === page),
    [annotations, doc?.id, page]
  );
  const commentById = useMemo(
    () => Object.fromEntries(comments.map((c) => [c.id, c])),
    [comments]
  );

  function toNorm(e: React.PointerEvent): Point {
    const r = wrapRef.current?.getBoundingClientRect();
    if (!r) return { x: 0, y: 0 };
    return {
      x: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)),
      y: Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)),
    };
  }

  async function commit(points: Point[]) {
    if (!doc) return;
    let text = "";
    if (tool === "text") {
      text = window.prompt("Text to place on the drawing:") || "";
      if (!text.trim()) return;
    }
    setBusy(true);
    const r = await addAnnotationAction(engagementId, phaseId, {
      docId: doc.id,
      page,
      tool,
      color,
      points,
      text,
    });
    setBusy(false);
    if (r.ok) router.refresh();
  }

  function onDown(e: React.PointerEvent) {
    if (busy) return;
    const p = toNorm(e);
    // Clicking an existing annotation selects it instead of starting a new one.
    const hit = [...pageAnns].reverse().find((a) => hitTest(a, p));
    if (hit && !e.shiftKey) {
      setSelected(hit.id === selected ? null : hit.id);
      return;
    }
    setSelected(null);
    (e.target as Element).setPointerCapture?.(e.pointerId);
    if (tool === "text") {
      commit([p]);
      return;
    }
    setDraft([p]);
  }

  function onMove(e: React.PointerEvent) {
    if (!draft) return;
    const p = toNorm(e);
    setDraft((prev) => {
      if (!prev) return prev;
      // Drag tools keep exactly two points; freehand/cloud accumulate a path.
      if (isDragTool(tool) || tool === "cloud") return [prev[0], p];
      return [...prev, p];
    });
  }

  function onUp() {
    if (!draft) return;
    const pts = draft;
    setDraft(null);
    const b = bounds(pts);
    // Ignore stray clicks — a 0-size shape is almost always a misclick.
    if (pts.length < 2 || (b.w < 0.005 && b.h < 0.005)) return;
    commit(pts);
  }

  const selectedAnn = pageAnns.find((a) => a.id === selected) || null;

  return (
    <div style={{ display: "grid", gap: 10 }}>
      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
        <Link href={`/consulting/${engagementId}?tab=phases`} style={{ ...BTN, textDecoration: "none" }}>
          ← {engagementName}
        </Link>
        <div style={{ fontSize: 13, fontWeight: 700, color: "#16181d" }}>
          {phaseName} · markup
        </div>
        <select
          value={doc?.id || ""}
          onChange={(e) => {
            setPage(1);
            setSelected(null);
            router.push(
              `/consulting/markup?eng=${engagementId}&phase=${phaseId}&doc=${e.target.value}`
            );
          }}
          style={{ ...BTN, fontWeight: 500 }}
        >
          {docs.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
        </select>
      </div>

      {/* toolbar */}
      <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap", padding: "8px 10px", background: "#fbfbfc", border: "1px solid #edeff3", borderRadius: 9 }}>
        {TOOLS.map((t) => (
          <button
            key={t}
            onClick={() => setTool(t)}
            style={{
              ...BTN,
              background: tool === t ? "#16181d" : "#fff",
              color: tool === t ? "#fff" : "#3d424e",
              borderColor: tool === t ? "#16181d" : "#dfe2e8",
            }}
          >
            {TOOL_LABEL[t]}
          </button>
        ))}
        <span style={{ width: 10 }} />
        {ANNOTATION_COLORS.map((c) => (
          <button
            key={c}
            onClick={() => setColor(c)}
            aria-label={`Colour ${c}`}
            style={{
              width: 22,
              height: 22,
              borderRadius: "50%",
              background: c,
              border: color === c ? "3px solid #16181d" : "1px solid #dfe2e8",
              cursor: "pointer",
            }}
          />
        ))}
        <span style={{ flex: 1 }} />
        <button style={BTN} onClick={() => setZoom((z) => Math.max(0.5, +(z - 0.25).toFixed(2)))}>
          −
        </button>
        <span style={{ fontSize: 12, color: "#5b616e", minWidth: 42, textAlign: "center" }}>
          {Math.round(zoom * 100)}%
        </span>
        <button style={BTN} onClick={() => setZoom((z) => Math.min(3, +(z + 0.25).toFixed(2)))}>
          +
        </button>
        {isPdf && pages > 1 && (
          <>
            <button style={BTN} disabled={page <= 1} onClick={() => { setPage((p) => Math.max(1, p - 1)); setSelected(null); }}>
              ‹
            </button>
            <span style={{ fontSize: 12, color: "#5b616e" }}>
              {page} / {pages}
            </span>
            <button style={BTN} disabled={page >= pages} onClick={() => { setPage((p) => Math.min(pages, p + 1)); setSelected(null); }}>
              ›
            </button>
          </>
        )}
      </div>

      {selectedAnn && (
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", padding: "8px 10px", background: "#fdf4e7", border: "1px solid #f0dcbb", borderRadius: 9, fontSize: 12.5 }}>
          <strong>{TOOL_LABEL[selectedAnn.tool]}</strong>
          <span style={{ color: "#8c919c" }}>by {selectedAnn.author}</span>
          {selectedAnn.commentId && commentById[selectedAnn.commentId] ? (
            <span style={{ color: "#5b616e" }}>
              💬 “{commentById[selectedAnn.commentId].body}” ({commentById[selectedAnn.commentId].state})
            </span>
          ) : (
            <button
              style={BTN}
              onClick={async () => {
                const body = window.prompt("What needs to change here?") || "";
                if (!body.trim()) return;
                const r = await commentOnAnnotationAction(engagementId, phaseId, selectedAnn.id, body);
                if (r.ok) router.refresh();
              }}
            >
              Raise a review comment
            </button>
          )}
          <span style={{ flex: 1 }} />
          <button
            style={{ ...BTN, color: "#a0442b" }}
            onClick={async () => {
              await deleteAnnotationAction(engagementId, phaseId, selectedAnn.id);
              setSelected(null);
              router.refresh();
            }}
          >
            Delete
          </button>
        </div>
      )}

      {/* document + annotation layer */}
      <div style={{ overflow: "auto", background: "#6d7076", padding: 18, borderRadius: 9, display: "flex", justifyContent: "center" }}>
        <div
          ref={wrapRef}
          onPointerDown={onDown}
          onPointerMove={onMove}
          onPointerUp={onUp}
          style={{
            position: "relative",
            lineHeight: 0,
            cursor: "crosshair",
            touchAction: "none",
            background: "#fff",
            boxShadow: "0 2px 14px rgba(0,0,0,.28)",
          }}
        >
          {!doc && <div style={{ padding: 24, fontSize: 13 }}>No documents on this phase yet.</div>}
          {doc && isPdf && (
            <PdfCanvas dataUrl={doc.dataUrl} page={page} zoom={zoom} onLoaded={onLoaded} onSize={onSize} />
          )}
          {doc && !isPdf && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={doc.dataUrl}
              alt={doc.name}
              onLoad={(e) => {
                const el = e.currentTarget;
                setSize({ w: el.clientWidth, h: el.clientHeight });
              }}
              style={{ width: `${Math.round(900 * zoom)}px`, height: "auto", display: "block" }}
            />
          )}

          <svg
            width={size.w}
            height={size.h}
            viewBox={`0 0 ${size.w} ${size.h}`}
            style={{ position: "absolute", inset: 0, width: "100%", height: "100%", pointerEvents: "none" }}
          >
            {pageAnns.map((a) => (
              <Shape key={a.id} a={a} w={size.w} h={size.h} selected={a.id === selected} hasComment={Boolean(a.commentId)} />
            ))}
            {draft && (
              <Shape
                a={{
                  id: "draft",
                  docId: "",
                  page,
                  tool,
                  color,
                  points: draft,
                  text: "",
                  author: "",
                  at: 0,
                  commentId: null,
                }}
                w={size.w}
                h={size.h}
                selected={false}
                hasComment={false}
              />
            )}
          </svg>
        </div>
      </div>

      <div style={{ fontSize: 11.5, color: "#8c919c" }}>
        Drag to draw · click a mark to select it · shift-drag to draw over an existing mark.
        Markup is stored against this document version — replacing the file makes an approval stale.
      </div>
    </div>
  );
}

/** One annotation rendered in pixel space. */
function Shape({
  a,
  w,
  h,
  selected,
  hasComment,
}: {
  a: Annotation;
  w: number;
  h: number;
  selected: boolean;
  hasComment: boolean;
}) {
  const b = bounds(a.points);
  const x = b.x * w;
  const y = b.y * h;
  const bw = b.w * w;
  const bh = b.h * h;
  const stroke = a.color;
  const sw = selected ? 3.5 : 2;
  const common = { stroke, strokeWidth: sw, fill: "none" as const };

  const body = (() => {
    switch (a.tool) {
      case "rect":
        return <rect x={x} y={y} width={bw} height={bh} {...common} />;
      case "ellipse":
        return <ellipse cx={x + bw / 2} cy={y + bh / 2} rx={bw / 2} ry={bh / 2} {...common} />;
      case "highlight":
        return <rect x={x} y={y} width={bw} height={bh} fill={stroke} opacity={0.28} />;
      case "arrow": {
        const [p0, p1] = [a.points[0], a.points[a.points.length - 1]];
        const x1 = p0.x * w;
        const y1 = p0.y * h;
        const x2 = p1.x * w;
        const y2 = p1.y * h;
        const ang = Math.atan2(y2 - y1, x2 - x1);
        const head = 12;
        return (
          <g>
            <line x1={x1} y1={y1} x2={x2} y2={y2} {...common} strokeLinecap="round" />
            <polygon
              points={[
                `${x2},${y2}`,
                `${x2 - head * Math.cos(ang - Math.PI / 7)},${y2 - head * Math.sin(ang - Math.PI / 7)}`,
                `${x2 - head * Math.cos(ang + Math.PI / 7)},${y2 - head * Math.sin(ang + Math.PI / 7)}`,
              ].join(" ")}
              fill={stroke}
            />
          </g>
        );
      }
      case "freehand":
        return <path d={polyPath(a.points, w, h)} {...common} strokeLinecap="round" strokeLinejoin="round" />;
      case "cloud":
        return <path d={cloudPath(a.points, w, h)} {...common} />;
      case "text":
        return (
          <text x={x} y={y} fill={stroke} fontSize={15} fontWeight={600} style={{ fontFamily: "inherit" }}>
            {a.text}
          </text>
        );
      default:
        return null;
    }
  })();

  return (
    <g>
      {body}
      {selected && (
        <rect
          x={x - 6}
          y={y - 6}
          width={bw + 12}
          height={bh + 12}
          fill="none"
          stroke="#16181d"
          strokeDasharray="4 3"
          strokeWidth={1}
        />
      )}
      {hasComment && (
        <circle cx={x + bw} cy={y} r={7} fill={stroke} stroke="#fff" strokeWidth={2} />
      )}
    </g>
  );
}
