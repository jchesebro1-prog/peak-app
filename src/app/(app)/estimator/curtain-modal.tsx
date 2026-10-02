"use client";

import { computeCurtain, fmt } from "./pricing";
import type { CurtainDraft, FabricOpt, TrackDraft, TrackPart } from "./types";
import { fabricRateLabel } from "@/lib/curtain-geom";
import type { TrackSeries } from "@/lib/track-series";
import { addBtnStyle, ConfigModal, FIELD, LBL, NUMFIELD, segBtn, Stat } from "./est-ui";
import { trackBom, trackConfigFromDraft } from "./track-bom";
import { TrackErrors, TrackFields, type TrackSetter } from "./track-modal";
import {
  ASSUMED_MOUNT,
  BOTTOM_FINISHES,
  BOTTOM_FINISH_SHORT,
  CURTAIN_MOUNT_TYPES,
  DEFAULT_BOTTOM_FINISH,
  DEFAULT_TOP_FINISH,
  MOUNT_KEY_LABELS,
  TOP_FINISHES,
  TOP_FINISH_SHORT,
  mountTypeForTrackMounting,
} from "@/lib/curtain-cut-sheets/vocab";

/**
 * Curtain configurator — name / fabric (a fabric part — #264 isFabricPart, priced by
 * sewn area × the fabric's $/sq ft × (1 + sewing %)) / qty / W / H / fullness / optional
 * Rose Brand cost override, with live fabric-area + cost + ext pricing in
 * the footer. Hang type and bottom finish no longer affect price (curtain
 * pricing rebuild) and have been dropped from this UI.
 *
 * #274: an **Add track** toggle carries the curtain's track in the same step
 * — the track configurator's fields, compact, pre-filled from the curtain
 * (track-bom.ts `curtainTrackPrefill`); adding pushes the curtain line then
 * its track line. A track with a blocking error blocks the add.
 *
 * #292: top finish, bottom finish and mount are back — for the cut sheets
 * only; none of them affects price. The mount is picked only when the curtain
 * has no track: with Add track on, or when editing a curtain whose track line
 * already exists (`linkedTrack`), the mount reads from the track's mounting
 * and Add track is hidden. `editing` turns the footer into Update curtain.
 */

const FULLNESS: [string, string][] = [
  ["Flat", "0"],
  ["50%", "50"],
  ["75%", "75"],
  ["100%", "100"],
];

export default function CurtainModal({
  secName,
  editing = false,
  draft,
  fabrics,
  sewingPct,
  margin,
  onSet,
  onAdd,
  onClose,
  track = null,
  trackSeries = [],
  trackParts = {},
  onToggleTrack,
  onSetTrack,
  linkedTrack = null,
}: {
  secName: string;
  editing?: boolean;
  draft: CurtainDraft;
  fabrics: FabricOpt[];
  /** #227 late: the sewing-labor adder % every curtain estimate carries (from the server). */
  sewingPct: number;
  /** Tier-seeded margin fraction (item 11, D87); undefined → legacy 38%. */
  margin?: number;
  onSet: (field: keyof CurtainDraft, val: string) => void;
  onAdd: () => void;
  onClose: () => void;
  /** #274: the curtain's track form — null while Add track is off. */
  track?: TrackDraft | null;
  trackSeries?: readonly TrackSeries[];
  trackParts?: Record<string, TrackPart>;
  onToggleTrack?: (on: boolean) => void;
  onSetTrack?: TrackSetter;
  /** #292: the linked track's mounting (e.g. "batten") when editing a curtain whose track line already exists. */
  linkedTrack?: string | null;
}) {
  const cc = computeCurtain(draft, fabrics, { sewingPct }, margin);
  const qty = Math.max(1, parseInt(draft.qty, 10) || 0);
  const trackSeriesRow = track ? trackSeries.find((s) => s.id === track.seriesId) || null : null;
  const tb = track ? trackBom(trackConfigFromDraft(track), trackSeriesRow, trackParts, margin) : null;
  const trackOk = !tb || (!tb.errors.length && tb.price > 0);
  const valid = (draft.name || "").trim().length > 0 && cc.priceEach > 0 && trackOk;

  return (
    <ConfigModal
      width={600}
      icon="⛶"
      iconSize={16}
      title={editing ? "Edit curtain" : "Configure curtain"}
      sub={
        editing ? (
          <>Updates this curtain in {secName} · re-priced in place at today&rsquo;s rates</>
        ) : (
          <>Adds to {secName}</>
        )
      }
      onClose={onClose}
      footerLeft={
        <>
          <Stat label="Fabric" value={cc.fabricArea > 0 ? Math.round(cc.fabricArea) + " sq ft" : "—"} />
          <Stat label="Cost / ea" value={cc.costEach > 0 ? fmt(cc.costEach) : "—"} color="#8c919c" />
          <Stat
            label="Price · ext"
            value={cc.priceEach > 0 ? fmt(cc.priceEach * qty) : "—"}
            size={14}
            weight={700}
          />
          {tb && <Stat label="Track" value={tb.price > 0 ? fmt(tb.price) : "—"} size={14} weight={700} />}
        </>
      }
      footerRight={
        <button type="button" onClick={onAdd} disabled={!valid} style={addBtnStyle(valid)}>
          {editing ? "Update curtain" : track ? "Add curtain + track" : "Add curtain"}
        </button>
      }
    >
      {/* name */}
      <div style={{ marginBottom: 16 }}>
        <label style={LBL}>Curtain name</label>
        <input
          className="est-field"
          value={draft.name}
          onChange={(e) => onSet("name", e.target.value)}
          placeholder="e.g. Main Grand Drape"
          style={FIELD}
        />
      </div>

      {/* fabric */}
      <div style={{ marginBottom: 16 }}>
        <label style={LBL}>
          Fabric{" "}
          <span style={{ color: "#c4c9d2", textTransform: "none", letterSpacing: 0, fontWeight: 500 }}>
            · from catalog
          </span>
        </label>
        <select
          className="est-field"
          value={draft.fabric}
          onChange={(e) => onSet("fabric", e.target.value)}
          style={{ ...FIELD, background: "#fff", cursor: "pointer" }}
        >
          {fabrics.map((f) => (
            <option key={f.sku} value={f.sku}>
              {f.name + "  ·  " + ((f.curtainAreaRate ?? 0) > 0 ? "cost " : "") + fabricRateLabel(f.curtainAreaRate)}
            </option>
          ))}
        </select>
      </div>

      {/* qty / width / height */}
      <div
        style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12, marginBottom: 16 }}
      >
        <div>
          <label style={LBL}>Quantity</label>
          <input
            className="est-input est-field"
            value={draft.qty}
            onChange={(e) => onSet("qty", e.target.value)}
            placeholder="1"
            style={NUMFIELD}
          />
        </div>
        <div>
          <label style={LBL}>Width (ft)</label>
          <input
            className="est-input est-field"
            value={draft.width}
            onChange={(e) => onSet("width", e.target.value)}
            placeholder="0"
            style={NUMFIELD}
          />
        </div>
        <div>
          <label style={LBL}>Height (ft)</label>
          <input
            className="est-input est-field"
            value={draft.height}
            onChange={(e) => onSet("height", e.target.value)}
            placeholder="0"
            style={NUMFIELD}
          />
        </div>
      </div>

      {/* fullness */}
      <div style={{ marginBottom: 16 }}>
        <label style={LBL}>Fullness</label>
        <div style={{ display: "flex", gap: 7 }}>
          {FULLNESS.map(([label, v]) => (
            <button
              type="button"
              key={v}
              onClick={() => onSet("fullness", v)}
              style={segBtn(draft.fullness === v)}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* #292: top / bottom finish — cut sheets only, never price */}
      <div style={{ marginBottom: 16 }}>
        <label style={LBL}>Top finish</label>
        <div style={{ display: "flex", gap: 7 }}>
          {TOP_FINISHES.map((v) => (
            <button type="button" key={v} onClick={() => onSet("topFinish", v)} style={segBtn((draft.topFinish || DEFAULT_TOP_FINISH) === v)}>
              {TOP_FINISH_SHORT[v]}
            </button>
          ))}
        </div>
      </div>
      <div style={{ marginBottom: 16 }}>
        <label style={LBL}>Bottom finish</label>
        <div style={{ display: "flex", gap: 7 }}>
          {BOTTOM_FINISHES.map((v) => (
            <button type="button" key={v} onClick={() => onSet("bottomFinish", v)} style={segBtn((draft.bottomFinish || DEFAULT_BOTTOM_FINISH) === v)}>
              {BOTTOM_FINISH_SHORT[v]}
            </button>
          ))}
        </div>
      </div>

      {/* #292: mount — from the track when there is one */}
      <div style={{ marginBottom: 16 }}>
        <label style={LBL}>Mount</label>
        {track || linkedTrack ? (
          <div style={{ fontSize: 12.5, color: "#5b616e" }}>
            {`Mount: from the track (${MOUNT_KEY_LABELS[mountTypeForTrackMounting(String(track ? track.mounting : linkedTrack))]})`}
          </div>
        ) : (
          <select
            className="est-field"
            value={draft.mountType || ASSUMED_MOUNT}
            onChange={(e) => onSet("mountType", e.target.value)}
            style={{ ...FIELD, background: "#fff", cursor: "pointer" }}
          >
            {CURTAIN_MOUNT_TYPES.map((t) => (
              <option key={t.id} value={t.id}>
                {t.label}
              </option>
            ))}
          </select>
        )}
      </div>

      {/* Rose Brand cost override */}
      <div style={{ marginBottom: 4 }}>
        <label style={LBL}>
          Rose Brand cost{" "}
          <span style={{ color: "#c4c9d2", textTransform: "none", letterSpacing: 0, fontWeight: 500 }}>
            · optional — replaces the make-it cost
          </span>
        </label>
        <input
          className="est-input est-field"
          value={draft.vendorCostOverride ?? ""}
          onChange={(e) => onSet("vendorCostOverride", e.target.value)}
          placeholder="e.g. 2080"
          style={NUMFIELD}
        />
      </div>

      {/* #274: Add track */}
      {onToggleTrack && onSetTrack && !linkedTrack && (
        <div style={{ marginTop: 18, paddingTop: 14, borderTop: "1px solid #ececf0" }}>
          <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, fontWeight: 600, color: "#3a3f4a", cursor: "pointer" }}>
            <input type="checkbox" checked={!!track} onChange={(e) => onToggleTrack(e.target.checked)} />
            Add track
            <span style={{ fontSize: 11.5, fontWeight: 500, color: "#aab0bb" }}>· adds a track line for this curtain, priced from the catalog</span>
          </label>
          {track && (
            <div style={{ marginTop: 12 }}>
              <TrackFields draft={track} series={trackSeries} onSet={onSetTrack} compact />
              {tb && tb.rows.length > 0 && !tb.errors.length && (
                <div style={{ marginTop: 10, fontSize: 11.5, color: "#8c919c" }}>
                  {tb.rows.length} parts · cost {fmt(tb.cost)} · price {fmt(tb.price)}
                </div>
              )}
              {/* No series at all: TrackFields already says to set one up. */}
              {tb && trackSeriesRow && track.run.trim() !== "" && <TrackErrors errors={tb.errors} />}
            </div>
          )}
        </div>
      )}
    </ConfigModal>
  );
}
