"use client";

import { useMemo, useState } from "react";

import { FIX_PRESETS, FIXTURES, type FixtureAddOns } from "./estimator-data";
import { computeFixture } from "./pricing";
import type { FixtureDraft } from "./types";
import type { Subassembly } from "@/lib/stores/subassemblies";
import { addBtnStyle, chipBtn, ConfigModal, FIELD, LBL, NUMFIELD, segBtn, Stat } from "./est-ui";

/**
 * Fixture configurator — the 17-fixture built-in list across 6 families (or
 * custom/manual entry) with mounting, accessories, power & data, lamp,
 * position/circuit, and one-tap presets. Add-on pricing per IDEAS #43.
 */

export default function FixtureModal({
  secName,
  draft,
  addOns,
  onSet,
  onSetModel,
  subassemblies,
  onSetSubassemblyQty,
  onToggleSubassemblyOption,
  onToggleArr,
  onApplyPreset,
  onAdd,
  onClose,
}: {
  secName: string;
  draft: FixtureDraft;
  /** Live add-on price/cost tables, resolved from Estimating Rules → fixture group. */
  addOns: FixtureAddOns;
  onSet: (field: keyof FixtureDraft, val: string) => void;
  onSetModel: (sku: string) => void;
  subassemblies: Subassembly[];
  onSetSubassemblyQty: (sku: string, qty: string) => void;
  onToggleSubassemblyOption: (sku: string) => void;
  onToggleArr: (field: "accessories" | "power", key: string) => void;
  onApplyPreset: (index: number) => void;
  onAdd: () => void;
  onClose: () => void;
}) {
  const [fixtureSearch, setFixtureSearch] = useState("");
  const fixtureMatches = useMemo(() => {
    const tokens = fixtureSearch.toLowerCase().split(/\s+/).filter(Boolean);
    return FIXTURES.filter((f) => tokens.every((t) => `${f.family} ${f.name} ${f.sku}`.toLowerCase().includes(t)));
  }, [fixtureSearch]);
  const savedMatches = useMemo(() => {
    const tokens = fixtureSearch.toLowerCase().split(/\s+/).filter(Boolean);
    return subassemblies.filter((f) => tokens.every((t) => `${f.label} ${f.description} ${f.id} ${f.lightEngineSku} ${f.lensSku}`.toLowerCase().includes(t)));
  }, [fixtureSearch, subassemblies]);
  const c = computeFixture(draft, addOns);
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
            · built-in list, saved fixture, or custom
          </span>
        </label>
        <input value={fixtureSearch} onChange={(e) => setFixtureSearch(e.target.value)} placeholder="Search saved fixtures or built-in fixtures…" style={{ ...FIELD, marginBottom: 6 }} />
        <select
          className="est-field"
          value={draft.custom ? "__custom" : draft.model}
          onChange={(e) => onSetModel(e.target.value)}
          style={{ ...FIELD, background: "#fff", cursor: "pointer" }}
        >
          {fixtureMatches.map((f) => (
            <option key={f.sku} value={f.sku}>
              {f.family + " · " + f.name + " · $" + f.list}
            </option>
          ))}
          {savedMatches.length > 0 && <optgroup label="Saved fixture builders">{savedMatches.map((f) => <option key={f.id} value={`subassembly:${f.id}`}>{f.label} · {f.description || "Fixture"} · ${f.price.toFixed(2)}</option>)}</optgroup>}
          <option value="__custom">— Custom / manual entry —</option>
        </select>
      </div>

      {draft.subassemblyId && draft.subassemblyOptions && (
        <div style={{ marginBottom: 16, padding: 12, background: "#f7f8fa", borderRadius: 9, border: "1px solid #ececf0" }}>
          <label style={LBL}>Compatible options</label>
          <div style={{ display: "grid", gap: 7 }}>
            {(["data", "power", "mounting", "accessories"] as const).map((category) => {
              const rows = draft.subassemblyOptions?.filter((o) => o.category === category) || [];
              if (!rows.length) return null;
              return <div key={category}><div style={{ fontSize: 10.5, color: "#8c919c", textTransform: "uppercase", letterSpacing: ".05em", marginBottom: 4 }}>{category}</div><div style={{ display: "grid", gap: 4 }}>{rows.map((row) => { const selected = row.selected !== false; return <div key={row.sku} style={{ display: "grid", gridTemplateColumns: "22px minmax(0,1fr) 58px", gap: 6, alignItems: "center", opacity: selected ? 1 : .55 }}><button type="button" onClick={() => onToggleSubassemblyOption(row.sku)} style={{ width: 20, height: 20, borderRadius: 5, border: `1px solid ${selected ? "var(--accent)" : "#cfd3da"}`, background: selected ? "var(--accent)" : "#fff", color: selected ? "#fff" : "#9aa0ab", cursor: "pointer", fontSize: 12 }}>{selected ? "✓" : ""}</button><span style={{ fontSize: 11.5, color: "#3d424e" }}>{row.name}</span><input type="number" min={1} value={row.qty} onChange={(e) => onSetSubassemblyQty(row.sku, e.target.value)} style={{ ...NUMFIELD, padding: "5px 6px", fontSize: 11 }} /></div>; })}</div></div>;
            })}
          </div>
          <div style={{ color: "#8c919c", fontSize: 10.5, marginTop: 8 }}>Options are limited to the compatibility list defined in Subassemblies.</div>
        </div>
      )}

      {draft.subassemblyId && <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10, marginBottom: 16 }}>
        <div><label style={LBL}>Lamp / wattage</label><input value={draft.lamp} onChange={(e) => onSet("lamp", e.target.value)} placeholder="LED" style={FIELD} /></div>
        <div><label style={LBL}>Hang position</label><input value={draft.position} onChange={(e) => onSet("position", e.target.value)} placeholder="FOH truss 1" style={FIELD} /></div>
        <div><label style={LBL}>Circuit #</label><input value={draft.circuit} onChange={(e) => onSet("circuit", e.target.value)} placeholder="12" style={FIELD} /></div>
      </div>}

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
      <div style={{ marginBottom: 16, display: draft.subassemblyId ? "none" : undefined }}>
        <label style={LBL}>Mounting / rigging</label>
        <div style={{ display: "flex", gap: 7, flexWrap: "wrap" }}>
          {Object.keys(addOns.mounts).map((k) => (
            <button type="button" key={k} onClick={() => onSet("mount", k)} style={segBtn(draft.mount === k)}>
              {k}
            </button>
          ))}
        </div>
      </div>

      {/* accessories (multi-select) */}
      <div style={{ marginBottom: 16, display: draft.subassemblyId ? "none" : undefined }}>
        <label style={LBL}>
          Accessories{" "}
          <span style={{ color: "#c4c9d2", textTransform: "none", letterSpacing: 0, fontWeight: 500 }}>
            · tap to add
          </span>
        </label>
        <div style={{ display: "flex", gap: 7, flexWrap: "wrap" }}>
          {Object.keys(addOns.acc).map((k) => (
            <button
              type="button"
              key={k}
              onClick={() => onToggleArr("accessories", k)}
              style={chipBtn((draft.accessories || []).indexOf(k) >= 0)}
            >
              {k + " · $" + addOns.acc[k].price}
            </button>
          ))}
        </div>
      </div>

      {/* power + data (multi-select) */}
      <div style={{ marginBottom: 16, display: draft.subassemblyId ? "none" : undefined }}>
        <label style={LBL}>
          Power &amp; data{" "}
          <span style={{ color: "#c4c9d2", textTransform: "none", letterSpacing: 0, fontWeight: 500 }}>
            · tap to add
          </span>
        </label>
        <div style={{ display: "flex", gap: 7, flexWrap: "wrap" }}>
          {Object.keys(addOns.pwr).map((k) => (
            <button
              type="button"
              key={k}
              onClick={() => onToggleArr("power", k)}
              style={chipBtn((draft.power || []).indexOf(k) >= 0)}
            >
              {k + " · $" + addOns.pwr[k].price}
            </button>
          ))}
        </div>
      </div>

      {/* lamp / wattage */}
      <div style={{ marginBottom: 16, display: draft.subassemblyId ? "none" : undefined }}>
        <label style={LBL}>Lamp / wattage</label>
        <div style={{ display: "flex", gap: 7, flexWrap: "wrap" }}>
          {Object.keys(addOns.lamps).map((k) => (
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
