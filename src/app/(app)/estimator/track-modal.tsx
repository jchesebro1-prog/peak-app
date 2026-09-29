"use client";

import Link from "next/link";
import type { CSSProperties } from "react";
import { fmt } from "./pricing";
import type { SpecItem, TrackDraft, TrackPart } from "./types";
import { TRACK_OPERATION_LABELS, isCordOperated, type TrackOperation, type TrackSeries } from "@/lib/track-series";
import {
  TRACK_SERIES_GONE,
  fmtFt,
  selectableTrackSeries,
  spacingDefaults,
  trackBom,
  trackConfigFromDraft,
  type TrackBom,
} from "./track-bom";
import { addBtnStyle, ConfigModal, FIELD, LBL, NUMFIELD, segBtn, Stat, useSwallowOpeningDoubleClick } from "./est-ui";

/**
 * #274 §4 — the track configurator: series (active only), operation,
 * straight/curved (+ radius), run, mounting, trim (cord-operated only), qty,
 * label, and a collapsed Spacing row pre-filled from the series. Live stats
 * and a parts table come from track-bom.ts — every part priced from the live
 * catalog, exactly as the catalog picker prices it. Any blocking error
 * (an unmapped role, a bad input) disables Add.
 *
 * Reopened from a track line (`editing`) it is **Update track**, which
 * replaces the line in place at today's catalog prices. A line whose series
 * was deleted opens read-only (`readOnly`), showing its saved parts.
 */

export type TrackSetter = (field: keyof TrackDraft, val: string | boolean) => void;

const OPERATIONS: TrackOperation[] = ["biparting", "oneway", "walkalong"];
const SUBTLE: CSSProperties = { color: "#c4c9d2", textTransform: "none", letterSpacing: 0, fontWeight: 500 };

/** The link every "set one up / map it" message points at. */
export const TRACK_SERIES_HREF = "/estimating-rules/track-series";

/** "No track series yet — set one up in Estimating Rules → Track series". */
export function NoTrackSeries() {
  return (
    <div role="note" style={{ padding: "10px 12px", borderRadius: 8, border: "1px solid #efe4c4", background: "#fffdf6", color: "#8a6d1f", fontSize: 12, lineHeight: 1.45 }}>
      No track series yet — set one up in{" "}
      <Link href={TRACK_SERIES_HREF} style={{ color: "var(--accent)", fontWeight: 600 }}>
        Estimating Rules → Track series
      </Link>
      .
    </div>
  );
}

/** Blocking errors, one per line. */
export function TrackErrors({ errors }: { errors: string[] }) {
  if (!errors.length) return null;
  return (
    <div role="alert" style={{ marginTop: 12, padding: "9px 12px", borderRadius: 8, border: "1px solid #f1d4cc", background: "#fdf6f4", color: "#b4543a", fontSize: 12, lineHeight: 1.5 }}>
      {errors.map((e) => (
        <div key={e}>{e}</div>
      ))}
    </div>
  );
}

/**
 * The track inputs — shared by this modal and the curtain modal's Add track
 * step (`compact`: two-column, no label field of its own heading). `series`
 * is every series; the select lists active ones plus the draft's own.
 */
export function TrackFields({
  draft,
  series,
  onSet,
  compact = false,
  disabled = false,
}: {
  draft: TrackDraft;
  series: readonly TrackSeries[];
  onSet: TrackSetter;
  compact?: boolean;
  disabled?: boolean;
}) {
  const options = selectableTrackSeries(series, draft.seriesId);
  const current = series.find((s) => s.id === draft.seriesId) || null;
  const cord = isCordOperated(draft.operation);
  const gap = compact ? 12 : 16;
  const spacing = spacingDefaults(current);
  const canCurve = !!current?.curvedSectionFt;

  if (!options.length && !current && !disabled) return <NoTrackSeries />;

  return (
    <fieldset disabled={disabled} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
      <div style={{ display: "grid", gridTemplateColumns: compact ? "1fr 1fr" : "1fr", gap: compact ? 12 : 0 }}>
        {/* series */}
        <div style={{ marginBottom: compact ? 0 : gap }}>
          <label style={LBL}>
            Series <span style={SUBTLE}>· Estimating Rules → Track series</span>
          </label>
          <select
            className="est-field"
            value={draft.seriesId}
            onChange={(e) => onSet("seriesId", e.target.value)}
            aria-label="Track series"
            style={{ ...FIELD, background: "#fff", cursor: "pointer" }}
          >
            {!current && <option value={draft.seriesId}>{disabled ? "Deleted series" : "Pick a series"}</option>}
            {options.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
                {s.manufacturer && !s.name.toLowerCase().includes(s.manufacturer.toLowerCase()) ? " · " + s.manufacturer : ""}
                {!s.active ? " (inactive)" : ""}
              </option>
            ))}
          </select>
        </div>

        {/* label */}
        <div style={{ marginBottom: compact ? 0 : gap }}>
          <label style={LBL}>
            Label <span style={SUBTLE}>· optional</span>
          </label>
          <input
            className="est-field"
            value={draft.label}
            onChange={(e) => onSet("label", e.target.value)}
            placeholder="e.g. Main drape track"
            aria-label="Track label"
            style={FIELD}
          />
        </div>
      </div>

      {/* operation */}
      <div style={{ marginTop: compact ? gap : 0, marginBottom: gap }}>
        <label style={LBL}>Operation</label>
        <div style={{ display: "flex", gap: 7 }}>
          {OPERATIONS.map((op) => (
            <button type="button" key={op} onClick={() => onSet("operation", op)} style={segBtn(draft.operation === op)}>
              {TRACK_OPERATION_LABELS[op]}
            </button>
          ))}
        </div>
      </div>

      {/* shape + mounting */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: gap }}>
        <div>
          <label style={LBL}>Shape</label>
          <div style={{ display: "flex", gap: 7 }}>
            <button type="button" onClick={() => onSet("curved", false)} style={segBtn(!draft.curved)}>
              Straight
            </button>
            <button
              type="button"
              onClick={() => onSet("curved", true)}
              title={current && !canCurve ? `${current.name} has no curved track` : undefined}
              style={segBtn(draft.curved)}
            >
              Curved
            </button>
          </div>
        </div>
        <div>
          <label style={LBL}>Mounting</label>
          <div style={{ display: "flex", gap: 7 }}>
            <button type="button" onClick={() => onSet("mounting", "batten")} style={segBtn(draft.mounting === "batten")}>
              Batten clamp
            </button>
            <button type="button" onClick={() => onSet("mounting", "ceiling")} style={segBtn(draft.mounting === "ceiling")}>
              Ceiling hanger
            </button>
          </div>
        </div>
      </div>

      {/* run / radius / trim / qty */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 12, marginBottom: gap }}>
        <div>
          <label style={LBL}>{draft.curved ? "Run · arc (ft)" : "Run (ft)"}</label>
          <input className="est-input est-field" value={draft.run} onChange={(e) => onSet("run", e.target.value)} placeholder="0" aria-label="Run length (ft)" style={NUMFIELD} />
        </div>
        <div>
          <label style={LBL}>Radius (ft)</label>
          <input
            className="est-input est-field"
            value={draft.curved ? draft.radius : ""}
            onChange={(e) => onSet("radius", e.target.value)}
            disabled={!draft.curved}
            placeholder={draft.curved ? (current?.minRadiusFt ? "min " + current.minRadiusFt : "0") : "—"}
            aria-label="Curve radius (ft)"
            style={{ ...NUMFIELD, background: draft.curved ? "#fff" : "#f7f8fa" }}
          />
        </div>
        <div>
          <label style={LBL}>Trim (ft)</label>
          <input
            className="est-input est-field"
            value={cord ? draft.trim : ""}
            onChange={(e) => onSet("trim", e.target.value)}
            disabled={!cord}
            placeholder={cord ? "20" : "—"}
            title="Pulley-to-floor drop — cord-operated track only"
            aria-label="Trim (ft)"
            style={{ ...NUMFIELD, background: cord ? "#fff" : "#f7f8fa" }}
          />
        </div>
        <div>
          <label style={LBL}>Quantity</label>
          <input className="est-input est-field" value={draft.qty} onChange={(e) => onSet("qty", e.target.value)} placeholder="1" aria-label="Number of identical tracks" style={NUMFIELD} />
        </div>
      </div>

      {/* spacing — collapsed, pre-filled from the series */}
      <details style={{ marginBottom: compact ? 0 : 4 }}>
        <summary style={{ fontSize: 11.5, fontWeight: 600, color: "#8c919c", cursor: "pointer" }}>
          Spacing{" "}
          <span style={{ fontWeight: 500, color: "#aab0bb" }}>
            · carriers every {draft.carrierSpacing || spacing.carrier || "—"}&Prime;, {draft.mounting === "ceiling" ? "hangers" : "clamps"} every{" "}
            {draft.hangerSpacing || spacing.hanger || "—"}&prime;
          </span>
        </summary>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginTop: 10 }}>
          <div>
            <label style={LBL}>Carrier spacing (in)</label>
            <input
              className="est-input est-field"
              value={draft.carrierSpacing !== "" ? draft.carrierSpacing : spacing.carrier}
              onChange={(e) => onSet("carrierSpacing", e.target.value)}
              aria-label="Carrier spacing (in)"
              style={NUMFIELD}
            />
          </div>
          <div>
            <label style={LBL}>{draft.mounting === "ceiling" ? "Hanger" : "Clamp"} spacing (ft)</label>
            <input
              className="est-input est-field"
              value={draft.hangerSpacing !== "" ? draft.hangerSpacing : spacing.hanger}
              onChange={(e) => onSet("hangerSpacing", e.target.value)}
              aria-label="Hanger spacing (ft)"
              style={NUMFIELD}
            />
          </div>
        </div>
      </details>
    </fieldset>
  );
}

/** Parts table rows: the live BOM, or — read-only on a deleted series — the line's saved parts. */
function PartsTable({ bom, stored }: { bom: TrackBom; stored?: SpecItem["components"] }) {
  const rows = bom.rows.length
    ? bom.rows.map((r) => ({ key: r.role, label: r.label, part: r.missing ? r.desc : `${r.sku} · ${r.desc}`, qty: r.qty, unit: r.unit, ext: r.ext, missing: r.missing }))
    : (stored || []).map((c, i) => ({ key: c.sku + i, label: c.label, part: c.sku, qty: c.qty, unit: c.unit, ext: c.price * c.qty, missing: false }));
  if (!rows.length) return null;
  return (
    <div style={{ marginTop: 16, border: "1px solid #e4e7ec", borderRadius: 10, overflow: "hidden" }}>
      <div style={{ display: "grid", gridTemplateColumns: "1.1fr 2.4fr .8fr .9fr", gap: 10, padding: "7px 12px", background: "#fafbfc", fontSize: 10, fontWeight: 600, color: "#aab0bb", textTransform: "uppercase", letterSpacing: ".04em" }}>
        <span>Role</span>
        <span>Part</span>
        <span style={{ textAlign: "right" }}>Qty</span>
        <span style={{ textAlign: "right" }}>Ext</span>
      </div>
      {rows.map((r) => (
        <div key={r.key} style={{ display: "grid", gridTemplateColumns: "1.1fr 2.4fr .8fr .9fr", gap: 10, padding: "7px 12px", borderTop: "1px solid #f3f4f7", fontSize: 12, alignItems: "center" }}>
          <span style={{ fontWeight: 600, color: "#3a3f4a" }}>{r.label}</span>
          <span style={{ color: r.missing ? "#b4543a" : "#8c919c", fontSize: 11.5, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={r.part}>
            {r.part}
          </span>
          <span style={{ textAlign: "right", fontFamily: "var(--font-mono)" }}>
            {r.qty}
            {r.unit && r.unit !== "ea" ? " " + r.unit : ""}
          </span>
          <span style={{ textAlign: "right", fontFamily: "var(--font-mono)" }}>{r.missing ? "—" : fmt(r.ext)}</span>
        </div>
      ))}
    </div>
  );
}

export default function TrackModal({
  secName,
  draft,
  series,
  parts,
  margin,
  editing = false,
  readOnly = null,
  onSet,
  onAdd,
  onClose,
}: {
  secName: string;
  draft: TrackDraft;
  /** Every series (the select lists active ones plus the draft's own). */
  series: readonly TrackSeries[];
  parts: Record<string, TrackPart>;
  /** The quote's tier stamp (null → the 0.30 fallback, as addPart). */
  margin: number | null | undefined;
  /** Reopened from a track line — Update track. */
  editing?: boolean;
  /** A reopened line whose series was deleted: its saved parts, shown read-only. */
  readOnly?: { components: SpecItem["components"]; cost: number; price: number } | null;
  onSet: TrackSetter;
  onAdd: () => void;
  onClose: () => void;
}) {
  const swallowOpeningDoubleClick = useSwallowOpeningDoubleClick();
  const config = trackConfigFromDraft(draft);
  const current = series.find((s) => s.id === draft.seriesId) || null;
  const bom = trackBom(config, current, parts, margin);
  const noSeries = !readOnly && !selectableTrackSeries(series, draft.seriesId).length && !current;
  const valid = !readOnly && !noSeries && !bom.errors.length && bom.price > 0;
  const qty = Number.isInteger(config.qty) && config.qty > 0 ? config.qty : 1;
  const cost = readOnly ? readOnly.cost : bom.cost;
  const price = readOnly ? readOnly.price : bom.price;
  const partsCount = readOnly ? (readOnly.components || []).length : bom.rows.length;
  // A blank run is the untouched form, not a mistake — Add stays disabled
  // without shouting "Enter the run length." before anything is typed.
  const errors = readOnly ? [TRACK_SERIES_GONE] : noSeries || !draft.run.trim() ? [] : bom.errors;

  return (
    <ConfigModal
      width={660}
      icon="⇹"
      iconSize={16}
      title={editing ? "Edit track" : "Configure track"}
      sub={
        editing ? (
          <>Updates this track in {secName} · the line is rebuilt in place at today&rsquo;s catalog prices</>
        ) : (
          <>Adds one track line to {secName} · its parts come from the catalog and appear on the parts list</>
        )
      }
      onClose={onClose}
      footerLeft={
        <>
          <Stat label="Track length" value={bom.trackLengthFt > 0 ? fmtFt(bom.trackLengthFt) + (qty > 1 ? " × " + qty : "") : "—"} />
          <Stat label="Parts" value={partsCount > 0 ? String(partsCount) : "—"} />
          <Stat label="Cost" value={cost > 0 ? fmt(cost) : "—"} color="#8c919c" />
          <Stat label="Price · ext" value={price > 0 ? fmt(price) : "—"} size={14} weight={700} />
        </>
      }
      footerRight={
        <button type="button" onClick={onAdd} disabled={!valid} style={addBtnStyle(valid)}>
          {editing ? "Update track" : "Add track"}
        </button>
      }
    >
      <div onClickCapture={swallowOpeningDoubleClick}>
        {editing && !readOnly && (
          <div role="note" style={{ marginBottom: 16, padding: "9px 12px", borderRadius: 8, border: "1px solid #efe4c4", background: "#fffdf6", color: "#8a6d1f", fontSize: 11.5, lineHeight: 1.45 }}>
            Update track replaces this line in the same place, priced from today&rsquo;s catalog — a price typed on the line is replaced; its notes stay.
          </div>
        )}
        {readOnly && (
          <div role="note" style={{ marginBottom: 16, padding: "9px 12px", borderRadius: 8, border: "1px solid #f1d4cc", background: "#fdf6f4", color: "#b4543a", fontSize: 12, lineHeight: 1.45 }}>
            {TRACK_SERIES_GONE} This line keeps its saved parts and price; to change it, add a new track from another series and remove this one.
          </div>
        )}
        {noSeries ? <NoTrackSeries /> : <TrackFields draft={draft} series={series} onSet={onSet} disabled={!!readOnly} />}
        {!noSeries && <PartsTable bom={bom} stored={readOnly?.components} />}
        {!readOnly && <TrackErrors errors={errors} />}
      </div>
    </ConfigModal>
  );
}
