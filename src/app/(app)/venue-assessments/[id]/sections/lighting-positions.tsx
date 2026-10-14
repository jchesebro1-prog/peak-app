"use client";

import { useId, type CSSProperties } from "react";
import type { PositionRow } from "@/lib/stores/survey-intake";
import { LIGHTING_POSITIONS } from "@/lib/field-lists";
import { ACCENT_INK, ACCENT_SOFT, inpStyle, labelStyle, measStyle } from "./styles";

const chipStyle = (active: boolean): CSSProperties => ({
  fontFamily: "var(--font-ui)",
  fontSize: 12.5,
  fontWeight: 500,
  padding: "9px 13px",
  borderRadius: 20,
  cursor: "pointer",
  minHeight: 40,
  border: `1px solid ${active ? "var(--accent)" : "#e4e7ec"}`,
  background: active ? ACCENT_SOFT : "#fff",
  color: active ? ACCENT_INK : "#5b616e",
});

const textOf = (v: unknown): string => (typeof v === "string" ? v : typeof v === "number" ? String(v) : "");

/** #344 B4 (spec B8) — "Lighting positions" chips (`positionList`) and one Circuits / Length / Trim / Notes row
 *  per ticked position (`positionRows[<position>]`). Unticking a position keeps its row data, hidden. */
export function LightingPositions({
  list,
  rows,
  onList,
  onRows,
}: {
  list: string[];
  rows: Record<string, PositionRow>;
  onList: (list: string[]) => void;
  onRows: (rows: Record<string, PositionRow>) => void;
}) {
  const labelId = useId();
  /* Listed positions in list order, then anything else that was stored. */
  const ticked = [...LIGHTING_POSITIONS.filter((p) => list.includes(p)), ...list.filter((p) => !LIGHTING_POSITIONS.includes(p))];
  const toggle = (pos: string) => onList(list.includes(pos) ? list.filter((p) => p !== pos) : [...list, pos]);
  const patch = (pos: string, next: Partial<PositionRow>) => onRows({ ...rows, [pos]: { ...(rows[pos] || {}), ...next } });

  return (
    <div style={{ marginTop: 16 }}>
      <span id={labelId} style={labelStyle}>Lighting positions</span>
      <div role="group" aria-labelledby={labelId} style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
        {LIGHTING_POSITIONS.map((pos) => (
          <button type="button" key={pos} aria-pressed={list.includes(pos)} onClick={() => toggle(pos)} style={chipStyle(list.includes(pos))}>
            {pos}
          </button>
        ))}
      </div>
      {ticked.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 12 }}>
          {ticked.map((pos) => (
            <PositionRowEditor key={pos} pos={pos} row={rows[pos] || {}} onPatch={(next) => patch(pos, next)} />
          ))}
        </div>
      )}
    </div>
  );
}

function PositionRowEditor({ pos, row, onPatch }: { pos: string; row: PositionRow; onPatch: (next: Partial<PositionRow>) => void }) {
  const id = useId();
  const cell = { ...inpStyle, padding: "10px 11px" };
  const num = { ...measStyle, padding: "10px 11px" };
  return (
    <div style={{ border: "1px solid #e4e7ec", borderRadius: 12, padding: "12px 13px", background: "#fcfcfd" }}>
      <div style={{ fontSize: 13.5, fontWeight: 600, color: "#3a3f4a", marginBottom: 10 }}>{pos}</div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(96px, 1fr))", gap: 10 }}>
        <div>
          <label htmlFor={`${id}-circuits`} style={labelStyle}>Circuits</label>
          <input id={`${id}-circuits`} value={textOf(row.circuits)} onChange={(e) => onPatch({ circuits: e.target.value })} style={num} />
        </div>
        <div>
          <label htmlFor={`${id}-length`} style={labelStyle}>Length</label>
          <input id={`${id}-length`} value={textOf(row.length)} onChange={(e) => onPatch({ length: e.target.value })} style={num} />
        </div>
        <div>
          <label htmlFor={`${id}-trim`} style={labelStyle}>Trim / height</label>
          <input id={`${id}-trim`} value={textOf(row.trim)} onChange={(e) => onPatch({ trim: e.target.value })} style={num} />
        </div>
        <div style={{ gridColumn: "1 / -1" }}>
          <label htmlFor={`${id}-notes`} style={labelStyle}>Notes</label>
          <input id={`${id}-notes`} value={textOf(row.notes)} onChange={(e) => onPatch({ notes: e.target.value })} style={cell} />
        </div>
      </div>
    </div>
  );
}

/** #344 B4 — Console location's "Other — where?" box, shown beside the select when Other is picked. */
export function ConsoleOther({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const id = useId();
  return (
    <div>
      <label htmlFor={id} style={labelStyle}>Other — where?</label>
      <input id={id} value={value} maxLength={200} onChange={(e) => onChange(e.target.value)} style={inpStyle} />
    </div>
  );
}
