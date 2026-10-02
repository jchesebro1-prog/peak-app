"use client";

import { useState, type CSSProperties } from "react";
import { FABRIC_RATE_UNIT, NO_FABRIC_RATE, sqftRateFromLinearYard, sqftRateFromSquareYard } from "@/lib/curtain-geom";

/**
 * #227 — a Fabric part's one curtain rate: FABRIC cost per sq ft of sewn
 * fabric area. It carries no sewing: every curtain estimate adds the sewing
 * labor rule on top (#227 late, Estimating Rules curtains.sewingPct). Lives inside
 * `<form action={upsertPart}>`: only the named inputs (curtainAreaRate,
 * boltWidthIn, and #292's oz, ozBasis, flameRating) post with the form. The converter inputs carry no `name` and
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
  initialOz,
  initialOzBasis,
  initialFlameRating,
  fallbackRate,
  inputStyle,
}: {
  /** The part's own curtainAreaRate, or null. */
  initialRate: number | null;
  initialBoltWidthIn: number | null;
  /** #292 — the part's weight (oz), its basis and flame rating, or null. */
  initialOz: number | null;
  initialOzBasis: "lin-yd" | "sq-yd" | null;
  initialFlameRating: string | null;
  /** What the part prices at with the field blank (seed, else cost per sq ft); 0 = none. */
  fallbackRate: number;
  inputStyle: CSSProperties;
}) {
  const [rate, setRate] = useState(asText(initialRate));
  const [bolt, setBolt] = useState(asText(initialBoltWidthIn));
  const [oz, setOz] = useState(asText(initialOz));
  const [ozBasis, setOzBasis] = useState<"lin-yd" | "sq-yd">(initialOzBasis ?? "lin-yd");
  const [flame, setFlame] = useState(initialFlameRating ?? "");
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
          <div style={LBL}>$/sq ft fabric</div>
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
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1.4fr", gap: 12, marginTop: 12 }}>
        <div>
          <div style={LBL}>Weight (oz)</div>
          <input name="oz" value={oz} onChange={(e) => setOz(e.target.value)} inputMode="decimal" placeholder="25" style={inputStyle} />
        </div>
        <div>
          <div style={LBL}>Weight basis</div>
          <select name="ozBasis" value={ozBasis} onChange={(e) => setOzBasis(e.target.value as "lin-yd" | "sq-yd")} style={inputStyle}>
            <option value="lin-yd">per linear yard</option>
            <option value="sq-yd">per square yard</option>
          </select>
        </div>
        <div>
          <div style={LBL}>Flame rating</div>
          <input name="flameRating" value={flame} onChange={(e) => setFlame(e.target.value)} maxLength={120} placeholder="NFPA 701 (IFR)" style={inputStyle} />
        </div>
      </div>
      <div style={HELP}>Weight and flame rating print on curtain cut sheets; blank prints nothing.</div>
      <div style={{ ...HELP, marginTop: 10 }}>
        Fabric cost only — estimates add sewing labor (Estimating Rules, default 10 %). Priced per sq ft of sewn
        fabric area (finished width × (1 + fullness) × height); sell = cost ÷ (1 − margin).
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
        Converter: $/linear yard ÷ (3 × bolt width ÷ 12) — a 54″ bolt is 13.5 sq ft per yard; $/sq yard ÷ 9. Save
        the converted fabric price as is — sewing is added in the estimate.
      </div>
    </div>
  );
}
