"use client";

import { useState, type CSSProperties } from "react";
import {
  LINESET_QTY_MAX,
  LINESET_TYPES,
  clampLinesetQty,
  addMissingSets,
  fillDown,
  fillDownImpact,
  formatSetRanges,
  linesetQuantityPlan,
  markSpare,
  sortLinesetRows,
  type LinesetFillKey,
  type LinesetRow,
} from "@/lib/stores/linesets";
import { ConditionSlider } from "./condition-slider";
import { ACCENT_BORDER_LT, ACCENT_INK, ACCENT_SOFT, inpStyle, labelStyle, selStyle } from "./styles";

type Props = {
  /** How many line sets (unset until answered or migrated) */
  qty: number | undefined;
  rows: LinesetRow[];
  /** Replace the schedule (and, when given, the quantity) in the draft */
  onApply: (rows: LinesetRow[], qty?: number) => void;
  onRemove: (id: string) => void;
  onChange: (id: string, patch: Partial<LinesetRow>) => void;
};

const FILL_COLUMNS: Array<{ key: LinesetFillKey; label: string }> = [
  { key: "distFromPL", label: "Dist. from PL" },
  { key: "setName", label: "Set name" },
  { key: "type", label: "Type" },
  { key: "battenLength", label: "Batten length" },
  { key: "liftLines", label: "Lift lines" },
  { key: "goods", label: "Goods" },
  { key: "finishedWH", label: "Finished W × H" },
  { key: "arborLoad", label: "Arbor / motor load" },
  { key: "trimLow", label: "Trim low" },
  { key: "trimHigh", label: "Trim high" },
  { key: "condition", label: "Condition" },
  { key: "notes", label: "Notes" },
];

const TEXT_FIELDS: Array<{ key: keyof LinesetRow; label: string }> = [
  { key: "distFromPL", label: "Dist. from PL" },
  { key: "setName", label: "Set name" },
  { key: "battenLength", label: "Batten length" },
  { key: "liftLines", label: "Lift lines" },
  { key: "goods", label: "Goods" },
  { key: "finishedWH", label: "Finished W × H" },
  { key: "arborLoad", label: "Arbor / motor load" },
  { key: "notes", label: "Notes" },
];

const barBtn: CSSProperties = {
  minHeight: 40,
  border: `1px solid ${ACCENT_BORDER_LT}`,
  borderRadius: 9,
  background: ACCENT_SOFT,
  color: ACCENT_INK,
  fontWeight: 600,
  cursor: "pointer",
  padding: "9px 14px",
};
const quietBtn: CSSProperties = { ...barBtn, border: "1px solid #e4e7ec", background: "#fff", color: "#5b616e" };
const toolStyle: CSSProperties = { border: "1px solid #e4e7ec", borderRadius: 10, background: "#fafbfc", padding: "10px 12px", display: "flex", alignItems: "flex-end", gap: 10, flexWrap: "wrap" };

function isNumbered(row: LinesetRow): number | null {
  const text = row.pos.trim();
  return /^\d+$/.test(text) && Number.parseInt(text, 10) >= 1 ? Number.parseInt(text, 10) : null;
}

function TypeSelect({ value, onChange, label }: { value: string; onChange: (value: string) => void; label: string }) {
  return (
    <select aria-label={label} value={value} onChange={(event) => onChange(event.target.value)} style={{ ...selStyle, minWidth: 150, padding: "9px 10px" }}>
      <option value="">—</option>
      {LINESET_TYPES.map((option) => <option key={option.key} value={option.key}>{option.key} — {option.label}</option>)}
    </select>
  );
}

export function LinesetsSection({ qty, rows, onApply, onRemove, onChange }: Props) {
  // null = not being edited: the box shows the stored quantity
  const [typed, setTyped] = useState<string | null>(null);
  const [pendingQty, setPendingQty] = useState<number | null>(null);
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const [fillKey, setFillKey] = useState<LinesetFillKey>("type");
  const [spareFrom, setSpareFrom] = useState("");
  const [spareTo, setSpareTo] = useState("");
  const [notice, setNotice] = useState("");
  const [pendingFill, setPendingFill] = useState<{ id: string; key: LinesetFillKey; count: number } | null>(null);

  const qtyText = typed ?? (qty == null ? "" : String(qty));

  const sorted = sortLinesetRows(rows);
  const focusedRow = sorted.find((row) => row.id === focusedId) || null;
  const known = typeof qty === "number" ? qty : null;
  // sets 1…qty that don't have a row yet (a migrated quantity before anyone opened the table)
  const have = new Set(sorted.map((row) => isNumbered(row)));
  let missing = 0;
  for (let i = 1; known != null && i <= known; i++) if (!have.has(i)) missing++;

  const pendingPlan = pendingQty != null ? linesetQuantityPlan(sorted, pendingQty) : null;

  function applyQty(n: number) {
    const plan = linesetQuantityPlan(sorted, n);
    setPendingQty(null);
    setNotice("");
    setTyped(null);
    onApply(plan.rows, n);
  }

  function commitQty() {
    const text = qtyText.trim();
    const raw = text === "" ? 0 : Number(text);
    if (!Number.isFinite(raw)) {
      setTyped(null);
      return;
    }
    const n = clampLinesetQty(raw);
    const plan = linesetQuantityPlan(sorted, n);
    if (n === qty && plan.rows.length === sorted.length && plan.dropped.length === 0) {
      setTyped(null);
      return;
    }
    if (plan.dropped.length) {
      setPendingQty(n);
      setTyped(String(n));
      return;
    }
    applyQty(n);
  }

  function addMissing() {
    if (known == null) return;
    setNotice("");
    onApply(addMissingSets(sorted, known));
  }

  function cancelQty() {
    setPendingQty(null);
    setTyped(null);
  }

  function applyFillDown(id: string, key: LinesetFillKey) {
    const from = sorted.find((row) => row.id === id);
    onApply(fillDown(sorted, id, key));
    const label = FILL_COLUMNS.find((c) => c.key === key)?.label || "column";
    setPendingFill(null);
    setNotice(`Copied ${label} from set ${from?.pos || "?"} down to the sets below.`);
  }

  function runFillDown() {
    if (!focusedRow) return;
    const count = fillDownImpact(sorted, focusedRow.id, fillKey);
    if (count > 0) {
      setNotice("");
      setPendingFill({ id: focusedRow.id, key: fillKey, count });
      return;
    }
    applyFillDown(focusedRow.id, fillKey);
  }

  function runMarkSpare() {
    const from = Number.parseInt(spareFrom, 10);
    const to = Number.parseInt(spareTo, 10);
    if (!Number.isFinite(from) || !Number.isFinite(to) || from < 1 || to < 1) {
      setNotice("Enter the first and last set number to mark as spare.");
      return;
    }
    const result = markSpare(sorted, from, to);
    onApply(result.rows);
    const marked = result.rows.filter((row, i) => row !== sorted[i]).length;
    setNotice(
      `Marked ${marked} ${marked === 1 ? "set" : "sets"} as open / spare.` +
        (result.skipped.length ? ` Left ${formatSetRanges(result.skipped)} alone — they already have a type.` : ""),
    );
  }

  const rowRemovable = (row: LinesetRow) => {
    const n = isNumbered(row);
    return n == null || known == null || n > known;
  };
  const noteStyle: CSSProperties = { margin: 0, fontSize: 12, color: "#5b616e" };

  return (
    <div>
      <div style={{ display: "flex", alignItems: "flex-end", gap: 12, flexWrap: "wrap" }}>
        <label style={{ ...labelStyle, display: "block" }}>
          How many line sets?
          <input
            type="number"
            inputMode="numeric"
            min={0}
            max={LINESET_QTY_MAX}
            step={1}
            value={qtyText}
            onBlur={() => {
              if (typed != null && pendingQty == null) commitQty();
            }}
            onChange={(event) => setTyped(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                if (typed != null) commitQty();
              }
            }}
            disabled={pendingQty != null}
            style={{ ...inpStyle, marginTop: 5, width: 120 }}
          />
        </label>
        <p style={{ ...noteStyle, paddingBottom: 12 }}>Enter the count and the table below fills with that many sets, numbered 1 to N.</p>
      </div>

      {pendingPlan && pendingPlan.dropped.length > 0 && (
        <div role="alert" style={{ marginTop: 12, border: "1px solid #f0d6cd", background: "#f9ece8", borderRadius: 10, padding: "10px 12px", display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <span style={{ flex: "1 1 220px", fontSize: 13, color: "#8a3d29" }}>
            Remove sets {formatSetRanges(pendingPlan.dropped.map((row) => row.pos))}? They have information entered.
          </span>
          <button type="button" onClick={() => applyQty(pendingQty as number)} style={{ ...barBtn, background: "#b4543a", borderColor: "#b4543a", color: "#fff" }}>Confirm</button>
          <button type="button" onClick={cancelQty} style={quietBtn}>Cancel</button>
        </div>
      )}

      {pendingFill && (() => {
        const fromRow = sorted.find((row) => row.id === pendingFill.id);
        const label = FILL_COLUMNS.find((c) => c.key === pendingFill.key)?.label || "column";
        return (
          <div role="alert" style={{ marginTop: 12, border: "1px solid #f0d6cd", background: "#f9ece8", borderRadius: 10, padding: "10px 12px", display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <span style={{ flex: "1 1 220px", fontSize: 13, color: "#8a3d29" }}>
              Replace {pendingFill.count} {pendingFill.count === 1 ? "value" : "values"} in {label} below set {fromRow?.pos || "?"}?
            </span>
            <button type="button" onClick={() => applyFillDown(pendingFill.id, pendingFill.key)} style={{ ...barBtn, background: "#b4543a", borderColor: "#b4543a", color: "#fff" }}>Confirm</button>
            <button type="button" onClick={() => setPendingFill(null)} style={quietBtn}>Cancel</button>
          </div>
        );
      })()}

      {missing > 0 && known != null && pendingQty == null && (
        <div style={{ marginTop: 12, display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <span style={noteStyle}>{known} line {known === 1 ? "set is" : "sets are"} recorded but {missing} {missing === 1 ? "has" : "have"} no row yet.</span>
          <button type="button" onClick={addMissing} style={barBtn}>Add the missing {missing === 1 ? "set" : "sets"}</button>
        </div>
      )}

      {sorted.length > 0 && (
        <div style={{ marginTop: 14, display: "flex", flexDirection: "column", gap: 10 }}>
          <div style={toolStyle}>
            <label style={labelStyle}>
              Column
              <select value={fillKey} onChange={(event) => setFillKey(event.target.value as LinesetFillKey)} style={{ ...selStyle, marginTop: 5, minWidth: 160, padding: "9px 10px" }}>
                {FILL_COLUMNS.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
              </select>
            </label>
            <button type="button" onClick={runFillDown} disabled={!focusedRow} style={{ ...barBtn, opacity: focusedRow ? 1 : 0.5, cursor: focusedRow ? "pointer" : "default" }}>Fill down</button>
            <span style={{ ...noteStyle, paddingBottom: 12 }}>{focusedRow ? `From set ${focusedRow.pos || "?"} to the end.` : "Click into a row first."}</span>
          </div>
          <div style={toolStyle}>
            <label style={labelStyle}>
              From set
              <input type="number" min={1} inputMode="numeric" value={spareFrom} onChange={(event) => setSpareFrom(event.target.value)} style={{ ...inpStyle, marginTop: 5, width: 90 }} />
            </label>
            <label style={labelStyle}>
              To set
              <input type="number" min={1} inputMode="numeric" value={spareTo} onChange={(event) => setSpareTo(event.target.value)} style={{ ...inpStyle, marginTop: 5, width: 90 }} />
            </label>
            <button type="button" onClick={runMarkSpare} style={barBtn}>Mark range spare</button>
            <span style={{ ...noteStyle, paddingBottom: 12 }}>Sets Open / spare on sets with no type yet.</span>
          </div>
          {notice && <p role="status" style={noteStyle}>{notice}</p>}
        </div>
      )}

      {sorted.length > 0 && (
        <div style={{ marginTop: 14 }}>
          <div className="va-lineset-desktop" style={{ overflowX: "auto", maxWidth: "100%" }}>
            <table style={{ borderCollapse: "separate", borderSpacing: 0, minWidth: 1640, width: "100%", fontSize: 12 }}>
              <thead>
                <tr>
                  {["Pos.", "Dist. from PL", "Set name", "Type", "Batten length", "Lift lines", "Goods", "Finished W × H", "Arbor / motor", "Trim low / high", "Condition", "Notes", ""].map((label, i) => (
                    <th key={i} style={{ ...labelStyle, textAlign: "left", padding: "0 6px 7px", whiteSpace: "nowrap" }}>{label}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sorted.map((row) => (
                  <tr key={row.id} onFocusCapture={() => setFocusedId(row.id)} style={focusedId === row.id ? { background: ACCENT_SOFT } : undefined}>
                    <td>
                      {isNumbered(row) != null ? (
                        <strong style={{ display: "inline-block", minWidth: 40, padding: "0 8px" }}>{row.pos}</strong>
                      ) : (
                        <input aria-label="Set number" value={row.pos} onChange={(event) => onChange(row.id, { pos: event.target.value })} style={{ ...inpStyle, width: 66, padding: "9px 8px" }} />
                      )}
                    </td>
                    <td><input aria-label={`Dist. from PL, set ${row.pos}`} value={row.distFromPL} onChange={(event) => onChange(row.id, { distFromPL: event.target.value })} style={{ ...inpStyle, width: 105, padding: "9px 8px" }} /></td>
                    <td><input aria-label={`Set name, set ${row.pos}`} value={row.setName} onChange={(event) => onChange(row.id, { setName: event.target.value })} style={{ ...inpStyle, width: 145, padding: "9px 8px" }} /></td>
                    <td><TypeSelect label={`Type, set ${row.pos}`} value={row.type} onChange={(type) => onChange(row.id, { type: type as LinesetRow["type"] })} /></td>
                    {(["battenLength", "liftLines", "goods", "finishedWH", "arborLoad"] as const).map((key) => (
                      <td key={key}><input aria-label={`${TEXT_FIELDS.find((f) => f.key === key)?.label}, set ${row.pos}`} value={row[key]} onChange={(event) => onChange(row.id, { [key]: event.target.value })} style={{ ...inpStyle, width: 105, padding: "9px 8px" }} /></td>
                    ))}
                    <td><div style={{ display: "flex", gap: 5 }}><input aria-label={`Trim low, set ${row.pos}`} value={row.trimLow} onChange={(event) => onChange(row.id, { trimLow: event.target.value })} style={{ ...inpStyle, width: 72, padding: "9px 8px" }} /><input aria-label={`Trim high, set ${row.pos}`} value={row.trimHigh} onChange={(event) => onChange(row.id, { trimHigh: event.target.value })} style={{ ...inpStyle, width: 72, padding: "9px 8px" }} /></div></td>
                    <td style={{ minWidth: 250 }}><ConditionSlider compact label={`Condition, set ${row.pos}`} value={row.condition} onChange={(condition) => onChange(row.id, { condition })} /></td>
                    <td><input aria-label={`Notes, set ${row.pos}`} value={row.notes} onChange={(event) => onChange(row.id, { notes: event.target.value })} style={{ ...inpStyle, width: 170, padding: "9px 8px" }} /></td>
                    <td>{rowRemovable(row) && <button type="button" onClick={() => onRemove(row.id)} aria-label={`Remove lineset ${row.pos || "row"}`} style={{ minHeight: 40, minWidth: 40, border: "1px solid #e4e7ec", borderRadius: 9, background: "#fff", color: "#a64b3c", cursor: "pointer" }}>×</button>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="va-lineset-mobile" style={{ display: "none", flexDirection: "column", gap: 10 }}>
            {sorted.map((row) => (
              <div key={row.id} onFocusCapture={() => setFocusedId(row.id)} style={{ border: `1px solid ${focusedId === row.id ? ACCENT_BORDER_LT : "#e4e7ec"}`, borderRadius: 11, padding: 12, background: "#fff" }}>
                <strong style={{ display: "block", marginBottom: 8, fontSize: 13 }}>Set {row.pos || "?"}</strong>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 10 }}>
                  {isNumbered(row) == null && (
                    <label style={labelStyle}>Pos.<input value={row.pos} onChange={(event) => onChange(row.id, { pos: event.target.value })} style={{ ...inpStyle, marginTop: 5 }} /></label>
                  )}
                  {TEXT_FIELDS.map(({ key, label }) => (
                    <label key={key} style={{ ...labelStyle, gridColumn: key === "notes" ? "1 / -1" : undefined }}>{label}<input value={String(row[key] ?? "")} onChange={(event) => onChange(row.id, { [key]: event.target.value })} style={{ ...inpStyle, marginTop: 5 }} /></label>
                  ))}
                  <label style={labelStyle}>Type<TypeSelect label={`Set ${row.pos} type`} value={row.type} onChange={(type) => onChange(row.id, { type: type as LinesetRow["type"] })} /></label>
                  <label style={labelStyle}>Trim low<input value={row.trimLow} onChange={(event) => onChange(row.id, { trimLow: event.target.value })} style={{ ...inpStyle, marginTop: 5 }} /></label>
                  <label style={labelStyle}>Trim high<input value={row.trimHigh} onChange={(event) => onChange(row.id, { trimHigh: event.target.value })} style={{ ...inpStyle, marginTop: 5 }} /></label>
                  <div style={{ gridColumn: "1 / -1" }}><ConditionSlider label={`Set ${row.pos} condition`} value={row.condition} onChange={(condition) => onChange(row.id, { condition })} /></div>
                </div>
                {rowRemovable(row) && (
                  <button type="button" onClick={() => onRemove(row.id)} style={{ marginTop: 10, minHeight: 38, border: "1px solid #ead4cf", borderRadius: 9, background: "#fff", color: "#a64b3c", cursor: "pointer", padding: "8px 12px" }}>Remove lineset</button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
