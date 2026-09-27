"use client";

import { useState, type CSSProperties } from "react";
import { FABRIC_RATE_UNIT, NO_FABRIC_RATE, sqftRateFromLinearYard, sqftRateFromSquareYard } from "@/lib/curtain-geom";

/**
 * #227 — a Fabric part's one curtain rate: cost per sq ft of SEWN fabric,
 * making / sewing included (no separate making charge anywhere). Lives inside
 * `<form action={upsertPart}>`: only the two named inputs (curtainAreaRate,
 * boltWidthIn) post with the form. The converter inputs carry no `name` and
 * its buttons are type="button", so nothing else reaches upsertPart.
 */

const LBL: CSSProperties = {
  fontSize: 10.5,
  fontWeight: 600,
  color: "#9aa0ab",
  textTransform: "uppercase",
  letterSpacing: ".05em",
  marginBottom: 5,
};
const HELP: CSSProperties = { fontSize: 11, color: "#aab0bb", marginTop: 4 };
const BTN: CSSProperties = {
  fontSize: 12,
  padding: "8px 10px",
  borderRadius: 8,
  border: "1px solid #e4e7ec",
  background: "#f7f8fa",
  color: "#16181d",
  cursor: "pointer",
  whiteSpace: "nowrap",
};

function asText(n: number | null): string {
  return n != null && n > 0 ? String(n) : "";
}

export default function FabricRateField({
  initialRate,
  initialBoltWidthIn,
  fallbackRate,
  inputStyle,
}: {
  /** The part's own curtainAreaRate, or null. */
  initialRate: number | null;
  initialBoltWidthIn: number | null;
  /** What the part prices at with the field blank (seed, else cost per sq ft); 0 = none. */
  fallbackRate: number;
  inputStyle: CSSProperties;
}) {
  const [rate, setRate] = useState(asText(initialRate));
  const [bolt, setBolt] = useState(asText(initialBoltWidthIn));
  const [perLinYd, setPerLinYd] = useState("");
  const [perSqYd, setPerSqYd] = useState("");
  const linYdRate = sqftRateFromLinearYard(parseFloat(perLinYd), parseFloat(bolt));
  const sqYdRate = sqftRateFromSquareYard(parseFloat(perSqYd));
  const typed = parseFloat(rate);
  const status =
    typed > 0
      ? null
      : fallbackRate > 0
        ? `Blank — prices at $${fallbackRate.toFixed(2)}/${FABRIC_RATE_UNIT} (seed / cost per sq ft).`
        : `${NO_FABRIC_RATE} — curtains in this fabric price at $0.`;

  return (
    <div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <div>
          <div style={LBL}>$/sq ft sewn (includes making)</div>
          <input
            name="curtainAreaRate"
            value={rate}
            onChange={(e) => setRate(e.target.value)}
            inputMode="decimal"
            placeholder={fallbackRate > 0 ? fallbackRate.toFixed(2) : "4.85"}
            style={inputStyle}
          />
        </div>
        <div>
          <div style={LBL}>Bolt width (in)</div>
          <input
            name="boltWidthIn"
            value={bolt}
            onChange={(e) => setBolt(e.target.value)}
            inputMode="decimal"
            placeholder="54"
            style={inputStyle}
          />
        </div>
      </div>
      <div style={HELP}>
        Cost per sq ft of sewn fabric (finished width × (1 + fullness) × height), including making and sewing —
        there is no separate making charge. Sell = cost ÷ (1 − margin).
      </div>
      {status && <div style={{ ...HELP, color: "#8a6d1f" }}>{status}</div>}
      <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 8, marginTop: 10, alignItems: "center" }}>
        <input
          value={perLinYd}
          onChange={(e) => setPerLinYd(e.target.value)}
          inputMode="decimal"
          placeholder="$ per linear yard"
          aria-label="Price per linear yard"
          style={inputStyle}
        />
        <button type="button" disabled={!(linYdRate > 0)} onClick={() => setRate(String(linYdRate))} style={BTN}>
          {linYdRate > 0 ? `Use $${linYdRate.toFixed(2)}/sq ft` : "Use"}
        </button>
        <input
          value={perSqYd}
          onChange={(e) => setPerSqYd(e.target.value)}
          inputMode="decimal"
          placeholder="$ per square yard"
          aria-label="Price per square yard"
          style={inputStyle}
        />
        <button type="button" disabled={!(sqYdRate > 0)} onClick={() => setRate(String(sqYdRate))} style={BTN}>
          {sqYdRate > 0 ? `Use $${sqYdRate.toFixed(2)}/sq ft` : "Use"}
        </button>
      </div>
      <div style={HELP}>
        Converter: $/linear yard ÷ (3 × bolt width ÷ 12) — a 54″ bolt is 13.5 sq ft per yard; $/sq yard ÷ 9. A
        converted fabric price is fabric only — add making before saving.
      </div>
    </div>
  );
}
