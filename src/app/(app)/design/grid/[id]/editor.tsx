"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useCallback, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  type Calibration,
  calibrationScale,
  findCalibration,
  formatMeasure,
  MEASURE_UNITS,
  type MeasureUnit,
  type Point,
} from "@/lib/annotations";
import { bomBySpace, bomLines, bomTotals, type PartLite } from "@/lib/design/grid-bom";
import { polygonCentroid, spaceOf } from "@/lib/design/grid-geometry";
import type { GridPlacement, GridRevision, GridSpace } from "@/lib/stores/grid-projects";
import {
  addSheetAction,
  addSpaceAction,
  calibrateAction,
  clearCalAction,
  createDraftQuoteAction,
  placeDeviceAction,
  removePlacementAction,
} from "./actions";
import SpacesPanel from "./spaces-panel";
import RevisionsPanel from "./revisions-panel";

const PdfCanvas = dynamic(() => import("@/components/design/pdf-canvas"), { ssr: false });

/**
 * The Grid editor (D108) — device painting on plan sheets, in the markup
 * screen's idiom (D95/D96): document right, tools left, all geometry
 * normalized 0..1, inline entry instead of window.prompt (unavailable here).
 *
 * Painting = the count tool grown up: arm a catalog part in the palette,
 * click the plan to drop instances; the BOM groups and prices them live.
 */

const BTN: React.CSSProperties = {
  borderWidth: 1, borderStyle: "solid", borderColor: "#dfe2e8",
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
  borderWidth: 1, borderStyle: "solid", borderColor: "#dfe2e8",
  borderRadius: 7,
  padding: "5px 8px",
  fontSize: 12,
  fontFamily: "inherit",
  background: "#fff",
  color: "#16181d",
  width: "100%",
};

const PANEL: React.CSSProperties = {
  background: "#fff",
  border: "1px solid #edeff3",
  borderRadius: 10,
  padding: 12,
};

const PANEL_LABEL: React.CSSProperties = {
  fontSize: 10,
  fontWeight: 700,
  letterSpacing: ".06em",
  textTransform: "uppercase",
  color: "#9aa0ab",
  marginBottom: 7,
};

/** Stable marker color per category — device dots read as families on a plan. */
const MARK_COLORS = ["#3155a8", "#2e9e6b", "#d5342a", "#6b4fa1", "#e08b1f", "#0e7f8c", "#b0367c"];
function markerColor(category: string): string {
  let h = 0;
  for (let i = 0; i < category.length; i++) h = (h * 31 + category.charCodeAt(i)) | 0;
  return MARK_COLORS[Math.abs(h) % MARK_COLORS.length];
}

function moneyFmt(n: number): string {
  return "$" + Math.round(n).toLocaleString("en-US");
}

export type SheetLite = { id: string; name: string; mime: string; dataUrl: string };
export type ProjectLite = {
  id: string;
  name: string;
  customer: string;
  quoteId: string | null;
  placements: GridPlacement[];
  calibrations: Calibration[];
  spaces: GridSpace[];
  revisions: GridRevision[];
};

type Pending =
  | { kind: "calibrate"; a: Point; b: Point }
  | { kind: "space"; points: Point[] }
  | null;

export default function GridEditor({
  project,
  sheets,
  parts,
}: {
  project: ProjectLite;
  sheets: SheetLite[];
  parts: PartLite[];
}) {
  const router = useRouter();
  const [activeSheetId, setActiveSheetId] = useState(sheets[0]?.id || "");
  const sheet = sheets.find((s) => s.id === activeSheetId) || sheets[0];
  const isPdf = sheet?.mime === "application/pdf" || sheet?.name.toLowerCase().endsWith(".pdf");

  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(1);
  const [zoom, setZoom] = useState(1.25);
  const [size, setSize] = useState({ w: 900, h: 1200 });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("");
  const [armedPartId, setArmedPartId] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);

  const [calibrating, setCalibrating] = useState(false);
  const [calDraft, setCalDraft] = useState<Point[] | null>(null);
  const [pending, setPending] = useState<Pending>(null);
  const [entry, setEntry] = useState("");
  const [calUnit, setCalUnit] = useState<MeasureUnit>("ft");

  // Space drawing (D109): vertices accumulate on click; closing the loop
  // (click near the first corner) opens the inline name entry.
  const [spaceDrawing, setSpaceDrawing] = useState(false);
  const [spaceDraft, setSpaceDraft] = useState<Point[]>([]);
  const [selectedSpaceId, setSelectedSpaceId] = useState<string | null>(null);

  const wrapRef = useRef<HTMLDivElement | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const onLoaded = useCallback((n: number) => setPages(n), []);
  const onSize = useCallback((w: number, h: number) => setSize({ w, h }), []);

  /** Guarded: an image that reports no size yet must not poison the math
   *  with NaN — calibration would silently fail with a misleading error. */
  const aspect = size.w > 0 && size.h > 0 ? size.h / size.w : 1;
  const cal = sheet ? findCalibration(project.calibrations, sheet.id, page) : null;

  const partById = useMemo(() => new Map(parts.map((p) => [p.id, p])), [parts]);
  const categories = useMemo(
    () => [...new Set(parts.map((p) => p.category))].sort(),
    [parts]
  );
  const filteredParts = useMemo(() => {
    const q = search.trim().toLowerCase();
    return parts
      .filter((p) => (category ? p.category === category : true))
      .filter((p) => (q ? (p.sku + " " + p.desc).toLowerCase().includes(q) : true));
  }, [parts, search, category]);

  const sheetPlacements = useMemo(
    () => project.placements.filter((pl) => pl.sheetId === sheet?.id && pl.page === page),
    [project.placements, sheet?.id, page]
  );
  const pageSpaces = useMemo(
    () => (project.spaces || []).filter((s) => s.sheetId === sheet?.id && s.page === page),
    [project.spaces, sheet?.id, page]
  );

  const lines = useMemo(() => bomLines(project.placements, parts), [project.placements, parts]);
  const totals = useMemo(() => bomTotals(project.placements, parts), [project.placements, parts]);
  const spaceRollups = useMemo(
    () => bomBySpace(project.placements, parts, project.spaces || []),
    [project.placements, parts, project.spaces]
  );

  const armedPart = armedPartId ? partById.get(armedPartId) : null;
  const selectedPlacement = project.placements.find((pl) => pl.id === selected) || null;

  /** Null when the wrapper has no measurable size (sheet still loading, or
   *  the window is hidden): fabricating (0,0) instead would drop devices and
   *  space corners at the top-left, so callers must bail on null. */
  function toNorm(e: React.PointerEvent): Point | null {
    const r = wrapRef.current?.getBoundingClientRect();
    if (!r || r.width < 1 || r.height < 1) return null;
    return {
      x: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)),
      y: Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)),
    };
  }

  async function upload(file: File) {
    setErr(null);
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const fr = new FileReader();
      fr.onload = () => resolve(String(fr.result));
      fr.onerror = () => reject(new Error("Could not read that file."));
      fr.readAsDataURL(file);
    });
    setBusy(true);
    const r = await addSheetAction(project.id, {
      name: file.name,
      mime: file.type || "application/octet-stream",
      dataUrl,
    });
    setBusy(false);
    if (!r.ok) {
      setErr(r.error);
      return;
    }
    setActiveSheetId(r.sheetId);
    setPage(1);
    router.refresh();
  }

  function onDown(e: React.PointerEvent) {
    if (busy || pending || !sheet) return;
    const p = toNorm(e);
    if (!p) return;

    if (calibrating) {
      setCalDraft([p, p]);
      return;
    }

    if (spaceDrawing) {
      // Clicking back on the first corner (with ≥3 laid down) closes the loop.
      const first = spaceDraft[0];
      const closes =
        first &&
        spaceDraft.length >= 3 &&
        Math.abs(first.x - p.x) < 0.015 &&
        Math.abs(first.y - p.y) < 0.015 / (aspect || 1);
      if (closes) {
        setSpaceDrawing(false);
        setEntry("");
        setPending({ kind: "space", points: spaceDraft });
        return;
      }
      setSpaceDraft((prev) => [...prev, p]);
      return;
    }

    // Select an existing marker when the click lands on one.
    // Same on-screen radius on both axes: y is a fraction of height, so the
    // x-tolerance divides by the aspect to stay circular on tall pages.
    const hit = [...sheetPlacements]
      .reverse()
      .find((pl) => Math.abs(pl.x - p.x) < 0.012 && Math.abs(pl.y - p.y) < 0.012 / (aspect || 1));
    if (hit) {
      setSelected(hit.id === selected ? null : hit.id);
      setSelectedSpaceId(null);
      return;
    }
    setSelected(null);

    if (armedPart) {
      setErr(null);
      setBusy(true);
      placeDeviceAction(project.id, {
        sheetId: sheet.id,
        page,
        x: p.x,
        y: p.y,
        partId: armedPart.id,
      }).then((r) => {
        setBusy(false);
        if (!r.ok) setErr(r.error);
        else router.refresh();
      });
      return;
    }

    // Nothing armed: clicking inside a room selects it (smallest wins).
    const room = spaceOf({ sheetId: sheet.id, page, x: p.x, y: p.y }, pageSpaces);
    setSelectedSpaceId(room ? room.id : null);
  }

  function onMove(e: React.PointerEvent) {
    if (!calDraft) return;
    const p = toNorm(e);
    if (!p) return;
    setCalDraft((prev) => (prev ? [prev[0], p] : prev));
  }

  function onUp() {
    if (!calDraft) return;
    const [a, b] = [calDraft[0], calDraft[calDraft.length - 1]];
    setCalDraft(null);
    setCalibrating(false);
    if (Math.abs(a.x - b.x) < 0.005 && Math.abs(a.y - b.y) < 0.005) return;
    setEntry("");
    setPending({ kind: "calibrate", a, b });
  }

  async function confirmSpace() {
    if (!pending || pending.kind !== "space" || !sheet) return;
    const name = entry.trim();
    if (!name) {
      setErr("Name the space — 'Stage', 'House', 'Booth'…");
      return;
    }
    setBusy(true);
    const r = await addSpaceAction(project.id, {
      sheetId: sheet.id,
      page,
      name,
      points: pending.points,
    });
    setBusy(false);
    setPending(null);
    setSpaceDraft([]);
    setEntry("");
    if (!r.ok) setErr(r.error);
    else router.refresh();
  }

  async function confirmCalibration() {
    if (!pending || pending.kind !== "calibrate" || !sheet) return;
    const real = Number(entry);
    const scale = calibrationScale(pending.a, pending.b, aspect, real);
    if (!scale) {
      setErr("Enter the real length of that line as a positive number.");
      return;
    }
    setBusy(true);
    const r = await calibrateAction(project.id, {
      sheetId: sheet.id,
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
  }

  return (
    <div style={{ display: "grid", gap: 10 }}>
      {/* header */}
      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
        <Link href="/design/grid" style={{ ...BTN, textDecoration: "none" }}>
          ← The Grid
        </Link>
        <div style={{ fontSize: 13, fontWeight: 700, color: "#16181d" }}>
          {project.name}
          {project.customer ? (
            <span style={{ color: "#8c919c", fontWeight: 500 }}> · {project.customer}</span>
          ) : null}
        </div>
        {sheets.length > 0 && (
          <select
            value={sheet?.id || ""}
            onChange={(e) => {
              setActiveSheetId(e.target.value);
              setPage(1);
              setSelected(null);
              setPending(null);
              setSpaceDrawing(false);
              setSpaceDraft([]);
              setSelectedSpaceId(null);
            }}
            style={{ ...BTN, fontWeight: 500 }}
          >
            {sheets.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        )}
        <button style={BTN} disabled={busy} onClick={() => fileRef.current?.click()}>
          + Plan sheet
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="application/pdf,image/*"
          style={{ display: "none" }}
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = "";
            if (f) upload(f);
          }}
        />
        <span style={{ flex: 1 }} />
        <button style={BTN} onClick={() => setZoom((z) => Math.max(0.5, +(z - 0.25).toFixed(2)))}>−</button>
        <span style={{ fontSize: 12, color: "#5b616e", minWidth: 42, textAlign: "center" }}>
          {Math.round(zoom * 100)}%
        </span>
        <button style={BTN} onClick={() => setZoom((z) => Math.min(4, +(z + 0.25).toFixed(2)))}>+</button>
        {isPdf && pages > 1 && (
          <>
            <button style={BTN} disabled={page <= 1} onClick={() => { setPage((p) => p - 1); setSelected(null); setSelectedSpaceId(null); setSpaceDrawing(false); setSpaceDraft([]); }}>‹</button>
            <span style={{ fontSize: 12, color: "#5b616e" }}>{page} / {pages}</span>
            <button style={BTN} disabled={page >= pages} onClick={() => { setPage((p) => p + 1); setSelected(null); setSelectedSpaceId(null); setSpaceDrawing(false); setSpaceDraft([]); }}>›</button>
          </>
        )}
      </div>

      {err && (
        <div style={{ background: "#f9ece8", border: "1px solid #f0d6cd", borderRadius: 9, padding: "8px 11px", fontSize: 12.5, color: "#a0442b" }}>
          {err}
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "252px 1fr", gap: 12, alignItems: "start" }}>
        {/* sidebar */}
        <div style={{ display: "grid", gap: 12, position: "sticky", top: 12 }}>
          {/* device palette */}
          <div style={PANEL}>
            <div style={PANEL_LABEL}>Devices</div>
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search the catalog"
              style={INPUT}
            />
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              style={{ ...INPUT, marginTop: 6 }}
            >
              <option value="">All categories</option>
              {categories.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
            {armedPart ? (
              <div style={{ marginTop: 8, fontSize: 11.5, color: "#2e7d55", fontWeight: 600 }}>
                Painting: {armedPart.sku} — click the plan to place.{" "}
                <button
                  style={{ ...BTN, padding: "2px 7px", fontSize: 10.5, marginLeft: 2 }}
                  onClick={() => setArmedPartId(null)}
                >
                  Done
                </button>
              </div>
            ) : (
              <div style={{ marginTop: 8, fontSize: 11, color: "#8c919c" }}>
                Pick a part, then click the plan for each unit.
              </div>
            )}
            <div style={{ marginTop: 8, maxHeight: 300, overflowY: "auto", display: "grid", gap: 3 }}>
              {filteredParts.slice(0, 60).map((p) => {
                const on = p.id === armedPartId;
                return (
                  <button
                    key={p.id}
                    onClick={() => {
                      setArmedPartId(on ? null : p.id);
                      setSelected(null);
                      setSpaceDrawing(false);
                      setSpaceDraft([]);
                      setSelectedSpaceId(null);
                    }}
                    title={p.desc}
                    style={{
                      ...BTN,
                      textAlign: "left",
                      padding: "5px 8px",
                      fontWeight: 500,
                      display: "grid",
                      gap: 1,
                      background: on ? "#16181d" : "#fff",
                      color: on ? "#fff" : "#3d424e",
                      borderColor: on ? "#16181d" : "#dfe2e8",
                    }}
                  >
                    <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <span
                        style={{
                          width: 9, height: 9, borderRadius: "50%",
                          background: markerColor(p.category), flex: "0 0 auto",
                        }}
                      />
                      <strong style={{ fontSize: 11.5 }}>{p.sku}</strong>
                      <span style={{ marginLeft: "auto", fontSize: 11 }}>{moneyFmt(p.list)}</span>
                    </span>
                    <span style={{ fontSize: 10.5, color: on ? "#c9cdd6" : "#8c919c", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                      {p.desc}
                    </span>
                  </button>
                );
              })}
              {filteredParts.length > 60 && (
                <div style={{ fontSize: 10.5, color: "#9aa0ab", padding: "3px 2px" }}>
                  {filteredParts.length - 60} more — narrow the search.
                </div>
              )}
              {filteredParts.length === 0 && (
                <div style={{ fontSize: 11.5, color: "#9aa0ab", padding: "3px 2px" }}>
                  Nothing matches.
                </div>
              )}
            </div>
          </div>

          {/* scale */}
          <div style={PANEL}>
            <div style={PANEL_LABEL}>Scale</div>
            {!sheet ? (
              <div style={{ fontSize: 11.5, color: "#8c919c" }}>Upload a plan sheet first.</div>
            ) : cal ? (
              <>
                <div style={{ fontSize: 12, color: "#2e7d55", fontWeight: 600 }}>Calibrated</div>
                <div style={{ fontSize: 11.5, color: "#8c919c", marginTop: 2 }}>
                  Reference {formatMeasure(cal.refLength, cal.unit)} · {cal.by}
                </div>
                <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
                  <button
                    style={{ ...BTN, padding: "4px 8px", fontSize: 11 }}
                    onClick={() => { setCalibrating(true); setArmedPartId(null); setSelected(null); setSpaceDrawing(false); setSpaceDraft([]); }}
                  >
                    Recalibrate
                  </button>
                  <button
                    style={{ ...BTN, padding: "4px 8px", fontSize: 11, color: "#a0442b" }}
                    onClick={async () => {
                      await clearCalAction(project.id, sheet.id, page);
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
                  Not set for page {page}. Draw over a known dimension, then type its real length —
                  wire lengths and layouts stay correct at any zoom.
                </div>
                <button
                  style={{ ...BTN, width: "100%", background: calibrating ? "#16181d" : "#fff", color: calibrating ? "#fff" : "#3d424e", borderColor: calibrating ? "#16181d" : "#dfe2e8" }}
                  onClick={() => { setCalibrating(true); setArmedPartId(null); setSelected(null); setSpaceDrawing(false); setSpaceDraft([]); }}
                >
                  {calibrating ? "Draw the reference…" : "Calibrate this page"}
                </button>
              </>
            )}
          </div>

          {/* spaces (D109) */}
          <SpacesPanel
            projectId={project.id}
            pageSpaces={pageSpaces}
            rollups={spaceRollups}
            drawing={spaceDrawing}
            selectedSpaceId={selectedSpaceId}
            busy={busy}
            onStartDraw={() => {
              setSpaceDrawing(true);
              setSpaceDraft([]);
              setArmedPartId(null);
              setCalibrating(false);
              setSelected(null);
              setSelectedSpaceId(null);
              setPending(null);
            }}
            onCancelDraw={() => {
              setSpaceDrawing(false);
              setSpaceDraft([]);
            }}
            onSelect={(id) => {
              setSelectedSpaceId(id);
              setSelected(null);
            }}
            onChanged={() => router.refresh()}
            onError={(m) => setErr(m)}
          />

          {/* selected placement */}
          {selectedPlacement && (
            <div style={{ ...PANEL, background: "#fdf4e7", border: "1px solid #f0dcbb" }}>
              <div style={PANEL_LABEL}>Selected device</div>
              <div style={{ fontSize: 12, color: "#16181d", fontWeight: 600 }}>
                {selectedPlacement.partId}
              </div>
              <div style={{ fontSize: 11.5, color: "#5b616e", marginTop: 2 }}>
                {partById.get(selectedPlacement.partId)?.desc || "No longer in the catalog"}
              </div>
              <div style={{ fontSize: 11, color: "#8c919c", marginTop: 2 }}>
                by {selectedPlacement.by}
              </div>
              <button
                style={{ ...BTN, marginTop: 8, width: "100%", color: "#a0442b" }}
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  const r = await removePlacementAction(project.id, selectedPlacement.id);
                  setBusy(false);
                  setSelected(null);
                  if (!r.ok) setErr(r.error);
                  else router.refresh();
                }}
              >
                Remove device
              </button>
            </div>
          )}

          {/* BOM */}
          <div style={PANEL}>
            <div style={PANEL_LABEL}>Bill of materials</div>
            {lines.length === 0 ? (
              <div style={{ fontSize: 11.5, color: "#8c919c" }}>
                Paint devices onto the plan to build the BOM.
              </div>
            ) : (
              <div style={{ display: "grid", gap: 4 }}>
                {lines.map((l) => (
                  <div key={l.partId} style={{ display: "flex", gap: 6, fontSize: 12, alignItems: "baseline" }}>
                    <strong style={{ color: "#16181d", whiteSpace: "nowrap" }}>{l.qty}×</strong>
                    <span
                      style={{ color: "#3d424e", flex: 1, minWidth: 0, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}
                      title={`${l.partId} — ${l.desc}`}
                    >
                      {l.partId}
                    </span>
                    <span style={{ color: "#16181d", fontWeight: 600 }}>{moneyFmt(l.ext)}</span>
                  </div>
                ))}
                <div style={{ borderTop: "1px solid #edeff3", marginTop: 3, paddingTop: 5, display: "flex", justifyContent: "space-between", fontSize: 12.5 }}>
                  <span style={{ color: "#8c919c" }}>Total</span>
                  <strong>{moneyFmt(totals.value)}</strong>
                </div>
              </div>
            )}
            <button
              style={{
                ...BTN,
                marginTop: 10,
                width: "100%",
                background: "#16181d",
                color: "#fff",
                borderColor: "#16181d",
              }}
              disabled={busy || lines.length === 0}
              onClick={async () => {
                setErr(null);
                setBusy(true);
                const r = await createDraftQuoteAction(project.id);
                setBusy(false);
                if (!r.ok) setErr(r.error);
                else router.refresh();
              }}
            >
              {project.quoteId ? `Update draft quote ${project.quoteId}` : "Create draft quote"}
            </button>
            {project.quoteId && (
              <Link
                href="/quotes"
                style={{ display: "block", marginTop: 6, fontSize: 11.5, color: "var(--accent)", textAlign: "center" }}
              >
                View in Quotes →
              </Link>
            )}
          </div>

          {/* revisions (D109) */}
          <RevisionsPanel
            projectId={project.id}
            revisions={project.revisions}
            busy={busy}
            onChanged={() => router.refresh()}
            onError={(m) => setErr(m)}
          />
        </div>

        {/* document */}
        <div style={{ overflow: "auto", background: "#6d7076", padding: 18, borderRadius: 10, display: "flex", justifyContent: "center", minHeight: 420 }}>
          {!sheet ? (
            <div style={{ alignSelf: "center", color: "#e6e8ec", fontSize: 13.5, textAlign: "center", lineHeight: 1.6 }}>
              No plan sheets yet.
              <br />
              <button style={{ ...BTN, marginTop: 10 }} disabled={busy} onClick={() => fileRef.current?.click()}>
                Upload a PDF or image
              </button>
            </div>
          ) : (
            <div
              ref={wrapRef}
              onPointerDown={onDown}
              onPointerMove={onMove}
              onPointerUp={onUp}
              style={{
                position: "relative",
                lineHeight: 0,
                cursor: pending ? "default" : calibrating || armedPart || spaceDrawing ? "crosshair" : "default",
                touchAction: "none",
                background: "#fff",
                boxShadow: "0 2px 14px rgba(0,0,0,.28)",
              }}
            >
              {isPdf ? (
                <PdfCanvas dataUrl={sheet.dataUrl} page={page} zoom={zoom} onLoaded={onLoaded} onSize={onSize} />
              ) : (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={sheet.dataUrl}
                  alt={sheet.name}
                  // Intrinsic dimensions, not clientWidth: onLoad can fire
                  // before layout (and never fires for cached images), which
                  // left size at 0×0 and broke the calibration math. The
                  // callback ref covers already-complete images; aspect only
                  // needs the ratio, so natural units are exactly right.
                  // The functional update MUST return the same object when
                  // nothing changed — an inline ref runs on every commit, and
                  // unconditionally setting fresh state here is a render loop.
                  ref={(el) => {
                    if (el && el.complete && el.naturalWidth) {
                      const w = el.naturalWidth;
                      const h = el.naturalHeight;
                      setSize((s) => (s.w === w && s.h === h ? s : { w, h }));
                    }
                  }}
                  onLoad={(e) =>
                    setSize({
                      w: e.currentTarget.naturalWidth || e.currentTarget.clientWidth,
                      h: e.currentTarget.naturalHeight || e.currentTarget.clientHeight,
                    })
                  }
                  style={{ width: `${Math.round(900 * zoom)}px`, height: "auto", display: "block" }}
                />
              )}

              <svg
                width={size.w}
                height={size.h}
                viewBox={`0 0 ${size.w} ${size.h}`}
                style={{ position: "absolute", inset: 0, width: "100%", height: "100%", pointerEvents: "none" }}
              >
                {/* spaces render UNDER the device markers */}
                {pageSpaces.map((s) => {
                  const pts = s.points.map((p) => `${p.x * size.w},${p.y * size.h}`).join(" ");
                  const c = polygonCentroid(s.points);
                  const on = s.id === selectedSpaceId;
                  return (
                    <g key={s.id}>
                      <polygon
                        points={pts}
                        fill={s.color}
                        opacity={on ? 0.22 : 0.13}
                        stroke={s.color}
                        strokeWidth={on ? 2.5 : 1.5}
                        strokeOpacity={0.55}
                        strokeDasharray={on ? "6 4" : undefined}
                      />
                      <g>
                        <rect
                          x={c.x * size.w - s.name.length * 3.6 - 6}
                          y={c.y * size.h - 9}
                          width={s.name.length * 7.2 + 12}
                          height={18}
                          rx={5}
                          fill="#fff"
                          stroke={s.color}
                          strokeWidth={1}
                          opacity={0.92}
                        />
                        <text
                          x={c.x * size.w}
                          y={c.y * size.h + 4}
                          fill={s.color}
                          fontSize={11}
                          fontWeight={700}
                          textAnchor="middle"
                          style={{ fontFamily: "inherit" }}
                        >
                          {s.name}
                        </text>
                      </g>
                    </g>
                  );
                })}
                {/* space being drawn: open polyline + corner dots */}
                {spaceDraft.length > 0 && (
                  <g>
                    <polyline
                      points={spaceDraft.map((p) => `${p.x * size.w},${p.y * size.h}`).join(" ")}
                      fill="none"
                      stroke="#8a6d3b"
                      strokeWidth={2}
                      strokeDasharray="5 4"
                    />
                    {spaceDraft.map((p, i) => (
                      <circle
                        key={i}
                        cx={p.x * size.w}
                        cy={p.y * size.h}
                        r={i === 0 ? 7 : 4}
                        fill={i === 0 ? "#fff" : "#8a6d3b"}
                        stroke="#8a6d3b"
                        strokeWidth={2}
                      />
                    ))}
                  </g>
                )}
                {pending?.kind === "space" && (
                  <polygon
                    points={pending.points.map((p) => `${p.x * size.w},${p.y * size.h}`).join(" ")}
                    fill="#8a6d3b"
                    opacity={0.15}
                    stroke="#8a6d3b"
                    strokeWidth={2}
                  />
                )}
                {sheetPlacements.map((pl) => {
                  const part = partById.get(pl.partId);
                  const c = markerColor(part?.category || "");
                  const x = pl.x * size.w;
                  const y = pl.y * size.h;
                  const on = pl.id === selected;
                  return (
                    <g key={pl.id}>
                      <circle cx={x} cy={y} r={10} fill={c} opacity={0.92} />
                      <circle cx={x} cy={y} r={10} fill="none" stroke="#fff" strokeWidth={1.5} />
                      <rect x={x + 12} y={y - 8} width={Math.max(30, pl.partId.length * 6.4) + 8} height={16} rx={4} fill="#fff" stroke={c} strokeWidth={1} opacity={0.95} />
                      <text x={x + 16} y={y + 4} fill={c} fontSize={10.5} fontWeight={700} style={{ fontFamily: "inherit" }}>
                        {pl.partId}
                      </text>
                      {on && (
                        <circle cx={x} cy={y} r={15} fill="none" stroke="#16181d" strokeDasharray="4 3" strokeWidth={1.5} />
                      )}
                    </g>
                  );
                })}
                {calDraft && (
                  <line
                    x1={calDraft[0].x * size.w}
                    y1={calDraft[0].y * size.h}
                    x2={calDraft[calDraft.length - 1].x * size.w}
                    y2={calDraft[calDraft.length - 1].y * size.h}
                    stroke="#d5342a"
                    strokeWidth={2}
                    strokeLinecap="round"
                  />
                )}
              </svg>

              {/* inline entry — window.prompt is unavailable here */}
              {pending && (() => {
                const anchor =
                  pending.kind === "calibrate" ? pending.b : pending.points[pending.points.length - 1];
                const cancel = () => {
                  setPending(null);
                  setEntry("");
                  setSpaceDraft([]);
                };
                return (
                  <div
                    style={{
                      position: "absolute",
                      left: `${anchor.x * 100}%`,
                      top: `${anchor.y * 100}%`,
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
                      {pending.kind === "calibrate" ? "Reference length" : "Name this space"}
                    </div>
                    <div style={{ display: "flex", gap: 5 }}>
                      <input
                        value={entry}
                        onChange={(e) => setEntry(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            if (pending.kind === "calibrate") confirmCalibration();
                            else confirmSpace();
                          }
                          if (e.key === "Escape") cancel();
                        }}
                        placeholder={pending.kind === "calibrate" ? "e.g. 40" : "Stage, House, Booth…"}
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
                    <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
                      <button
                        style={{ ...BTN, flex: 1 }}
                        disabled={busy}
                        onClick={pending.kind === "calibrate" ? confirmCalibration : confirmSpace}
                      >
                        {pending.kind === "calibrate" ? "Set scale" : "Create space"}
                      </button>
                      <button style={BTN} onClick={cancel}>Cancel</button>
                    </div>
                  </div>
                );
              })()}
            </div>
          )}
        </div>
      </div>

      <div style={{ fontSize: 11.5, color: "#8c919c" }}>
        Arm a device and click the plan to place each unit · click a marker to select it ·
        click inside a space to select the room · the BOM prices every sheet in this
        design, not just the visible page.
      </div>
    </div>
  );
}
