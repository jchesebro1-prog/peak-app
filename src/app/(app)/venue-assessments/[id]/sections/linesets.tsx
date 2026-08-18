"use client";

import { LINESET_CONDS, LINESET_TYPES, blankLinesetRow, type LinesetRow } from "@/lib/stores/linesets";

export function LinesetsSection({ enabled, rows, onEnabled, onRows }: { enabled: boolean; rows: LinesetRow[]; onEnabled: (value: boolean) => void; onRows: (rows: LinesetRow[]) => void }) {
  const patch = (id: string, key: keyof LinesetRow, value: string) => onRows(rows.map((row) => row.id === id ? { ...row, [key]: value } : row));
  const fields: Array<[keyof LinesetRow, string]> = [["pos", "Pos."], ["distFromPL", "From PL"], ["setName", "Name"], ["battenLength", "Batten"], ["liftLines", "Lift lines"], ["goods", "Goods"], ["finishedWH", "Finished W × H"], ["arborLoad", "Arbor / motor"], ["trimLow", "Trim low"], ["trimHigh", "Trim high"], ["notes", "Notes"]];
  return <div>
    <label style={{ display: "flex", gap: 9, alignItems: "center", fontSize: 13, fontWeight: 600, cursor: "pointer" }}><input type="checkbox" checked={enabled} onChange={(e) => onEnabled(e.target.checked)} /> Record lineset inventory</label>
    {enabled && <div style={{ overflowX: "auto", marginTop: 14 }}><table style={{ width: "100%", minWidth: 920, borderCollapse: "collapse", fontSize: 12 }}><thead><tr>{fields.map(([, label]) => <th key={label} style={th}>{label}</th>)}<th style={th}>Type</th><th style={th}>Cond.</th><th /></tr></thead><tbody>{rows.map((row) => <tr key={row.id}>{fields.map(([key]) => <td key={key} style={td}><input value={row[key] as string} onChange={(e) => patch(row.id, key, e.target.value)} style={input} /></td>)}<td style={td}><select value={row.type} onChange={(e) => patch(row.id, "type", e.target.value)} style={input}><option value="" />{LINESET_TYPES.map((item) => <option key={item.key} value={item.key}>{item.key} — {item.label}</option>)}</select></td><td style={td}><select value={row.cond} onChange={(e) => patch(row.id, "cond", e.target.value)} style={input}><option value="" />{LINESET_CONDS.map((item) => <option key={item.key} value={item.key}>{item.key} — {item.label}</option>)}</select></td><td style={td}><button onClick={() => onRows(rows.filter((item) => item.id !== row.id))}>×</button></td></tr>)}</tbody></table><button onClick={() => onRows(rows.concat(blankLinesetRow(rows.length + 1)))} style={button}>+ Add lineset</button></div>}
  </div>;
}
const th = { textAlign: "left" as const, padding: 7, borderBottom: "1px solid #e4e7ec", color: "#667085", whiteSpace: "nowrap" as const };
const td = { padding: 4, borderBottom: "1px solid #f0f1f3" };
const input = { width: "100%", minWidth: 72, padding: "7px 8px", border: "1px solid #dfe3e8", borderRadius: 6, background: "#fff" };
const button = { marginTop: 10, padding: "8px 12px", border: "1px solid var(--accent)", borderRadius: 8, color: "var(--accent)", background: "#fff", fontWeight: 600, cursor: "pointer" };
