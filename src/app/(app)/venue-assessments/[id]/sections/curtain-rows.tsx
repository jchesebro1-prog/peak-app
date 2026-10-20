"use client";

import { useId } from "react";
import type { CurtainItem } from "@/lib/stores/survey-intake";
import { TRACK_SERIES, isConditionLevel, type ConditionLevel } from "@/lib/field-lists";
import { ConditionSlider } from "./condition-slider";
import { inpStyle, labelStyle, measStyle, selStyle } from "./styles";

type TextKey = "qty" | "fabric" | "oz" | "trackSeries" | "w" | "h";

const cell = { ...inpStyle, padding: "10px 11px" };
const num = { ...measStyle, padding: "10px 11px" };
const textOf = (v: unknown): string => (typeof v === "string" ? v : typeof v === "number" ? String(v) : "");

/** #344 B4 (spec B6) — one row per ticked curtain type, stored at `disciplines.curtain.items[<label>]`. The caller
 *  passes the labels to show (ticked Present options minus None and the pipes chip); rows of unticked types keep
 *  their stored data and are simply not shown. */
export function CurtainRows({
  labels,
  items,
  onChange,
  fabricOptions,
}: {
  labels: string[];
  items: Record<string, CurtainItem>;
  onChange: (items: Record<string, CurtainItem>) => void;
  fabricOptions: string[];
}) {
  const listId = useId();
  if (!labels.length) return null;

  const patch = (label: string, next: Partial<CurtainItem>) => {
    const row: CurtainItem = { ...(items[label] || {}), ...next };
    onChange({ ...items, [label]: row });
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 16 }}>
      {fabricOptions.length > 0 && (
        <datalist id={listId}>
          {fabricOptions.map((name) => <option key={name} value={name} />)}
        </datalist>
      )}
      {labels.map((label) => (
        <CurtainRow
          key={label}
          label={label}
          row={items[label] || {}}
          listId={fabricOptions.length > 0 ? listId : undefined}
          onText={(key, value) => patch(label, { [key]: value })}
          onCondition={(level) => patch(label, { condition: level })}
        />
      ))}
    </div>
  );
}

function CurtainRow({
  label,
  row,
  listId,
  onText,
  onCondition,
}: {
  label: string;
  row: CurtainItem;
  listId?: string;
  onText: (key: TextKey, value: string) => void;
  onCondition: (level: ConditionLevel | null) => void;
}) {
  const id = useId();
  const known = !row.trackSeries || TRACK_SERIES.includes(row.trackSeries);
  return (
    <div style={{ border: "1px solid #e4e7ec", borderRadius: 12, padding: "12px 13px", background: "#fcfcfd" }}>
      <div style={{ fontSize: 13.5, fontWeight: 600, color: "#3a3f4a", marginBottom: 10 }}>{label}</div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(96px, 1fr))", gap: "10px 10px" }}>
        <div>
          <label htmlFor={`${id}-qty`} style={labelStyle}>QTY</label>
          <input id={`${id}-qty`} inputMode="numeric" value={textOf(row.qty)} onChange={(e) => onText("qty", e.target.value)} style={num} />
        </div>
        <div style={{ gridColumn: "span 2" }}>
          <label htmlFor={`${id}-fabric`} style={labelStyle}>Fabric type</label>
          <input id={`${id}-fabric`} list={listId} value={textOf(row.fabric)} onChange={(e) => onText("fabric", e.target.value)} style={cell} />
        </div>
        <div>
          <label htmlFor={`${id}-oz`} style={labelStyle}>oz</label>
          <input id={`${id}-oz`} inputMode="decimal" value={textOf(row.oz)} onChange={(e) => onText("oz", e.target.value)} style={num} />
        </div>
        <div>
          <label htmlFor={`${id}-track`} style={labelStyle}>Track series</label>
          <select id={`${id}-track`} value={textOf(row.trackSeries)} onChange={(e) => onText("trackSeries", e.target.value)} style={{ ...selStyle, padding: "10px 11px" }}>
            <option value="">— Select —</option>
            {TRACK_SERIES.map((series) => <option key={series} value={series}>{series}</option>)}
            {!known && <option value={row.trackSeries}>{row.trackSeries}</option>}
          </select>
        </div>
        <div>
          <label htmlFor={`${id}-w`} style={labelStyle}>W</label>
          <input id={`${id}-w`} value={textOf(row.w)} onChange={(e) => onText("w", e.target.value)} style={num} />
        </div>
        <div>
          <label htmlFor={`${id}-h`} style={labelStyle}>H</label>
          <input id={`${id}-h`} value={textOf(row.h)} onChange={(e) => onText("h", e.target.value)} style={num} />
        </div>
        <div style={{ gridColumn: "1 / -1" }}>
          <span style={labelStyle}>Condition</span>
          <ConditionSlider compact label={`${label} condition`} value={isConditionLevel(row.condition) ? row.condition : undefined} onChange={onCondition} />
        </div>
      </div>
    </div>
  );
}
