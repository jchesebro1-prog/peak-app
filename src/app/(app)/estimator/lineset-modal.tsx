"use client";

import type { CSSProperties } from "react";
import { fmt } from "./pricing";
import { defaultLinesPerSet, linesetQuantities } from "@/lib/rigging-config/lineset";
import { LINESET_TYPES_HOME, LINESET_TYPES_HREF, type LinesetType } from "@/lib/rigging-config/types";
import { RIGGING_TYPE_GONE, linesetBom, linesetConfigFromDraft, selectableTypes, type RiggingCatalog } from "./rigging-bom";
import { NoRiggingTypes, RiggingPartsTable, RiggingWarnings } from "./rigging-modal-ui";
import { TrackErrors } from "./track-modal";
import type { LinesetDraft, SpecItem } from "./types";
import { addBtnStyle, ConfigModal, FIELD, LBL, NUMFIELD, Stat, useSwallowOpeningDoubleClick } from "./est-ui";

/**
 * #373 — the lineset configurator: aircraft cable, hand line, terminations and
 * chain wraps for a counterweight lineset. Blocks, arbors, pipe and bricks stay
 * their own lines. Blank lift lines and allowance show their defaults.
 */

const SUBTLE: CSSProperties = { color: "#c4c9d2", textTransform: "none", letterSpacing: 0, fontWeight: 500 };

export default function LinesetModal({
  secName, draft, types, catalog, margin, editing = false, readOnly = null, onSet, onAdd, onClose, confirmClose,
}: {
  secName: string;
  draft: LinesetDraft;
  types: readonly LinesetType[];
  catalog: RiggingCatalog;
  margin: number | null | undefined;
  editing?: boolean;
  readOnly?: { components: SpecItem["components"]; cost: number; price: number } | null;
  onSet: (field: keyof LinesetDraft, val: string) => void;
  onAdd: () => void;
  onClose: () => void;
  confirmClose?: () => boolean;
}) {
  const swallowOpeningDoubleClick = useSwallowOpeningDoubleClick();
  const config = linesetConfigFromDraft(draft);
  const options = selectableTypes(types, draft.typeId);
  const current = types.find((t) => t.id === draft.typeId) || null;
  const bom = linesetBom(config, current, catalog, margin);
  const noTypes = !readOnly && !options.length && !current;
  const valid = !readOnly && !noTypes && !bom.errors.length && bom.price > 0;
  const cost = readOnly ? readOnly.cost : bom.cost;
  const price = readOnly ? readOnly.price : bom.price;
  const liftLines = current ? linesetQuantities(config, current).liftLines : 0;
  const blank = !draft.sets.trim() || !draft.width.trim() || !draft.gridHeight.trim();
  const errors = readOnly ? [RIGGING_TYPE_GONE] : noTypes || blank ? [] : bom.errors;
  const widthNow = Number(draft.width);
  const linesHint = Number.isFinite(widthNow) && widthNow > 0 ? String(defaultLinesPerSet(widthNow)) : "";

  const num = (label: string, field: keyof LinesetDraft, placeholder = "") => (
    <div>
      <label style={LBL}>{label}</label>
      <input className="est-input est-field" value={draft[field]} placeholder={placeholder} onChange={(e) => onSet(field, e.target.value)} aria-label={label} style={NUMFIELD} />
    </div>
  );

  return (
    <ConfigModal
      width={660}
      icon="⇅"
      iconSize={16}
      title={editing ? "Edit lineset hardware" : "Configure lineset hardware"}
      sub={editing ? <>Updates this line in {secName} · rebuilt in place at today&rsquo;s catalog prices</> : <>Adds one line to {secName}: aircraft cable, hand line, terminations and chain wraps</>}
      onClose={onClose}
      confirmClose={confirmClose}
      footerLeft={
        <>
          <Stat label="Lift lines" value={liftLines > 0 ? String(liftLines) : "—"} />
          <Stat label="Cost" value={cost > 0 ? fmt(cost) : "—"} color="#8c919c" />
          <Stat label="Price · ext" value={price > 0 ? fmt(price) : "—"} size={14} weight={700} />
        </>
      }
      footerRight={<button type="button" onClick={onAdd} disabled={!valid} style={addBtnStyle(valid)}>{editing ? "Update lineset" : "Add lineset"}</button>}
    >
      <div onClickCapture={swallowOpeningDoubleClick}>
        {readOnly && (
          <div role="note" style={{ marginBottom: 16, padding: "9px 12px", borderRadius: 8, border: "1px solid #f1d4cc", background: "#fdf6f4", color: "#b4543a", fontSize: 12 }}>
            {RIGGING_TYPE_GONE} This line keeps its saved parts and price; to change it, add a new lineset from another type and remove this one.
          </div>
        )}
        {noTypes ? (
          <NoRiggingTypes noun="lineset" home={LINESET_TYPES_HOME} href={LINESET_TYPES_HREF} />
        ) : (
          <fieldset disabled={!!readOnly} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 16 }}>
              <div>
                <label style={LBL}>Lineset type <span style={SUBTLE}>· {LINESET_TYPES_HOME}</span></label>
                <select className="est-field" value={draft.typeId} onChange={(e) => onSet("typeId", e.target.value)} aria-label="Lineset type" style={{ ...FIELD, background: "#fff", cursor: "pointer" }}>
                  {!current && <option value={draft.typeId}>{readOnly ? "Deleted type" : "Pick a type"}</option>}
                  {options.map((t) => <option key={t.id} value={t.id}>{t.name}{!t.active ? " (inactive)" : ""}</option>)}
                </select>
              </div>
              <div>
                <label style={LBL}>Label <span style={SUBTLE}>· optional</span></label>
                <input className="est-field" value={draft.label} onChange={(e) => onSet("label", e.target.value)} placeholder="Lineset hardware" aria-label="Lineset label" style={FIELD} />
              </div>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12, marginBottom: 12 }}>
              {num("Sets", "sets")}
              {num("Width (ft)", "width")}
              {num("Grid height (ft)", "gridHeight")}
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12 }}>
              {num("Lift lines per set", "linesPerSet", linesHint)}
              {num("Cable allowance (ft per line)", "allowance", current ? String(current.allowanceFt) : "")}
            </div>
          </fieldset>
        )}
        {!noTypes && <RiggingPartsTable bom={bom} stored={readOnly?.components} />}
        {!readOnly && <RiggingWarnings warnings={bom.warnings} />}
        {!readOnly && <TrackErrors errors={errors} />}
      </div>
    </ConfigModal>
  );
}
