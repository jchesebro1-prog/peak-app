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
  type Calibration,
  calibrationScale,
  cloudPath,
  DEFAULT_COLOR,
  findCalibration,
  formatMeasure,
  hitTest,
  isDragTool,
  isPointTool,
  MEASURE_UNITS,
  measureLength,
  type MeasureUnit,
  pageDistance,
  polyPath,
  type Point,
  TOOL_ICON,
  TOOL_LABEL,
} from "@/lib/annotations";
import {
  addAnnotationAction,
  clearCalibrationAction,
  commentOnAnnotationAction,
  deleteAnnotationAction,
  setCalibrationAction,
} from "../actions";

const PdfCanvas = dynamic(() => import("@/components/design/pdf-canvas"), { ssr: false });

/**
 * Markup viewer (D95, reworked D96) — document on the right, tools in a
 * sidebar on the left.
 *
 * NOTE ON DIALOGS: this app runs in contexts where `window.prompt()` throws
 * ("prompt() is not supported"), which silently broke the text tool and the
 * comment flow. Every input here is inline UI for that reason — do not
 * reintroduce prompt/confirm anywhere in this module.
 *
 * All geometry is stored NORMALIZED 0..1 (see lib/annotations.ts); pixels
 * appear only at paint time. Measurements additionally scale y by the page
 * aspect so they are correct on non-square pages and identical at any zoom.
 */

const TOOLS: AnnotationTool[] = [
  "rect",
  "ellipse",
  "arrow",
  "cloud",
  "freehand",
  "highlight",
  "text",
  "measure",
  "count",
];

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

const INPUT: React.CSSProperties = {
  border: "1px solid #dfe2e8",
  borderRadius: 7,
  padding: "5px 8px",
  fontSize: 12,
  fontFamily: "inherit",
  background: "#fff",
  color: "#16181d",
  width: "100%",
};

const PANEL_LABEL: React.CSSProperties = {
  fontSize: 10,
  fontWeight: 700,
  letterSpacing: ".06em",
  textTransform: "uppercase",
  color: "#9aa0ab",
  marginBottom: 7,
};

export type DocLite = { id: string; name: string; mime: string; dataUrl: string };

/** What the canvas is waiting for the user to type, if anything. */
type Pending =
  | { kind: "text"; at: Point }
  | { kind: "count"; at: Point }
  | { kind: "calibrate"; a: Point; b: Point }
  | null;

export default function MarkupViewer({
  engagementId,
  engagementName,
  phaseId,
  phaseName,
  docs,
  activeDocId,
  annotations,
  calibrations,
  comments,
}: {
  engagementId: string;
  engagementName: string;
  phaseId: string;
  phaseName: string;
  docs: DocLite[];
  activeDocId: string;
  annotations: Annotation[];
  calibrations: Calibration[];
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
  const [err, setErr] = useState<string | null>(null);

  // Inline entry state (replaces the unavailable window.prompt).
  const [pending, setPending] = useState<Pending>(null);
  const [entry, setEntry] = useState("");
  const [calUnit, setCalUnit] = useState<MeasureUnit>("ft");
  const [countLabel, setCountLabel] = useState("Fixtures");
  const [commentDraft, setCommentDraft] = useState("");
  const [calibrating, setCalibrating] = useState(false);

  const wrapRef = useRef<HTMLDivElement | null>(null);
  const onLoaded = useCallback((n: number) => setPages(n), []);
  const onSize = useCallback((w: number, h: number) => setSize({ w, h }), []);

  /** Zoom-independent: canvas w/h ratio is a property of the page. */
  const aspect = size.h / size.w;
  const cal = doc ? findCalibration(calibrations, doc.id, page) : null;

  const pageAnns = useMemo(
    () => annotations.filter((a) => a.docId === doc?.id && a.page === page),
    [annotations, doc?.id, page]
  );
  const commentById = useMemo(
    () => Object.fromEntries(comments.map((c) => [c.id, c])),
    [comments]
  );

  /** Running totals for the count tool, across the whole document. */
  const countTotals = useMemo(() => {
    const totals = new Map<string, number>();
    for (const a of annotations) {
      if (a.tool !== "count" || a.docId !== doc?.id) continue;
      const key = a.text.trim() || "Unlabelled";
      totals.set(key, (totals.get(key) || 0) + 1);
    }
    return [...totals.entries()].sort((x, y) => y[1] - x[1]);
  }, [annotations, doc?.id]);

  function toNorm(e: React.PointerEvent): Point {
    const r = wrapRef.current?.getBoundingClientRect();
    if (!r) return { x: 0, y: 0 };
    return {
      x: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)),
      y: Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)),
    };
  }

  async function save(points: Point[], text: string) {
    if (!doc) return;
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
    if (!r.ok) {
      setErr(r.error);
      return;
    }
    router.refresh();
  }

  function onDown(e: React.PointerEvent) {
    if (busy || pending) return;
    const p = toNorm(e);
    const hit = [...pageAnns].reverse().find((a) => hitTest(a, p));
    if (hit && !e.shiftKey) {
      setSelected(hit.id === selected ? null : hit.id);
      return;
    }
    setSelected(null);
    setErr(null);
    if (isPointTool(tool)) {
      // Text and count need a value before they mean anything — ask inline.
      setEntry("");
      setPending(tool === "text" ? { kind: "text", at: p } : { kind: "count", at: p });
      return;
    }
    setDraft([p]);
  }

  function onMove(e: React.PointerEvent) {
    if (!draft) return;
    const p = toNorm(e);
    setDraft((prev) => {
      if (!prev) return prev;
      if (isDragTool(tool) || tool === "cloud") return [prev[0], p];
      return [...prev, p];
    });
  }

  function onUp() {
    if (!draft) return;
    const pts = draft;
    setDraft(null);
    const b = bounds(pts);
    if (pts.length < 2 || (b.w < 0.005 && b.h < 0.005)) return;
    if (calibrating) {
      setCalibrating(false);
      setEntry("");
      setPending({ kind: "calibrate", a: pts[0], b: pts[pts.length - 1] });
      return;
    }
    save(pts, "");
  }

  async function confirmPending() {
    if (!pending || !doc) return;
    if (pending.kind === "calibrate") {
      const real = Number(entry);
      const scale = calibrationScale(pending.a, pending.b, aspect, real);
      if (!scale) {
        setErr("Enter the real length of that line as a positive number.");
        return;
      }
      setBusy(true);
      const r = await setCalibrationAction(engagementId, phaseId, {
        docId: doc.id,
        page,
        scale,
        unit: calUnit,
        refLength: real,
      });
      setBusy(false);
      setPending(null);
      setEntry("");
      if (!r.ok) setErr(r.error);
      else router.refresh();
      return;
    }
    const value = pending.kind === "count" ? countLabel.trim() || "Unlabelled" : entry.trim();
    if (!value) {
      setErr(pending.kind === "text" ? "Type the text to place." : "Name what you're counting.");
      return;
    }
    const at = pending.at;
    setPending(null);
    setEntry("");
    await save([at], value);
  }

  const selectedAnn = pageAnns.find((a) => a.id === selected) || null;

  return (
    <div style={{ display: "grid", gap: 10 }}>
      {/* header */}
      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
        <Link href={`/design/engagements/${engagementId}?tab=phases`} style={{ ...BTN, textDecoration: "none" }}>
          ← {engagementName}
        </Link>
        <div style={{ fontSize: 13, fontWeight: 700, color: "#16181d" }}>{phaseName} · markup</div>
        <select
          value={doc?.id || ""}
          onChange={(e) => {
            setPage(1);
            setSelected(null);
            setPending(null);
            router.push(`/design/engagements/markup?eng=${engagementId}&phase=${phaseId}&doc=${e.target.value}`);
          }}
          style={{ ...BTN, fontWeight: 500 }}
        >
          {docs.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
        </select>
        <span style={{ flex: 1 }} />
        <button style={BTN} onClick={() => setZoom((z) => Math.max(0.5, +(z - 0.25).toFixed(2)))}>−</button>
        <span style={{ fontSize: 12, color: "#5b616e", minWidth: 42, textAlign: "center" }}>
          {Math.round(zoom * 100)}%
        </span>
        <button style={BTN} onClick={() => setZoom((z) => Math.min(4, +(z + 0.25).toFixed(2)))}>+</button>
        {isPdf && pages > 1 && (
          <>
            <button style={BTN} disabled={page <= 1} onClick={() => { setPage((p) => p - 1); setSelected(null); }}>‹</button>
            <span style={{ fontSize: 12, color: "#5b616e" }}>{page} / {pages}</span>
            <button style={BTN} disabled={page >= pages} onClick={() => { setPage((p) => p + 1); setSelected(null); }}>›</button>
          </>
        )}
      </div>

      {err && (
        <div style={{ background: "#f9ece8", border: "1px solid #f0d6cd", borderRadius: 9, padding: "8px 11px", fontSize: 12.5, color: "#a0442b" }}>
          {err}
        </div>
      )}

      {/* sidebar + document */}
      <div style={{ display: "grid", gridTemplateColumns: "216px 1fr", gap: 12, alignItems: "start" }}>
        <div style={{ display: "grid", gap: 12, position: "sticky", top: 12 }}>
          {/* tools */}
          <div style={{ background: "#fff", border: "1px solid #edeff3", borderRadius: 10, padding: 12 }}>
            <div style={PANEL_LABEL}>Tools</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 5 }}>
              {TOOLS.map((t) => {
                const on = tool === t && !calibrating;
                return (
                  <button
                    key={t}
                    onClick={() => { setTool(t); setCalibrating(false); setPending(null); }}
                    title={TOOL_LABEL[t]}
                    style={{
                      ...BTN,
                      display: "flex",
                      alignItems: "center",
                      gap: 5,
                      padding: "6px 7px",
                      fontSize: 11.5,
                      background: on ? "#16181d" : "#fff",
                      color: on ? "#fff" : "#3d424e",
                      borderColor: on ? "#16181d" : "#dfe2e8",
                    }}
                  >
                    <span style={{ fontSize: 13 }}>{TOOL_ICON[t]}</span>
                    {TOOL_LABEL[t]}
                  </button>
                );
              })}
            </div>
            <div style={{ ...PANEL_LABEL, marginTop: 12 }}>Colour</div>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {ANNOTATION_COLORS.map((c) => (
                <button
                  key={c}
                  onClick={() => setColor(c)}
                  aria-label={`Colour ${c}`}
                  style={{
                    width: 22, height: 22, borderRadius: "50%", background: c,
                    border: color === c ? "3px solid #16181d" : "1px solid #dfe2e8",
                    cursor: "pointer",
                  }}
                />
              ))}
            </div>
          </div>

          {/* scale */}
          <div style={{ background: "#fff", border: "1px solid #edeff3", borderRadius: 10, padding: 12 }}>
            <div style={PANEL_LABEL}>Scale</div>
            {cal ? (
              <>
                <div style={{ fontSize: 12, color: "#2e7d55", fontWeight: 600 }}>Calibrated</div>
                <div style={{ fontSize: 11.5, color: "#8c919c", marginTop: 2 }}>
                  Reference {formatMeasure(cal.refLength, cal.unit)} · {cal.by}
                </div>
                <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
                  <button
                    style={{ ...BTN, padding: "4px 8px", fontSize: 11 }}
                    onClick={() => { setCalibrating(true); setTool("measure"); setSelected(null); }}
                  >
                    Recalibrate
                  </button>
                  <button
                    style={{ ...BTN, padding: "4px 8px", fontSize: 11, color: "#a0442b" }}
                    onClick={async () => {
                      await clearCalibrationAction(engagementId, phaseId, doc.id, page);
                      router.refresh();
                    }}
                  >
                    Clear
                  </button>
                </div>
              </>
            ) : (
              <>
                <div style={{ fontSize: 11.5, color: "#8c919c", marginBottom: 8 }}>
                  Not set for page {page}. Draw over a known dimension, then type its real
                  length — measurements stay correct at any zoom.
                </div>
                <button
                  style={{ ...BTN, width: "100%", background: calibrating ? "#16181d" : "#fff", color: calibrating ? "#fff" : "#3d424e", borderColor: calibrating ? "#16181d" : "#dfe2e8" }}
                  onClick={() => { setCalibrating(true); setTool("measure"); setSelected(null); }}
                >
                  {calibrating ? "Draw the reference…" : "Calibrate this page"}
                </button>
              </>
            )}
          </div>

          {/* counts */}
          <div style={{ background: "#fff", border: "1px solid #edeff3", borderRadius: 10, padding: 12 }}>
            <div style={PANEL_LABEL}>Counts</div>
            <input
              value={countLabel}
              onChange={(e) => setCountLabel(e.target.value)}
              placeholder="What you're counting"
              style={INPUT}
            />
            <div style={{ fontSize: 11, color: "#8c919c", marginTop: 5 }}>
              Pick the Count tool, then click each one.
            </div>
            {countTotals.length > 0 && (
              <div style={{ marginTop: 10, display: "grid", gap: 4 }}>
                {countTotals.map(([label, n]) => (
                  <div key={label} style={{ display: "flex", justifyContent: "space-between", fontSize: 12 }}>
                    <span style={{ color: "#3d424e" }}>{label}</span>
                    <strong style={{ color: "#16181d" }}>{n}</strong>
                  </div>
                ))}
                <div style={{ borderTop: "1px solid #edeff3", marginTop: 3, paddingTop: 4, display: "flex", justifyContent: "space-between", fontSize: 12 }}>
                  <span style={{ color: "#8c919c" }}>Total</span>
                  <strong>{countTotals.reduce((a, [, n]) => a + n, 0)}</strong>
                </div>
              </div>
            )}
          </div>

          {/* selection */}
          {selectedAnn && (
            <div style={{ background: "#fdf4e7", border: "1px solid #f0dcbb", borderRadius: 10, padding: 12 }}>
              <div style={PANEL_LABEL}>Selected</div>
              <div style={{ fontSize: 12, color: "#16181d", fontWeight: 600 }}>
                {TOOL_LABEL[selectedAnn.tool]}
                {selectedAnn.text ? ` · ${selectedAnn.text}` : ""}
              </div>
              <div style={{ fontSize: 11, color: "#8c919c", marginTop: 2 }}>by {selectedAnn.author}</div>
              {selectedAnn.tool === "measure" && (
                <div style={{ fontSize: 12, marginTop: 4, color: "#3d424e" }}>
                  {cal
                    ? formatMeasure(measureLength(selectedAnn.points, aspect, cal) || 0, cal.unit)
                    : "Calibrate the page to read this"}
                </div>
              )}
              {selectedAnn.commentId && commentById[selectedAnn.commentId] ? (
                <div style={{ fontSize: 11.5, color: "#5b616e", marginTop: 6 }}>
                  💬 “{commentById[selectedAnn.commentId].body}” ({commentById[selectedAnn.commentId].state})
                </div>
              ) : (
                <div style={{ marginTop: 8 }}>
                  <textarea
                    value={commentDraft}
                    onChange={(e) => setCommentDraft(e.target.value)}
                    rows={2}
                    placeholder="What needs to change here?"
                    style={{ ...INPUT, resize: "vertical" }}
                  />
                  <button
                    style={{ ...BTN, marginTop: 5, width: "100%" }}
                    disabled={busy || !commentDraft.trim()}
                    onClick={async () => {
                      const r = await commentOnAnnotationAction(engagementId, phaseId, selectedAnn.id, commentDraft);
                      if (!r.ok) { setErr(r.error); return; }
                      setCommentDraft("");
                      router.refresh();
                    }}
                  >
                    Raise review comment
                  </button>
                </div>
              )}
              <button
                style={{ ...BTN, marginTop: 8, width: "100%", color: "#a0442b" }}
                onClick={async () => {
                  await deleteAnnotationAction(engagementId, phaseId, selectedAnn.id);
                  setSelected(null);
                  router.refresh();
                }}
              >
                Delete mark
              </button>
            </div>
          )}
        </div>

        {/* document */}
        <div style={{ overflow: "auto", background: "#6d7076", padding: 18, borderRadius: 10, display: "flex", justifyContent: "center", minHeight: 400 }}>
          <div
            ref={wrapRef}
            onPointerDown={onDown}
            onPointerMove={onMove}
            onPointerUp={onUp}
            style={{
              position: "relative",
              lineHeight: 0,
              cursor: pending ? "default" : "crosshair",
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
                onLoad={(e) => setSize({ w: e.currentTarget.clientWidth, h: e.currentTarget.clientHeight })}
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
                <Shape
                  key={a.id}
                  a={a}
                  w={size.w}
                  h={size.h}
                  selected={a.id === selected}
                  hasComment={Boolean(a.commentId)}
                  label={
                    a.tool === "measure" && cal
                      ? formatMeasure(measureLength(a.points, aspect, cal) || 0, cal.unit)
                      : ""
                  }
                />
              ))}
              {draft && (
                <Shape
                  a={{ id: "draft", docId: "", page, tool: calibrating ? "measure" : tool, color, points: draft, text: "", author: "", at: 0, commentId: null }}
                  w={size.w}
                  h={size.h}
                  selected={false}
                  hasComment={false}
                  label={
                    calibrating
                      ? "reference"
                      : tool === "measure" && cal
                        ? formatMeasure(measureLength(draft, aspect, cal) || 0, cal.unit)
                        : ""
                  }
                />
              )}
            </svg>

            {/* inline entry — window.prompt() is unavailable here */}
            {pending && (
              <div
                style={{
                  position: "absolute",
                  left: `${("at" in pending ? pending.at.x : pending.b.x) * 100}%`,
                  top: `${("at" in pending ? pending.at.y : pending.b.y) * 100}%`,
                  transform: "translate(6px, 6px)",
                  background: "#fff",
                  border: "1px solid #c4c9d2",
                  borderRadius: 9,
                  padding: 10,
                  boxShadow: "0 6px 20px rgba(0,0,0,.22)",
                  width: 232,
                  lineHeight: 1.4,
                  zIndex: 5,
                }}
                onPointerDown={(e) => e.stopPropagation()}
              >
                <div style={{ ...PANEL_LABEL, marginBottom: 6 }}>
                  {pending.kind === "text" ? "Text" : pending.kind === "count" ? "Count marker" : "Reference length"}
                </div>
                {pending.kind === "count" ? (
                  <input value={countLabel} onChange={(e) => setCountLabel(e.target.value)} style={INPUT} autoFocus />
                ) : (
                  <div style={{ display: "flex", gap: 5 }}>
                    <input
                      value={entry}
                      onChange={(e) => setEntry(e.target.value)}
                      onKeyDown={(e) => { if (e.key === "Enter") confirmPending(); if (e.key === "Escape") setPending(null); }}
                      placeholder={pending.kind === "calibrate" ? "e.g. 40" : "Text to place"}
                      inputMode={pending.kind === "calibrate" ? "decimal" : "text"}
                      style={INPUT}
                      autoFocus
                    />
                    {pending.kind === "calibrate" && (
                      <select value={calUnit} onChange={(e) => setCalUnit(e.target.value as MeasureUnit)} style={{ ...INPUT, width: 66 }}>
                        {MEASURE_UNITS.map((u) => (
                          <option key={u} value={u}>{u}</option>
                        ))}
                      </select>
                    )}
                  </div>
                )}
                <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
                  <button style={{ ...BTN, flex: 1 }} disabled={busy} onClick={confirmPending}>
                    {pending.kind === "calibrate" ? "Set scale" : "Place"}
                  </button>
                  <button style={BTN} onClick={() => { setPending(null); setEntry(""); }}>Cancel</button>
                </div>
              </div>
            )}
          </div>
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
  label,
}: {
  a: Annotation;
  w: number;
  h: number;
  selected: boolean;
  hasComment: boolean;
  label: string;
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
      case "arrow":
      case "measure": {
        const p0 = a.points[0];
        const p1 = a.points[a.points.length - 1];
        const x1 = p0.x * w;
        const y1 = p0.y * h;
        const x2 = p1.x * w;
        const y2 = p1.y * h;
        const ang = Math.atan2(y2 - y1, x2 - x1);
        const head = 12;
        const tick = (px: number, py: number) => (
          <line
            x1={px + 6 * Math.sin(ang)} y1={py - 6 * Math.cos(ang)}
            x2={px - 6 * Math.sin(ang)} y2={py + 6 * Math.cos(ang)}
            {...common}
          />
        );
        return (
          <g>
            <line x1={x1} y1={y1} x2={x2} y2={y2} {...common} strokeLinecap="round" />
            {a.tool === "arrow" ? (
              <polygon
                points={[
                  `${x2},${y2}`,
                  `${x2 - head * Math.cos(ang - Math.PI / 7)},${y2 - head * Math.sin(ang - Math.PI / 7)}`,
                  `${x2 - head * Math.cos(ang + Math.PI / 7)},${y2 - head * Math.sin(ang + Math.PI / 7)}`,
                ].join(" ")}
                fill={stroke}
              />
            ) : (
              <>{tick(x1, y1)}{tick(x2, y2)}</>
            )}
          </g>
        );
      }
      case "freehand":
        return <path d={polyPath(a.points, w, h)} {...common} strokeLinecap="round" strokeLinejoin="round" />;
      case "cloud":
        return <path d={cloudPath(a.points, w, h)} {...common} />;
      case "count":
        return (
          <g>
            <circle cx={x} cy={y} r={11} fill={stroke} opacity={0.9} />
            <circle cx={x} cy={y} r={11} fill="none" stroke="#fff" strokeWidth={1.5} />
          </g>
        );
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

  // Measurement value sits on the line; count markers get no separate label.
  const showLabel = label && a.tool === "measure";
  const midX = a.points.length ? ((a.points[0].x + a.points[a.points.length - 1].x) / 2) * w : x;
  const midY = a.points.length ? ((a.points[0].y + a.points[a.points.length - 1].y) / 2) * h : y;

  return (
    <g>
      {body}
      {showLabel && (
        <g>
          <rect x={midX - 34} y={midY - 20} width={68} height={17} rx={4} fill="#fff" stroke={stroke} strokeWidth={1} />
          <text x={midX} y={midY - 8} fill={stroke} fontSize={11} fontWeight={700} textAnchor="middle" style={{ fontFamily: "inherit" }}>
            {label}
          </text>
        </g>
      )}
      {selected && (
        <rect x={x - 8} y={y - 8} width={Math.max(bw, 4) + 16} height={Math.max(bh, 4) + 16} fill="none" stroke="#16181d" strokeDasharray="4 3" strokeWidth={1} />
      )}
      {hasComment && <circle cx={x + bw} cy={y} r={7} fill={stroke} stroke="#fff" strokeWidth={2} />}
    </g>
  );
}
