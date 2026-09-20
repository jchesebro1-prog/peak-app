import {
  LINESET_CONDS,
  LINESET_TYPES,
  type LinesetRow,
} from "@/lib/stores/linesets";
import { ACCENT_BORDER_LT, ACCENT_INK, ACCENT_SOFT, inpStyle, labelStyle, selStyle } from "./styles";

type Props = {
  enabled: boolean;
  rows: LinesetRow[];
  onEnabled: (enabled: boolean) => void;
  onAdd: () => void;
  onRemove: (id: string) => void;
  onChange: (id: string, patch: Partial<LinesetRow>) => void;
};

const TEXT_FIELDS: Array<{ key: keyof LinesetRow; label: string }> = [
  { key: "pos", label: "Pos." },
  { key: "distFromPL", label: "Dist. from PL" },
  { key: "setName", label: "Set name" },
  { key: "battenLength", label: "Batten length" },
  { key: "liftLines", label: "Lift lines" },
  { key: "goods", label: "Goods" },
  { key: "finishedWH", label: "Finished W × H" },
  { key: "arborLoad", label: "Arbor / motor load" },
  { key: "notes", label: "Notes" },
];

function CodeSelect({
  value,
  options,
  onChange,
}: {
  value: string;
  options: Array<{ key: string; label: string }>;
  onChange: (value: string) => void;
}) {
  return (
    <select value={value} onChange={(event) => onChange(event.target.value)} style={{ ...selStyle, minWidth: 150, padding: "9px 10px" }}>
      <option value="">—</option>
      {options.map((option) => <option key={option.key} value={option.key}>{option.key} — {option.label}</option>)}
    </select>
  );
}

export function LinesetsSection({ enabled, rows, onEnabled, onAdd, onRemove, onChange }: Props) {
  return (
    <div>
      <button
        type="button"
        onClick={() => onEnabled(!enabled)}
        style={{ display: "flex", alignItems: "center", gap: 10, width: "100%", textAlign: "left", border: `1px solid ${enabled ? ACCENT_BORDER_LT : "#e4e7ec"}`, borderRadius: 10, background: enabled ? ACCENT_SOFT : "#fff", color: enabled ? ACCENT_INK : "#5b616e", padding: "11px 13px", cursor: "pointer" }}
      >
        <span style={{ width: 20, height: 20, borderRadius: 6, display: "inline-flex", alignItems: "center", justifyContent: "center", color: "#fff", background: enabled ? "var(--accent)" : "#fff", border: `1.5px solid ${enabled ? "var(--accent)" : "#cfd3da"}`, fontSize: 12, fontWeight: 700 }}>{enabled ? "✓" : ""}</span>
        <span>
          <strong style={{ display: "block", fontSize: 13.5 }}>Capture a lineset inventory</strong>
          <span style={{ display: "block", marginTop: 2, fontSize: 11.5, color: "#8c919c" }}>For theatres, auditoriums, or any room where lineset inventory needs to be recorded.</span>
        </span>
      </button>

      {enabled && (
        <div style={{ marginTop: 14 }}>
          <div className="va-lineset-desktop" style={{ overflowX: "auto", maxWidth: "100%" }}>
            <table style={{ borderCollapse: "separate", borderSpacing: 0, minWidth: 1640, width: "100%", fontSize: 12 }}>
              <thead>
                <tr>
                  {["Pos.", "Dist. from PL", "Set name", "Type", "Batten length", "Lift lines", "Goods", "Finished W × H", "Arbor / motor", "Trim low / high", "Condition", "Notes", ""].map((label) => (
                    <th key={label} style={{ ...labelStyle, textAlign: "left", padding: "0 6px 7px", whiteSpace: "nowrap" }}>{label}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id}>
                    <td><input value={row.pos} onChange={(event) => onChange(row.id, { pos: event.target.value })} style={{ ...inpStyle, width: 66, padding: "9px 8px" }} /></td>
                    <td><input value={row.distFromPL} onChange={(event) => onChange(row.id, { distFromPL: event.target.value })} style={{ ...inpStyle, width: 105, padding: "9px 8px" }} /></td>
                    <td><input value={row.setName} onChange={(event) => onChange(row.id, { setName: event.target.value })} style={{ ...inpStyle, width: 145, padding: "9px 8px" }} /></td>
                    <td><CodeSelect value={row.type} options={LINESET_TYPES} onChange={(type) => onChange(row.id, { type: type as LinesetRow["type"] })} /></td>
                    {(["battenLength", "liftLines", "goods", "finishedWH", "arborLoad"] as const).map((key) => <td key={key}><input value={row[key]} onChange={(event) => onChange(row.id, { [key]: event.target.value })} style={{ ...inpStyle, width: 105, padding: "9px 8px" }} /></td>)}
                    <td><div style={{ display: "flex", gap: 5 }}><input aria-label="Trim low" value={row.trimLow} onChange={(event) => onChange(row.id, { trimLow: event.target.value })} style={{ ...inpStyle, width: 72, padding: "9px 8px" }} /><input aria-label="Trim high" value={row.trimHigh} onChange={(event) => onChange(row.id, { trimHigh: event.target.value })} style={{ ...inpStyle, width: 72, padding: "9px 8px" }} /></div></td>
                    <td><CodeSelect value={row.cond} options={LINESET_CONDS} onChange={(cond) => onChange(row.id, { cond: cond as LinesetRow["cond"] })} /></td>
                    <td><input value={row.notes} onChange={(event) => onChange(row.id, { notes: event.target.value })} style={{ ...inpStyle, width: 170, padding: "9px 8px" }} /></td>
                    <td><button type="button" onClick={() => onRemove(row.id)} aria-label={`Remove lineset ${row.pos || "row"}`} style={{ minHeight: 40, minWidth: 40, border: "1px solid #e4e7ec", borderRadius: 9, background: "#fff", color: "#a64b3c", cursor: "pointer" }}>×</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="va-lineset-mobile" style={{ display: "none", flexDirection: "column", gap: 10 }}>
            {rows.map((row) => (
              <div key={row.id} style={{ border: "1px solid #e4e7ec", borderRadius: 11, padding: 12, background: "#fff" }}>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 10 }}>
                  {TEXT_FIELDS.map(({ key, label }) => (
                    <label key={key} style={{ ...labelStyle, gridColumn: key === "notes" ? "1 / -1" : undefined }}>{label}<input value={String(row[key])} onChange={(event) => onChange(row.id, { [key]: event.target.value })} style={{ ...inpStyle, marginTop: 5 }} /></label>
                  ))}
                  <label style={labelStyle}>Type<CodeSelect value={row.type} options={LINESET_TYPES} onChange={(type) => onChange(row.id, { type: type as LinesetRow["type"] })} /></label>
                  <label style={labelStyle}>Condition<CodeSelect value={row.cond} options={LINESET_CONDS} onChange={(cond) => onChange(row.id, { cond: cond as LinesetRow["cond"] })} /></label>
                  <label style={labelStyle}>Trim low<input value={row.trimLow} onChange={(event) => onChange(row.id, { trimLow: event.target.value })} style={{ ...inpStyle, marginTop: 5 }} /></label>
                  <label style={labelStyle}>Trim high<input value={row.trimHigh} onChange={(event) => onChange(row.id, { trimHigh: event.target.value })} style={{ ...inpStyle, marginTop: 5 }} /></label>
                </div>
                <button type="button" onClick={() => onRemove(row.id)} style={{ marginTop: 10, minHeight: 38, border: "1px solid #ead4cf", borderRadius: 9, background: "#fff", color: "#a64b3c", cursor: "pointer", padding: "8px 12px" }}>Remove lineset</button>
              </div>
            ))}
          </div>

          <button type="button" onClick={onAdd} style={{ marginTop: 10, minHeight: 40, border: `1px solid ${ACCENT_BORDER_LT}`, borderRadius: 9, background: ACCENT_SOFT, color: ACCENT_INK, fontWeight: 600, cursor: "pointer", padding: "9px 14px" }}>+ Add lineset</button>
          {rows.length === 0 && <p style={{ margin: "9px 0 0", fontSize: 12, color: "#9aa0ab" }}>No linesets recorded yet.</p>}
        </div>
      )}
    </div>
  );
}
