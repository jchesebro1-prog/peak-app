"use client";

import { computeCurtain, fmt } from "./pricing";
import type { CurtainDraft, FabricOpt } from "./types";
import { addBtnStyle, ConfigModal, FIELD, LBL, NUMFIELD, segBtn, Stat } from "./est-ui";

/**
 * Curtain configurator — name / hang type / fabric (catalog category
 * 'Fabric', priced by costPerSqft × sewn area) / qty / W / H / fullness /
 * bottom finish, with live fabric-area + cost + ext pricing in the footer.
 */

const HANGS = ["Pipe", "Track", "Other", "None"];
const FULLNESS: [string, string][] = [
  ["Flat", "0"],
  ["50%", "50"],
  ["75%", "75"],
  ["100%", "100"],
];
const BOTTOMS = ["Chain", "Pocket", "None"];

export default function CurtainModal({
  secName,
  draft,
  fabrics,
  margin,
  onSet,
  onAdd,
  onClose,
}: {
  secName: string;
  draft: CurtainDraft;
  fabrics: FabricOpt[];
  /** Tier-seeded margin fraction (item 11, D87); undefined → legacy 38%. */
  margin?: number;
  onSet: (field: keyof CurtainDraft, val: string) => void;
  onAdd: () => void;
  onClose: () => void;
}) {
  const cc = computeCurtain(draft, fabrics, margin);
  const qty = Math.max(1, parseInt(draft.qty, 10) || 0);
  const valid = (draft.name || "").trim().length > 0 && cc.priceEach > 0;

  return (
    <ConfigModal
      width={600}
      icon="⛶"
      iconSize={16}
      title="Configure curtain"
      sub={<>Adds to {secName}</>}
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
        </>
      }
      footerRight={
        <button type="button" onClick={onAdd} disabled={!valid} style={addBtnStyle(valid)}>
          Add curtain
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

      {/* hang type */}
      <div style={{ marginBottom: 16 }}>
        <label style={LBL}>Hang type</label>
        <div style={{ display: "flex", gap: 7 }}>
          {HANGS.map((v) => (
            <button type="button" key={v} onClick={() => onSet("hang", v)} style={segBtn(draft.hang === v)}>
              {v}
            </button>
          ))}
        </div>
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
              {f.name + "  ·  $" + f.costPerSqft.toFixed(2) + "/sq ft"}
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

      {/* bottom finish */}
      <div style={{ marginBottom: 4 }}>
        <label style={LBL}>Bottom finish</label>
        <div style={{ display: "flex", gap: 7 }}>
          {BOTTOMS.map((v) => (
            <button
              type="button"
              key={v}
              onClick={() => onSet("bottom", v)}
              style={segBtn(draft.bottom === v)}
            >
              {v}
            </button>
          ))}
        </div>
      </div>
    </ConfigModal>
  );
}
