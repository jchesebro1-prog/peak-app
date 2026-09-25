"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CONNECTION_TYPES, DEFAULT_WIRE_TYPES, type WireType } from "@/lib/catalog-connect";
import { saveWireTypesAction } from "./actions";

/**
 * "Wire types" card (Grid Settings build) — admin editor for
 * `settings.wireTypes`, the registry `resolveWireTypes` feeds to Grid wiring
 * validation (canConnect / validateDeviceWire, lib/catalog-connect). Full-
 * replacement save, the same CustomerFieldsCard idiom used
 * across Settings admin cards: seed rows from the server-resolved (already
 * defaulted) list once on mount, edit locally, post the whole list on Save.
 *
 * `connectionTypes` is edited as a comma-separated list against the
 * CONNECTION_TYPES vocabulary (shown below the field for reference) rather
 * than a multi-select — there are ~60 of them and a plain text field keeps
 * this card in scale with the rest of Grid Settings. Unknown tokens are
 * silently dropped by the server action's cleanWireTypes, same as an
 * unknown icon id in the Category icons card.
 */

type Row = {
  id: string;
  label: string;
  connectionTypes: string;
  cableSku: string;
  dollarsPerFt: string;
  interchangeable: boolean;
};

const MAX_ROWS = 60;

const inS: React.CSSProperties = {
  fontFamily: "var(--font-ui)",
  fontSize: 12.5,
  color: "#16181d",
  border: "1px solid #e4e7ec",
  borderRadius: 8,
  padding: "7px 10px",
  background: "#fff",
  outline: "none",
  width: "100%",
};

const rowOf = (wt: WireType): Row => ({
  id: wt.id,
  label: wt.label,
  connectionTypes: wt.connectionTypes.join(", "),
  cableSku: wt.cableSku || "",
  dollarsPerFt: wt.dollarsPerFt != null ? String(wt.dollarsPerFt) : "",
  interchangeable: !!wt.interchangeable,
});

const rowsOf = (wts: WireType[]): Row[] => wts.map(rowOf);

function rowsToWireTypes(rows: Row[]): WireType[] {
  const out: WireType[] = [];
  for (const r of rows) {
    const id = r.id.trim();
    const connectionTypes = r.connectionTypes
      .split(",")
      .map((c) => c.trim())
      .filter(Boolean);
    if (!id || !connectionTypes.length) continue;
    const wt: WireType = { id, label: r.label.trim() || id, connectionTypes };
    if (r.cableSku.trim()) wt.cableSku = r.cableSku.trim();
    const dpf = Number(r.dollarsPerFt);
    if (r.dollarsPerFt.trim() && Number.isFinite(dpf) && dpf >= 0) wt.dollarsPerFt = dpf;
    if (r.interchangeable) wt.interchangeable = true;
    out.push(wt);
  }
  return out;
}

export function WireTypesCard({ wireTypes }: { wireTypes: WireType[] }) {
  const router = useRouter();
  const [saved, setSaved] = useState<Row[]>(() => rowsOf(wireTypes));
  const [rows, setRows] = useState<Row[]>(() => rowsOf(wireTypes));
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [justSaved, setJustSaved] = useState(false);
  const [showVocab, setShowVocab] = useState(false);

  const dirty = JSON.stringify(rows) !== JSON.stringify(saved);
  const hasContent = rows.some((r) => r.id.trim() && r.connectionTypes.trim());
  const overCap = rows.length > MAX_ROWS;
  const canSave = dirty && !pending && hasContent && !overCap;

  const patch = (i: number, p: Partial<Row>) => {
    setJustSaved(false);
    setError(null);
    setRows((rs) => rs.map((r, idx) => (idx === i ? { ...r, ...p } : r)));
  };
  const addRow = () => {
    setJustSaved(false);
    setRows((rs) => [...rs, { id: "", label: "", connectionTypes: "", cableSku: "", dollarsPerFt: "", interchangeable: false }]);
  };
  const removeRow = (i: number) => {
    setJustSaved(false);
    setRows((rs) => rs.filter((_, idx) => idx !== i));
  };
  const restoreDefaults = () => {
    setJustSaved(false);
    setRows(rowsOf(DEFAULT_WIRE_TYPES));
  };

  const onSave = () => {
    setError(null);
    startTransition(async () => {
      try {
        const built = rowsToWireTypes(rows);
        await saveWireTypesAction(built);
        if (!built.length) {
          const fallback = rowsOf(DEFAULT_WIRE_TYPES);
          setRows(fallback);
          setSaved(fallback);
        } else {
          setSaved(rows);
        }
        setJustSaved(true);
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Save failed — please try again.");
      }
    });
  };

  return (
    <div className="pk-card" style={{ overflow: "hidden", marginBottom: 18 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap", rowGap: 10, padding: "14px 18px", borderBottom: "1px solid #ececf0" }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 14.5, fontWeight: 600 }}>Wire types</div>
          <div style={{ fontSize: 12, color: "#8c919c", marginTop: 4, lineHeight: 1.45 }}>
            The cable registry Grid wiring checks (canConnect / validateDeviceWire) use to decide which
            device ports may be patched together and which cable to offer for a run.
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
          <button type="button" onClick={restoreDefaults} style={{ fontSize: 12, fontWeight: 600, color: "#5b616e", background: "transparent", border: "none", cursor: "pointer" }}>
            Restore defaults
          </button>
          <button type="button" className="pk-btn-accent" disabled={!canSave} onClick={onSave} style={{ fontSize: 13 }}>
            {pending ? "Saving…" : "Save"}
          </button>
        </div>
      </div>

      {error && (
        <div style={{ margin: "12px 18px 0", fontSize: 12, color: "#b4543a", background: "#f9ece8", border: "1px solid #f0d6cd", borderRadius: 8, padding: "9px 12px" }}>
          {error}
        </div>
      )}
      {overCap && (
        <div style={{ margin: "12px 18px 0", fontSize: 12, color: "#b4543a", background: "#f9ece8", border: "1px solid #f0d6cd", borderRadius: 8, padding: "9px 12px" }}>
          Too many wire types to save ({MAX_ROWS} max) — remove some rows.
        </div>
      )}
      {justSaved && !dirty && (
        <div style={{ margin: "12px 18px 0", fontSize: 11.5, color: "#1f7a52", fontWeight: 600 }}>✓ Saved</div>
      )}

      <div style={{ padding: "12px 18px 16px" }}>
        {rows.map((r, i) => (
          <div key={i} style={{ border: "1px solid #eef0f3", borderRadius: 10, padding: 10, marginBottom: 10 }}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 30px", gap: 8, marginBottom: 6 }}>
              <input value={r.id} onChange={(e) => patch(i, { id: e.target.value })} placeholder="id (e.g. cat6)" aria-label="Wire type id" style={{ ...inS, fontWeight: 600 }} />
              <input value={r.label} onChange={(e) => patch(i, { label: e.target.value })} placeholder="Label" aria-label="Label" style={inS} />
              <button type="button" onClick={() => removeRow(i)} title="Remove" aria-label="Remove wire type" style={{ width: 30, height: 30, border: "1px solid #e4e7ec", background: "#fff", borderRadius: 8, color: "#c4c9d2", fontSize: 15, cursor: "pointer" }}>
                ×
              </button>
            </div>
            <input
              value={r.connectionTypes}
              onChange={(e) => patch(i, { connectionTypes: e.target.value })}
              placeholder="Connection types, comma-separated (e.g. HDMI)"
              aria-label="Connection types"
              style={{ ...inS, marginBottom: 6 }}
            />
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr auto", gap: 8, alignItems: "center" }}>
              <input value={r.cableSku} onChange={(e) => patch(i, { cableSku: e.target.value })} placeholder="Cable SKU (optional)" aria-label="Cable SKU" style={inS} />
              <input value={r.dollarsPerFt} onChange={(e) => patch(i, { dollarsPerFt: e.target.value })} placeholder="$/ft (optional)" aria-label="Dollars per foot" inputMode="decimal" style={inS} />
              <label style={{ fontSize: 12, color: "#5b616e", display: "flex", alignItems: "center", gap: 6, whiteSpace: "nowrap" }}>
                <input type="checkbox" checked={r.interchangeable} onChange={(e) => patch(i, { interchangeable: e.target.checked })} />
                Interchangeable
              </label>
            </div>
          </div>
        ))}
        {rows.length === 0 && (
          <div style={{ padding: "18px 0 8px", textAlign: "center", color: "#9aa0ab", fontSize: 12.5 }}>
            No wire types yet — the shipped defaults apply. Add one, or use Restore defaults to edit them.
          </div>
        )}
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <button type="button" onClick={addRow} disabled={rows.length >= MAX_ROWS} style={{ fontSize: 12.5, fontWeight: 600, color: "var(--accent)", background: "transparent", border: "none", cursor: "pointer", padding: 0 }}>
            + Add wire type
          </button>
          <button type="button" onClick={() => setShowVocab((v) => !v)} style={{ fontSize: 12, color: "#8c919c", background: "transparent", border: "none", cursor: "pointer", padding: 0 }}>
            {showVocab ? "Hide" : "Show"} connection type vocabulary ({CONNECTION_TYPES.length})
          </button>
        </div>
        {showVocab && (
          <div style={{ marginTop: 10, fontSize: 11.5, color: "#5b616e", lineHeight: 1.7, maxHeight: 160, overflowY: "auto", border: "1px solid #eef0f3", borderRadius: 8, padding: 10 }}>
            {CONNECTION_TYPES.join(" · ")}
          </div>
        )}
      </div>
    </div>
  );
}
