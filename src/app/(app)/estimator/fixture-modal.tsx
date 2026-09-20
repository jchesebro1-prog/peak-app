"use client";

import Link from "next/link";
import type { ResolvedFixtureAssembly } from "@/lib/fixture-assemblies";
import type { FixtureDraft } from "./types";
import { addBtnStyle, ConfigModal, FIELD, LBL, NUMFIELD, Stat } from "./est-ui";

function totals(assembly: ResolvedFixtureAssembly | undefined, quantities: Record<string, string>) {
  return (assembly?.components || []).reduce((sum, part) => {
    const qty = Math.max(0, Number(quantities[part.sku] ?? part.defaultQty) || 0);
    return { cost: sum.cost + part.cost * qty, sell: sum.sell + part.list * qty };
  }, { cost: 0, sell: 0 });
}

export default function FixtureModal({
  secName, draft, assemblies, onAssembly, onSet, onComponentQty, onAdd, onClose,
}: {
  secName: string;
  draft: FixtureDraft;
  assemblies: ResolvedFixtureAssembly[];
  onAssembly: (id: string) => void;
  onSet: (field: "qty" | "position" | "circuit", value: string) => void;
  onComponentQty: (sku: string, value: string) => void;
  onAdd: () => void;
  onClose: () => void;
}) {
  const assembly = assemblies.find((item) => item.id === draft.assemblyId);
  const unit = totals(assembly, draft.componentQty);
  const count = Math.max(1, Number.parseInt(draft.qty, 10) || 1);
  const valid = !!assembly && unit.sell > 0;

  return (
    <ConfigModal width={700} icon="◉" iconSize={15} title="Configure fixture assembly" sub={<>Adds to {secName}</>} onClose={onClose}
      footerLeft={<><Stat label="Cost / ea" value={`$${unit.cost.toFixed(2)}`} color="#8c919c" /><Stat label="Sell / ea" value={`$${unit.sell.toFixed(2)}`} /><Stat label="Ext sell" value={`$${Math.round(unit.sell * count).toLocaleString()}`} size={14} weight={700} /></>}
      footerRight={<button type="button" onClick={onAdd} disabled={!valid} style={addBtnStyle(valid)}>Add fixture</button>}>
      {!assemblies.length ? (
        <div style={{ padding: 18, border: "1px solid #e4e7ec", borderRadius: 10, background: "#fbfbfc" }}>
          <div style={{ fontWeight: 650 }}>No fixture assemblies yet</div>
          <div style={{ color: "#777d88", fontSize: 13, marginTop: 4 }}>Sample fixtures have been removed. Build a catalog-backed assembly first.</div>
          <Link href="/design/assemblies" style={{ display: "inline-block", marginTop: 10, color: "var(--accent)", fontWeight: 650 }}>Open Assembly Builder →</Link>
        </div>
      ) : <>
        <div style={{ marginBottom: 16 }}><label style={LBL}>Assembly</label><select value={draft.assemblyId} onChange={(event) => onAssembly(event.target.value)} style={{ ...FIELD, background: "#fff" }}><option value="">— Select an assembly —</option>{assemblies.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></div>
        {assembly && <div style={{ marginBottom: 16 }}>
          <label style={LBL}>Components <span style={{ color: "#aab0bb", textTransform: "none", letterSpacing: 0 }}>· set optional items from 0 when needed</span></label>
          <div style={{ border: "1px solid #e4e7ec", borderRadius: 10, overflow: "hidden" }}>{assembly.components.map((part) => <div key={part.sku} style={{ display: "grid", gridTemplateColumns: "1fr 80px", gap: 12, alignItems: "center", padding: "10px 12px", borderBottom: "1px solid #f0f1f4" }}><div><div style={{ fontSize: 13, fontWeight: 650 }}>{part.label}</div><div style={{ fontSize: 11.5, color: part.found ? "#8c919c" : "#b4543a" }}>{part.sku} · {part.role} · {part.desc}{!part.found ? " — missing from catalog" : ""}</div></div><input aria-label={`${part.label} quantity`} type="number" min="0" step="1" value={draft.componentQty[part.sku] ?? String(part.defaultQty)} onChange={(event) => onComponentQty(part.sku, event.target.value)} style={{ ...NUMFIELD, width: "100%" }} /></div>)}</div>
        </div>}
        <div style={{ display: "grid", gridTemplateColumns: "100px 1fr 1fr", gap: 12 }}><div><label style={LBL}>Fixture qty</label><input value={draft.qty} onChange={(event) => onSet("qty", event.target.value)} style={NUMFIELD} /></div><div><label style={LBL}>Hang position</label><input value={draft.position} onChange={(event) => onSet("position", event.target.value)} style={FIELD} /></div><div><label style={LBL}>Circuit #</label><input value={draft.circuit} onChange={(event) => onSet("circuit", event.target.value)} style={FIELD} /></div></div>
      </>}
    </ConfigModal>
  );
}
