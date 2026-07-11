"use client";

import { FIX_ACC, FIX_LAMPS, FIX_MOUNTS, FIX_PRESETS, FIX_PWR, FIXTURES } from "./estimator-data";
import { computeFixture } from "./pricing";
import type { FixtureDraft } from "./types";
import { addBtnStyle, chipBtn, ConfigModal, FIELD, LBL, NUMFIELD, segBtn, Stat } from "./est-ui";

/**
 * Fixture configurator — the 17-fixture built-in list across 6 families (or
 * custom/manual entry) with mounting, accessories, power & data, lamp,
 * position/circuit, and one-tap presets. Add-on pricing per IDEAS #43.
 */

export default function FixtureModal({
  secName,
  draft,
  onSet,
  onSetModel,
  onToggleArr,
  onApplyPreset,
  onAdd,
  onClose,
}: {
  secName: string;
  draft: FixtureDraft;
  onSet: (field: keyof FixtureDraft, val: string) => void;
  onSetModel: (sku: string) => void;
  onToggleArr: (field: "accessories" | "power", key: string) => void;
  onApplyPreset: (index: number) => void;
  onAdd: () => void;
  onClose: () => void;
}) {
  const c = computeFixture(draft);
  const valid = (draft.custom ? (draft.name || "").trim().length > 0 : true) && c.unit > 0;

  return (
    <ConfigModal
      width={640}
      icon="◉"
      iconSize={15}
      title="Configure fixture"
      sub={<>Adds to {secName}</>}
      onClose={onClose}
      footerLeft={
        <>
          <Stat label="Cost / ea" value={"$" + c.cost.toFixed(2)} color="#8c919c" />
          <Stat label="Accessories" value={"$" + c.accSell.toFixed(2)} />
          <Stat
            label="Price · ext"
            value={"$" + Math.round(c.ext).toLocaleString()}
            size={14}
            weight={700}
          />
        </>
      }
      footerRight={
        <button type="button" onClick={onAdd} disabled={!valid} style={addBtnStyle(valid)}>
          Add fixture
        </button>
      }
    >
      {/* presets */}
      <div style={{ marginBottom: 16 }}>
        <label style={LBL}>Quick presets</label>
        <div style={{ display: "flex", gap: 7, flexWrap: "wrap" }}>
          {FIX_PRESETS.map((preset, i) => (
            <button
              type="button"
              key={preset.label}
              className="est-preset"
              onClick={() => onApplyPreset(i)}
              style={{
                fontFamily: "var(--font-ui)",
                fontSize: 12,
                fontWeight: 600,
                color: "color-mix(in srgb, var(--accent) 72%, #000)",
                background: "color-mix(in srgb, var(--accent) 12%, #fff)",
                border: "none",
                borderRadius: 7,
                padding: "7px 11px",
                cursor: "pointer",
              }}
            >
              {preset.label}
            </button>
          ))}
        </div>
      </div>

      {/* fixture model */}
      <div style={{ marginBottom: 16 }}>
        <label style={LBL}>
          Fixture{" "}
          <span style={{ color: "#c4c9d2", textTransform: "none", letterSpacing: 0, fontWeight: 500 }}>
            · built-in list or custom
          </span>
        </label>
        <select
          className="est-field"
          value={draft.custom ? "__custom" : draft.model}
          onChange={(e) => onSetModel(e.target.value)}
          style={{ ...FIELD, background: "#fff", cursor: "pointer" }}
        >
          {FIXTURES.map((f) => (
            <option key={f.sku} value={f.sku}>
              {f.family + " · " + f.name + " · $" + f.list}
            </option>
          ))}
          <option value="__custom">— Custom / manual entry —</option>
        </select>
      </div>

      {/* custom name (manual entry) */}
      {draft.custom && (
        <div style={{ marginBottom: 16 }}>
          <label style={LBL}>Model name</label>
          <input
            className="est-field"
            value={draft.name}
            onChange={(e) => onSet("name", e.target.value)}
            placeholder="e.g. Chauvet Maverick MK3 Profile"
            style={FIELD}
          />
        </div>
      )}

      {/* unit price / qty */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 16 }}>
        <div>
          <label style={LBL}>
            Unit price ($){" "}
            <span
              style={{ color: "#c4c9d2", textTransform: "none", letterSpacing: 0, fontWeight: 500 }}
            >
              · override ok
            </span>
          </label>
          <input
            className="est-input est-field"
            value={draft.price}
            onChange={(e) => onSet("price", e.target.value)}
            placeholder="0"
            style={NUMFIELD}
          />
        </div>
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
      </div>

      {/* mounting */}
      <div style={{ marginBottom: 16 }}>
        <label style={LBL}>Mounting / rigging</label>
        <div style={{ display: "flex", gap: 7, flexWrap: "wrap" }}>
          {Object.keys(FIX_MOUNTS).map((k) => (
            <button type="button" key={k} onClick={() => onSet("mount", k)} style={segBtn(draft.mount === k)}>
              {k}
            </button>
          ))}
        </div>
      </div>

      {/* accessories (multi-select) */}
      <div style={{ marginBottom: 16 }}>
        <label style={LBL}>
          Accessories{" "}
          <span style={{ color: "#c4c9d2", textTransform: "none", letterSpacing: 0, fontWeight: 500 }}>
            · tap to add
          </span>
        </label>
        <div style={{ display: "flex", gap: 7, flexWrap: "wrap" }}>
          {Object.keys(FIX_ACC).map((k) => (
            <button
              type="button"
              key={k}
              onClick={() => onToggleArr("accessories", k)}
              style={chipBtn((draft.accessories || []).indexOf(k) >= 0)}
            >
              {k + " · $" + FIX_ACC[k].price}
            </button>
          ))}
        </div>
      </div>

      {/* power + data (multi-select) */}
      <div style={{ marginBottom: 16 }}>
        <label style={LBL}>
          Power &amp; data{" "}
          <span style={{ color: "#c4c9d2", textTransform: "none", letterSpacing: 0, fontWeight: 500 }}>
            · tap to add
          </span>
        </label>
        <div style={{ display: "flex", gap: 7, flexWrap: "wrap" }}>
          {Object.keys(FIX_PWR).map((k) => (
            <button
              type="button"
              key={k}
              onClick={() => onToggleArr("power", k)}
              style={chipBtn((draft.power || []).indexOf(k) >= 0)}
            >
              {k + " · $" + FIX_PWR[k].price}
            </button>
          ))}
        </div>
      </div>

      {/* lamp / wattage */}
      <div style={{ marginBottom: 16 }}>
        <label style={LBL}>Lamp / wattage</label>
        <div style={{ display: "flex", gap: 7, flexWrap: "wrap" }}>
          {Object.keys(FIX_LAMPS).map((k) => (
            <button type="button" key={k} onClick={() => onSet("lamp", k)} style={segBtn(draft.lamp === k)}>
              {k}
            </button>
          ))}
        </div>
      </div>

      {/* position / circuit */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 4 }}>
        <div>
          <label style={LBL}>Hang position</label>
          <input
            className="est-field"
            value={draft.position}
            onChange={(e) => onSet("position", e.target.value)}
            placeholder="e.g. FOH truss 1"
            style={{ ...FIELD, fontSize: 13 }}
          />
        </div>
        <div>
          <label style={LBL}>Circuit #</label>
          <input
            className="est-field"
            value={draft.circuit}
            onChange={(e) => onSet("circuit", e.target.value)}
            placeholder="e.g. 12"
            style={{ ...FIELD, fontSize: 13 }}
          />
        </div>
      </div>
    </ConfigModal>
  );
}
