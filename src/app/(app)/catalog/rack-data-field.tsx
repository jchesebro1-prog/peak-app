"use client";

import type { CSSProperties } from "react";
import { AIRFLOWS, MOUNT_FACES, RACK_MOUNTS, RACK_WIDTHS, type RackPartFacts } from "@/lib/rack/types";
import { RACK_FACT_LABEL, RACK_NOTES_MAX } from "@/lib/rack/part-facts";

/**
 * #296 — a part's optional rack data (RU height, depth, weight, power,
 * airflow…). Lives inside `<form action={upsertPart}>`: every input is named
 * `rack_<key>` and posts with the form. Blank = unknown — never read as zero —
 * and a submitted blank clears the stored value (mergeUpsert).
 */

const LBL: CSSProperties = {
  fontSize: 10.5,
  fontWeight: 600,
  color: "#9aa0ab",
  textTransform: "uppercase",
  letterSpacing: ".05em",
  marginBottom: 5,
};
const INPUT: CSSProperties = {
  width: "100%",
  padding: "8px 10px",
  fontSize: 13,
  border: "1px solid #e4e7ec",
  borderRadius: 8,
  background: "#fff",
  color: "#16181d",
  boxSizing: "border-box",
};
const HELP: CSSProperties = { fontSize: 11, color: "#aab0bb", marginTop: 6 };

const SELECTS = [
  { key: "rackMount", options: RACK_MOUNTS },
  { key: "rackWidth", options: RACK_WIDTHS },
  { key: "mountFace", options: MOUNT_FACES },
  { key: "airflow", options: AIRFLOWS },
] as const;

const NUMBERS = [
  { key: "ruHeight", step: 0.5 },
  { key: "depthIn", step: 0.1 },
  { key: "weightLb", step: 0.1 },
  { key: "powerWatts", step: 0.1 },
  { key: "maxPowerWatts", step: 0.1 },
  { key: "powerCapacityWatts", step: 0.1 },
] as const;

export default function RackDataField({ initial }: { initial: RackPartFacts }) {
  const anySet = Object.values(initial).some((v) => v !== undefined && v !== "");
  const text = (v: number | undefined) => (v === undefined ? "" : String(v));
  return (
    <details open={anySet} style={{ border: "1px solid #e4e7ec", borderRadius: 10, padding: "10px 12px", background: "#fbfbfc" }}>
      <summary style={{ cursor: "pointer", fontSize: 12.5, fontWeight: 600, color: "#16181d" }}>Rack data</summary>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10, marginTop: 10 }}>
        {SELECTS.map(({ key, options }) => (
          <div key={key}>
            <div style={LBL}>{RACK_FACT_LABEL[key]}</div>
            <select name={`rack_${key}`} defaultValue={initial[key] ?? ""} style={INPUT}>
              <option value="">Unknown</option>
              {options.map((o) => (
                <option key={o} value={o}>
                  {o}
                </option>
              ))}
            </select>
          </div>
        ))}
        {NUMBERS.map(({ key, step }) => (
          <div key={key}>
            <div style={LBL}>{RACK_FACT_LABEL[key]}</div>
            <input name={`rack_${key}`} type="number" min={0} step={step} defaultValue={text(initial[key])} style={INPUT} />
          </div>
        ))}
      </div>
      <div style={{ marginTop: 10 }}>
        <div style={LBL}>{RACK_FACT_LABEL.rackNotes}</div>
        <input name="rack_rackNotes" type="text" maxLength={RACK_NOTES_MAX} defaultValue={initial.rackNotes ?? ""} style={INPUT} />
      </div>
      <div style={HELP}>Leave blank when unknown — blank is never read as zero.</div>
    </details>
  );
}
