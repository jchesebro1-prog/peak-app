"use client";

import type { CSSProperties } from "react";
import { fmt } from "./pricing";
import { PIPE_TYPES_HOME, PIPE_TYPES_HREF, type PipeType } from "@/lib/rigging-config/types";
import { RIGGING_TYPE_GONE, pipeBom, pipeConfigFromDraft, selectableTypes, type RiggingCatalog } from "./rigging-bom";
import { NoRiggingTypes, RiggingPartsTable, RiggingWarnings } from "./rigging-modal-ui";
import { TrackErrors } from "./track-modal";
import type { PipeDraft, SpecItem } from "./types";
import { addBtnStyle, ConfigModal, FIELD, LBL, NUMFIELD, Stat, useSwallowOpeningDoubleClick } from "./est-ui";

/**
 * #373 — the pipe configurator: type, label, run, quantity and a hanger spacing
 * pre-filled from the type. Reopened from a line (`editing`) it replaces the line
 * in place at today's prices; a line whose type was deleted opens read-only.
 */

export type PipeSetter = (field: keyof PipeDraft, val: string) => void;

const SUBTLE: CSSProperties = { color: "#c4c9d2", textTransform: "none", letterSpacing: 0, fontWeight: 500 };

/** The pipe inputs — shared by this modal and the curtain modal's Add pipe step (`compact`). */
export function PipeFields({ draft, types, onSet, compact = false, disabled = false }: { draft: PipeDraft; types: readonly PipeType[]; onSet: PipeSetter; compact?: boolean; disabled?: boolean }) {
  const options = selectableTypes(types, draft.typeId);
  const current = types.find((t) => t.id === draft.typeId) || null;
  const gap = compact ? 12 : 16;
  if (!options.length && !current && !disabled) return <NoRiggingTypes noun="pipe" home={PIPE_TYPES_HOME} href={PIPE_TYPES_HREF} />;
  return (
    <fieldset disabled={disabled} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: gap }}>
        <div>
          <label style={LBL}>Pipe type <span style={SUBTLE}>· {PIPE_TYPES_HOME}</span></label>
          <select className="est-field" value={draft.typeId} onChange={(e) => onSet("typeId", e.target.value)} aria-label="Pipe type" style={{ ...FIELD, background: "#fff", cursor: "pointer" }}>
            {!current && <option value={draft.typeId}>{disabled ? "Deleted type" : "Pick a type"}</option>}
            {options.map((t) => (
              <option key={t.id} value={t.id}>{t.name}{!t.active ? " (inactive)" : ""}</option>
            ))}
          </select>
        </div>
        <div>
          <label style={LBL}>Label <span style={SUBTLE}>· optional</span></label>
          <input className="est-field" value={draft.label} onChange={(e) => onSet("label", e.target.value)} placeholder="e.g. Main drape pipe" aria-label="Pipe label" style={FIELD} />
        </div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
        <div>
          <label style={LBL}>Run (ft)</label>
          <input className="est-input est-field" value={draft.run} onChange={(e) => onSet("run", e.target.value)} aria-label="Pipe run (ft)" style={NUMFIELD} />
        </div>
        <div>
          <label style={LBL}>Quantity</label>
          <input className="est-input est-field" value={draft.qty} onChange={(e) => onSet("qty", e.target.value)} aria-label="Pipe quantity" style={NUMFIELD} />
        </div>
        <div>
          <label style={LBL}>Hanger spacing (ft)</label>
          <input className="est-input est-field" value={draft.hangerSpacing} placeholder={current ? String(current.hangerSpacingFt) : ""} onChange={(e) => onSet("hangerSpacing", e.target.value)} aria-label="Hanger spacing (ft)" style={NUMFIELD} />
        </div>
      </div>
    </fieldset>
  );
}

export default function PipeModal({
  secName, draft, types, catalog, margin, editing = false, readOnly = null, onSet, onAdd, onClose, confirmClose,
}: {
  secName: string;
  draft: PipeDraft;
  types: readonly PipeType[];
  catalog: RiggingCatalog;
  margin: number | null | undefined;
  editing?: boolean;
  readOnly?: { components: SpecItem["components"]; cost: number; price: number } | null;
  onSet: PipeSetter;
  onAdd: () => void;
  onClose: () => void;
  confirmClose?: () => boolean;
}) {
  const swallowOpeningDoubleClick = useSwallowOpeningDoubleClick();
  const current = types.find((t) => t.id === draft.typeId) || null;
  const bom = pipeBom(pipeConfigFromDraft(draft), current, catalog, margin);
  const noTypes = !readOnly && !selectableTypes(types, draft.typeId).length && !current;
  const valid = !readOnly && !noTypes && !bom.errors.length && bom.price > 0;
  const cost = readOnly ? readOnly.cost : bom.cost;
  const price = readOnly ? readOnly.price : bom.price;
  const partsCount = readOnly ? (readOnly.components || []).length : bom.rows.length;
  const errors = readOnly ? [RIGGING_TYPE_GONE] : noTypes || !draft.run.trim() ? [] : bom.errors;

  return (
    <ConfigModal
      width={660}
      icon="━"
      iconSize={16}
      title={editing ? "Edit pipe" : "Configure pipe"}
      sub={editing ? <>Updates this pipe in {secName} · the line is rebuilt in place at today&rsquo;s catalog prices</> : <>Adds one pipe line to {secName} · its parts come from the catalog and appear on the Review spreadsheet</>}
      onClose={onClose}
      confirmClose={confirmClose}
      footerLeft={
        <>
          <Stat label="Parts" value={partsCount > 0 ? String(partsCount) : "—"} />
          <Stat label="Cost" value={cost > 0 ? fmt(cost) : "—"} color="#8c919c" />
          <Stat label="Price · ext" value={price > 0 ? fmt(price) : "—"} size={14} weight={700} />
        </>
      }
      footerRight={<button type="button" onClick={onAdd} disabled={!valid} style={addBtnStyle(valid)}>{editing ? "Update pipe" : "Add pipe"}</button>}
    >
      <div onClickCapture={swallowOpeningDoubleClick}>
        {readOnly && (
          <div role="note" style={{ marginBottom: 16, padding: "9px 12px", borderRadius: 8, border: "1px solid #f1d4cc", background: "#fdf6f4", color: "#b4543a", fontSize: 12 }}>
            {RIGGING_TYPE_GONE} This line keeps its saved parts and price; to change it, add a new pipe from another type and remove this one.
          </div>
        )}
        {noTypes ? <NoRiggingTypes noun="pipe" home={PIPE_TYPES_HOME} href={PIPE_TYPES_HREF} /> : <PipeFields draft={draft} types={types} onSet={onSet} disabled={!!readOnly} />}
        {!noTypes && <RiggingPartsTable bom={bom} stored={readOnly?.components} />}
        {!readOnly && <RiggingWarnings warnings={bom.warnings} />}
        {!readOnly && <TrackErrors errors={errors} />}
      </div>
    </ConfigModal>
  );
}
