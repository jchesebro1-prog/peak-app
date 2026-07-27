"use client";

import { useState } from "react";
import { curtainPriceEach, type FabricSell, type SellCoeffs } from "@/lib/curtain-geom";
import { GRID_FULLNESS, curtainSpecOf, type GridCurtain, type GridCurtainType } from "@/lib/design/grid-bom";

/**
 * Curtain drop-in dialog (punch #49) - Jeff: "when you drop it in you specify
 * the Width, Height, Fullness, Name, and Fabric Type. Similar to our curtain
 * builder for estimates." So this is the estimator's curtain-modal shrunk to
 * an on-canvas popover: the same five fields, the same segmented fullness set,
 * the same fabric rows out of the catalog.
 *
 * The live price is computed from SELL numbers only (lib/curtain-geom, the
 * customer-safe mirror). No margin and no cost basis reach this component; the
 * server prices the line authoritatively on drop and again at quote time, and
 * the two agree to the cent because they run the same two-term model.
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

const LBL: React.CSSProperties = {
  fontSize: 9.5,
  fontWeight: 700,
  letterSpacing: ".05em",
  textTransform: "uppercase",
  color: "#9aa0ab",
  display: "block",
  marginBottom: 3,
};

function moneyFmt(n: number): string {
  return "$" + Math.round(n).toLocaleString("en-US");
}

export default function CurtainDrop({
  type,
  fabrics,
  coeffs,
  busy,
  onConfirm,
  onCancel,
}: {
  type: GridCurtainType;
  fabrics: FabricSell[];
  coeffs: SellCoeffs;
  busy: boolean;
  onConfirm: (curtain: GridCurtain) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState("");
  const [fabricSku, setFabricSku] = useState(fabrics[0]?.sku || "");
  const [width, setWidth] = useState("");
  const [height, setHeight] = useState("");
  const [fullnessPct, setFullnessPct] = useState(50);

  const widthFt = parseFloat(width) || 0;
  const heightFt = parseFloat(height) || 0;
  const draft: GridCurtain = {
    type,
    name: name.trim(),
    widthFt,
    heightFt,
    fullnessPct,
    fabricSku,
  };
  const fabric = fabrics.find((f) => f.sku === fabricSku);
  const price = curtainPriceEach(curtainSpecOf(draft), fabric?.pricePerSqft || 0, coeffs);
  const sewnArea = widthFt * (1 + fullnessPct / 100) * heightFt;
  const valid = Boolean(draft.name) && widthFt > 0 && heightFt > 0 && Boolean(fabricSku);

  return (
    <div
      style={{
        background: "#fff",
        border: "1px solid #c4c9d2",
        borderRadius: 9,
        padding: 11,
        boxShadow: "0 6px 20px rgba(0,0,0,.22)",
        width: 264,
        lineHeight: 1.4,
      }}
      onPointerDown={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        if (e.key === "Escape") onCancel();
        if (e.key === "Enter" && valid && !busy) onConfirm(draft);
      }}
    >
      <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: ".06em", textTransform: "uppercase", color: "#9aa0ab", marginBottom: 8 }}>
        New {type.toLowerCase()}
      </div>

      <div style={{ marginBottom: 8 }}>
        <label style={LBL}>Name</label>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Main Grand Drape"
          style={INPUT}
          autoFocus
        />
      </div>

      <div style={{ marginBottom: 8 }}>
        <label style={LBL}>Fabric</label>
        {fabrics.length === 0 ? (
          <div style={{ fontSize: 11, color: "#a0442b" }}>
            No fabric rows in the catalog. Import one before dropping curtains.
          </div>
        ) : (
          <select value={fabricSku} onChange={(e) => setFabricSku(e.target.value)} style={INPUT}>
            {fabrics.map((f) => (
              <option key={f.sku} value={f.sku}>
                {f.name}
              </option>
            ))}
          </select>
        )}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 7, marginBottom: 8 }}>
        <div>
          <label style={LBL}>Width (ft)</label>
          <input
            value={width}
            onChange={(e) => setWidth(e.target.value)}
            inputMode="decimal"
            placeholder="0"
            style={INPUT}
          />
        </div>
        <div>
          <label style={LBL}>Height (ft)</label>
          <input
            value={height}
            onChange={(e) => setHeight(e.target.value)}
            inputMode="decimal"
            placeholder="0"
            style={INPUT}
          />
        </div>
      </div>

      <div style={{ marginBottom: 9 }}>
        <label style={LBL}>Fullness</label>
        <div style={{ display: "flex", gap: 4 }}>
          {GRID_FULLNESS.map((f) => {
            const on = f.pct === fullnessPct;
            return (
              <button
                key={f.pct}
                type="button"
                onClick={() => setFullnessPct(f.pct)}
                style={{
                  ...BTN,
                  flex: 1,
                  padding: "4px 0",
                  fontSize: 11,
                  background: on ? "#16181d" : "#fff",
                  color: on ? "#fff" : "#3d424e",
                  borderColor: on ? "#16181d" : "#dfe2e8",
                }}
              >
                {f.label}
              </button>
            );
          })}
        </div>
      </div>

      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11.5, color: "#5b616e", marginBottom: 8 }}>
        <span>{sewnArea > 0 ? `${Math.round(sewnArea)} sq ft sewn` : "-"}</span>
        <strong style={{ color: "#16181d" }}>{price > 0 ? moneyFmt(price) : "-"}</strong>
      </div>

      <div style={{ display: "flex", gap: 6 }}>
        <button
          style={{ ...BTN, flex: 1, background: "#16181d", color: "#fff", borderColor: "#16181d" }}
          disabled={!valid || busy}
          onClick={() => onConfirm(draft)}
        >
          Drop curtain
        </button>
        <button style={BTN} onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}
