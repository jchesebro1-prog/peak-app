"use client";

import type { CSSProperties } from "react";
import { ShapeSvg } from "@/components/cutsheets/shape-svg";
import { layoutView, MODAL_LAYOUT_BOX, trackLayoutSource } from "@/lib/curtain-cut-sheets/layout";
import { MAX_RUN_FT } from "@/lib/track-engine";
import { MAX_TRACK_SEGMENTS, pathErrors } from "@/lib/track-path";
import { seriesSticks, type TrackSeries } from "@/lib/track-series";
import { FIELD, LBL, NUMFIELD, segBtn } from "./est-ui";
import { trackConfigFromDraft } from "./track-bom";
import type { TrackSetter } from "./track-modal";
import { angleFromArcLength, arcLengthText, blankSegment, presetSegments, totalRunText, TRACK_PRESETS } from "./track-segment-draft";
import type { TrackDraft, TrackSegmentDraft } from "./types";

/**
 * #369 — a curved track's segment list: Straight / Arc rows in order, four
 * shape presets, the total run, and a live mini plan drawn with the cut
 * sheet's own layout shapes. Errors come from the engine (the modal lists them).
 */
const ROW: CSSProperties = { display: "grid", gridTemplateColumns: "20px 1.3fr 1fr 1fr 1fr 1.2fr auto", gap: 8, alignItems: "center", marginBottom: 6 };
const ICON: CSSProperties = { border: "1px solid #e4e7ec", background: "#fff", borderRadius: 6, width: 24, height: 24, fontSize: 11, color: "#5b616e", cursor: "pointer", padding: 0 };

export function TrackSegmentsEditor({ draft, current, onSet }: { draft: TrackDraft; current: TrackSeries | null; onSet: TrackSetter }) {
  const segs = draft.segments || [];
  const set = (next: TrackSegmentDraft[]) => onSet("segments", next);
  const patch = (i: number, p: Partial<TrackSegmentDraft>) => set(segs.map((s, k) => (k === i ? { ...s, ...p } : s)));
  const move = (i: number, by: -1 | 1) => {
    const j = i + by;
    if (j < 0 || j >= segs.length) return;
    const next = segs.slice();
    [next[i], next[j]] = [next[j], next[i]];
    set(next);
  };
  const runNow = Number(totalRunText(segs) || draft.run);
  const config = trackConfigFromDraft(draft);
  const clean =
    !!current &&
    !!config.path &&
    pathErrors(config.path, { name: current.name, curvedSectionFt: current.curvedSectionFt, minRadiusFt: current.minRadiusFt, hasSticks: seriesSticks(current).length > 0 }, MAX_RUN_FT).length === 0;
  const src = clean && current ? trackLayoutSource(config, current) : null;
  const view = src ? layoutView(src, { box: MODAL_LAYOUT_BOX, detail: "client" }) : null;

  return (
    <div style={{ marginBottom: 16 }}>
      <label style={LBL}>Shape presets</label>
      <div style={{ display: "flex", gap: 7, flexWrap: "wrap", marginBottom: 12 }}>
        {TRACK_PRESETS.map((p) => (
          <button key={p.id} type="button" style={segBtn(false)} onClick={() => set(presetSegments(p.id, runNow, current?.minRadiusFt))}>
            {p.label}
          </button>
        ))}
      </div>

      <label style={LBL}>Segments</label>
      {segs.map((s, i) => (
        <div key={i} style={ROW}>
          <span style={{ fontSize: 11, color: "#8c919c", fontFamily: "var(--font-mono)" }}>{i + 1}</span>
          <div style={{ display: "flex", gap: 4 }}>
            <button type="button" style={segBtn(s.kind === "straight")} onClick={() => patch(i, { kind: "straight" })}>
              Straight
            </button>
            <button type="button" style={segBtn(s.kind === "arc")} onClick={() => patch(i, { kind: "arc" })}>
              Arc
            </button>
          </div>
          {s.kind === "straight" ? (
            <>
              <input className="est-input est-field" value={s.length} onChange={(e) => patch(i, { length: e.target.value })} placeholder="Length ft" aria-label={`Segment ${i + 1} length (ft)`} style={NUMFIELD} />
              <span />
              <span />
              <span />
            </>
          ) : (
            <>
              <input className="est-input est-field" value={s.radius} onChange={(e) => patch(i, { radius: e.target.value })} placeholder={current?.minRadiusFt ? `R min ${current.minRadiusFt}` : "Radius ft"} aria-label={`Segment ${i + 1} radius (ft)`} style={NUMFIELD} />
              <input className="est-input est-field" value={s.angle} onChange={(e) => patch(i, { angle: e.target.value })} placeholder="Angle °" aria-label={`Segment ${i + 1} angle (degrees)`} style={NUMFIELD} />
              <input
                className="est-input est-field"
                value={arcLengthText(s)}
                onChange={(e) => patch(i, { angle: angleFromArcLength(e.target.value, s.radius) })}
                placeholder="Arc ft"
                title="Type an arc length to set the angle"
                aria-label={`Segment ${i + 1} arc length (ft)`}
                style={NUMFIELD}
              />
              <div style={{ display: "flex", gap: 4 }}>
                <button type="button" style={segBtn(s.turn === "left")} onClick={() => patch(i, { turn: "left" })}>
                  Left
                </button>
                <button type="button" style={segBtn(s.turn === "right")} onClick={() => patch(i, { turn: "right" })}>
                  Right
                </button>
              </div>
            </>
          )}
          <div style={{ display: "flex", gap: 3 }}>
            <button type="button" style={ICON} aria-label={`Move segment ${i + 1} up`} onClick={() => move(i, -1)} disabled={i === 0}>
              ↑
            </button>
            <button type="button" style={ICON} aria-label={`Move segment ${i + 1} down`} onClick={() => move(i, 1)} disabled={i === segs.length - 1}>
              ↓
            </button>
            <button type="button" style={ICON} aria-label={`Remove segment ${i + 1}`} onClick={() => set(segs.filter((_, k) => k !== i))}>
              ✕
            </button>
          </div>
        </div>
      ))}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 4 }}>
        <button type="button" style={segBtn(false)} disabled={segs.length >= MAX_TRACK_SEGMENTS} onClick={() => set([...segs, blankSegment(segs.length ? "straight" : "arc")])}>
          + Add segment
        </button>
        <span style={{ fontSize: 12, color: "#5b616e" }}>
          Total run <strong style={{ fontFamily: "var(--font-mono)" }}>{totalRunText(segs) ? `${totalRunText(segs)}′` : "—"}</strong>
        </span>
      </div>
      {view && (
        <div style={{ ...FIELD, marginTop: 10, padding: 6, background: "#fff" }}>
          <ShapeSvg idPrefix="track-modal-layout" shapes={view.shapes} viewBox={`0 0 ${MODAL_LAYOUT_BOX.wIn} ${MODAL_LAYOUT_BOX.hIn}`} hatch={0.05} style={{ width: "100%", height: "auto" }} title="Track layout preview" />
        </div>
      )}
    </div>
  );
}
