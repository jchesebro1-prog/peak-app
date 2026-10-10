"use client";

import type { CSSProperties } from "react";
import { TAG_LIMITS, type TagFields } from "@/lib/design/conduit-riser/tags";

/**
 * #321 — a part's riser tag defaults (BOX · FACE · MOUNT · HT · P/D). Lives
 * inside `<form action={upsertPart}>`: inputs are named `tag_<field>`. A blank
 * field is simply not set, and a submitted blank clears the stored default.
 * A device on the Grid can override any of these per field.
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

const TEXT_FIELDS = [
  { key: "box", label: "Box", max: TAG_LIMITS.box },
  { key: "face", label: "Face", max: TAG_LIMITS.face },
  { key: "mount", label: "Mount", max: TAG_LIMITS.mount },
  { key: "height", label: "Height", max: TAG_LIMITS.height },
] as const;

export default function TagDefaultsField({ initial }: { initial: TagFields }) {
  const anySet = Object.values(initial).some((v) => v !== undefined && v !== "");
  return (
    <details open={anySet} style={{ border: "1px solid #e4e7ec", borderRadius: 10, padding: "10px 12px", background: "#fbfbfc" }}>
      <summary style={{ cursor: "pointer", fontSize: 12.5, fontWeight: 600, color: "#16181d" }}>Riser tag defaults</summary>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 10, marginTop: 10 }}>
        {TEXT_FIELDS.map(({ key, label, max }) => (
          <div key={key}>
            <div style={LBL}>{label}</div>
            <input name={`tag_${key}`} defaultValue={initial[key] ?? ""} maxLength={max} style={{ ...INPUT, textTransform: key === "height" ? "none" : "uppercase" }} />
          </div>
        ))}
        <div>
          <div style={LBL}>P/D</div>
          <select name="tag_pd" defaultValue={initial.pd ?? ""} style={INPUT}>
            <option value="">None</option>
            <option value="P">P</option>
            <option value="D">D</option>
            <option value="P/D">P/D</option>
          </select>
        </div>
      </div>
      <div style={{ fontSize: 11, color: "#aab0bb", marginTop: 8 }}>
        What the riser tag under each of this part&apos;s devices says by default. Any device can override a field.
      </div>
    </details>
  );
}
