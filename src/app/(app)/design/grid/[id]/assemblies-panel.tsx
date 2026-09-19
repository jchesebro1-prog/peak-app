"use client";

import { useMemo, useState } from "react";
import type { PartLite } from "@/lib/design/grid-bom";
import { GRID_LAYERS } from "@/lib/design/grid-scopes";
import { createGridAssemblyAction } from "./actions";

const FIELD: React.CSSProperties = { width: "100%", boxSizing: "border-box", border: "1px solid #dfe2e8", borderRadius: 7, padding: "6px 8px", font: "inherit", fontSize: 12, color: "#16181d", background: "#fff" };
const BTN: React.CSSProperties = { border: "1px solid #dfe2e8", borderRadius: 7, padding: "5px 9px", font: "inherit", fontSize: 11.5, fontWeight: 600, color: "#3d424e", background: "#fff", cursor: "pointer" };

export default function AssembliesPanel({ parts, onChanged }: { parts: PartLite[]; onChanged: () => void }) {
  const devices = useMemo(() => parts.filter((p) => p.kind !== "assembly"), [parts]);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [manufacturer, setManufacturer] = useState("");
  const [modelNumber, setModelNumber] = useState("");
  const [scope, setScope] = useState("Lighting");
  const [picked, setPicked] = useState<string[]>([]);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setPending(true); setError(null);
    const members = picked.map((symbolId, i) => ({ symbolId, qty: 1, x: 0.25 + (i % 3) * 0.25, y: 0.35 + Math.floor(i / 3) * 0.25 }));
    const r = await createGridAssemblyAction({ name, manufacturer, modelNumber, scope, members });
    setPending(false);
    if (!r.ok) { setError(r.error); return; }
    setName(""); setManufacturer(""); setModelNumber(""); setPicked([]); setOpen(false); onChanged();
  };

  return (
    <div style={{ background: "#fff", border: "1px solid #edeff3", borderRadius: 10, padding: 12 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: ".06em", textTransform: "uppercase", color: "#9aa0ab" }}>Assemblies</div>
        <span style={{ flex: 1 }} />
        <button type="button" style={{ ...BTN, padding: "3px 7px", fontSize: 10.5 }} onClick={() => setOpen((v) => !v)}>{open ? "Close" : "+ Build"}</button>
      </div>
      <div style={{ fontSize: 11, color: "#8c919c", lineHeight: 1.4, marginTop: 5 }}>Build a parent symbol from child objects. Assemblies remain searchable and place as one rectangular object.</div>
      {open && (
        <div style={{ marginTop: 10, display: "grid", gap: 7 }}>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Assembly name" style={FIELD} />
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
            <input value={manufacturer} onChange={(e) => setManufacturer(e.target.value)} placeholder="Manufacturer" style={FIELD} />
            <input value={modelNumber} onChange={(e) => setModelNumber(e.target.value)} placeholder="Model #" style={FIELD} />
          </div>
          <select value={scope} onChange={(e) => setScope(e.target.value)} style={FIELD}>{GRID_LAYERS.map((s) => <option key={s}>{s}</option>)}</select>
          <div style={{ fontSize: 10, fontWeight: 700, color: "#9aa0ab", textTransform: "uppercase", letterSpacing: ".05em" }}>Child symbols</div>
          <div style={{ maxHeight: 150, overflowY: "auto", display: "grid", gap: 3 }}>
            {devices.map((p) => {
              const on = picked.includes(p.id);
              return <button key={p.id} type="button" onClick={() => setPicked((xs) => on ? xs.filter((x) => x !== p.id) : [...xs, p.id])} style={{ ...BTN, textAlign: "left", background: on ? "var(--accent-soft)" : "#fff", borderColor: on ? "var(--accent)" : "#dfe2e8" }}>{on ? "✓ " : ""}{p.desc} <span style={{ color: "#9aa0ab" }}>· {p.modelNumber || p.sku}</span></button>;
            })}
          </div>
          {error && <div style={{ fontSize: 11, color: "#a0442b" }}>{error}</div>}
          <button type="button" disabled={pending || !name.trim() || !picked.length} onClick={submit} style={{ ...BTN, background: pending || !name.trim() || !picked.length ? "#eef0f3" : "#16181d", color: pending || !name.trim() || !picked.length ? "#9aa0ab" : "#fff", borderColor: "#16181d" }}>{pending ? "Building…" : "Save assembly"}</button>
        </div>
      )}
    </div>
  );
}
