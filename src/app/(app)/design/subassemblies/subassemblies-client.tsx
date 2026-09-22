"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { CatalogPart } from "@/lib/stores/catalog";
import type { FixtureOptionCategory, FixtureSubassembly } from "@/lib/stores/subassemblies";
import { resolveSubassembly } from "@/lib/fixture-assemblies";
import { dateYear } from "@/lib/format";
import { deleteSubassemblyAction, saveFixtureAction } from "./actions";

const pricesNote = (at: number | null) => (at == null ? "prices as of: unknown" : `prices as of ${dateYear(at)}`);

const FIELD: React.CSSProperties = { width: "100%", boxSizing: "border-box", border: "1px solid #dfe2e8", borderRadius: 8, padding: "9px 10px", font: "inherit", fontSize: 13, color: "#16181d", background: "#fff" };
const LABEL: React.CSSProperties = { display: "block", fontSize: 10, fontWeight: 700, letterSpacing: ".05em", textTransform: "uppercase", color: "#737985", marginBottom: 5 };
const money = (n: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n || 0);
const OPTION_CATEGORIES: { key: FixtureOptionCategory; label: string }[] = [
  { key: "data", label: "Data" }, { key: "power", label: "Power" },
  { key: "mounting", label: "Mounting" }, { key: "accessories", label: "Accessories" },
];

function PartPicker({ label, parts, value, onChange }: { label: string; parts: CatalogPart[]; value: string; onChange: (sku: string) => void }) {
  const [query, setQuery] = useState("");
  const selected = parts.find((p) => p.sku === value);
  const matches = useMemo(() => {
    const tokens = query.toLowerCase().split(/\s+/).filter(Boolean);
    return parts.filter((p) => tokens.every((t) => `${p.desc} ${p.sku} ${p.mfr || ""} ${p.category}`.toLowerCase().includes(t))).slice(0, 80);
  }, [parts, query]);
  return (
    <div>
      <label style={LABEL}>{label}</label>
      <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search name, manufacturer, or part #" style={{ ...FIELD, marginBottom: 6 }} />
      <select value={value} onChange={(e) => onChange(e.target.value)} style={FIELD} required>
        <option value="">Select a catalog part…</option>
        {selected && !matches.some((p) => p.sku === selected.sku) && <option value={selected.sku}>{selected.desc} · {selected.sku}</option>}
        {matches.map((p) => <option key={p.sku} value={p.sku}>{p.desc} · {p.sku} · {money(p.cost)}</option>)}
      </select>
      {selected && <div style={{ color: "#6b7079", fontSize: 11.5, marginTop: 5 }}>{selected.mfr || "Unspecified manufacturer"} · cost {money(selected.cost)}</div>}
    </div>
  );
}

export default function SubassembliesClient({ parts, initial, priceListEffective }: { parts: CatalogPart[]; initial: FixtureSubassembly[]; priceListEffective: Record<string, number> }) {
  const router = useRouter();
  const [label, setLabel] = useState("");
  const [description, setDescription] = useState("");
  const [lightEngineSku, setLightEngineSku] = useState("");
  const [lensSku, setLensSku] = useState("");
  const [lamp, setLamp] = useState("");
  const [position, setPosition] = useState("");
  const [circuit, setCircuit] = useState("");
  const [options, setOptions] = useState<Record<FixtureOptionCategory, { sku: string; qty: number }[]>>({ data: [], power: [], mounting: [], accessories: [] });
  const [editingId, setEditingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const settings = { priceListEffective };
  /** #129 — live pricing for the form's current picks, the same resolver the saved list uses. */
  const draft = resolveSubassembly({ lightEngineSku, lensSku, options }, parts, settings);

  const reset = () => { setEditingId(null); setLabel(""); setDescription(""); setLightEngineSku(""); setLensSku(""); setLamp(""); setPosition(""); setCircuit(""); setOptions({ data: [], power: [], mounting: [], accessories: [] }); setError(null); };
  const edit = (item: FixtureSubassembly) => { setEditingId(item.id); setLabel(item.label); setDescription(item.description); setLightEngineSku(item.lightEngineSku); setLensSku(item.lensSku); setLamp(item.lamp || ""); setPosition(item.position || ""); setCircuit(item.circuit || ""); setOptions({ data: item.options?.data || [], power: item.options?.power || [], mounting: item.options?.mounting || [], accessories: item.options?.accessories || [] }); setError(null); window.scrollTo({ top: 0, behavior: "smooth" }); };
  const submit = async () => {
    setBusy(true); setError(null);
    const result = await saveFixtureAction({ id: editingId, label, description, lightEngineSku, lensSku, lamp, position, circuit, options });
    setBusy(false);
    if (!result.ok) { setError(result.error); return; }
    reset(); router.refresh();
  };
  const remove = async (item: FixtureSubassembly) => {
    if (!window.confirm(`Delete ${item.label}?`)) return;
    await deleteSubassemblyAction(item.id); router.refresh();
  };

  return (
    <>
      <section className="pk-card" style={{ padding: 20, marginBottom: 20 }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "baseline", flexWrap: "wrap" }}>
          <div><h2 style={{ fontSize: 17, margin: 0 }}>{editingId ? "Edit fixture" : "Build a fixture"}</h2><p style={{ margin: "5px 0 18px", color: "#737985", fontSize: 12.5 }}>Choose the catalog light engine and lens. Their costs combine into one reusable fixture price.</p></div>
          {editingId && <button type="button" onClick={reset} style={{ border: 0, background: "transparent", color: "#737985", cursor: "pointer", fontSize: 12 }}>Cancel edit</button>}
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 14 }}>
          <label style={LABEL}>Label<input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. ETC Source Four LED Series 3" style={{ ...FIELD, marginTop: 5 }} /></label>
          <label style={LABEL}>Description<textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Customer-facing fixture description" rows={2} style={{ ...FIELD, marginTop: 5, resize: "vertical" }} /></label>
          <PartPicker label="Light engine" parts={parts} value={lightEngineSku} onChange={setLightEngineSku} />
          <PartPicker label="Lens" parts={parts} value={lensSku} onChange={setLensSku} />
          <label style={LABEL}>Lamp / wattage<input value={lamp} onChange={(e) => setLamp(e.target.value)} placeholder="e.g. LED" style={{ ...FIELD, marginTop: 5 }} /></label>
          <label style={LABEL}>Default hang position<input value={position} onChange={(e) => setPosition(e.target.value)} placeholder="e.g. FOH truss 1" style={{ ...FIELD, marginTop: 5 }} /></label>
          <label style={LABEL}>Default circuit<input value={circuit} onChange={(e) => setCircuit(e.target.value)} placeholder="e.g. 12" style={{ ...FIELD, marginTop: 5 }} /></label>
        </div>
        <div style={{ marginTop: 18, paddingTop: 16, borderTop: "1px solid #eef0f3" }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: "#737985", textTransform: "uppercase", letterSpacing: ".05em", marginBottom: 10 }}>Compatible fixture options</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 14 }}>
            {OPTION_CATEGORIES.map(({ key, label: categoryLabel }) => <div key={key} style={{ border: "1px solid #eef0f3", borderRadius: 9, padding: 10 }}>
              <div style={{ fontSize: 12.5, fontWeight: 700, marginBottom: 8 }}>{categoryLabel}</div>
              {options[key].map((option, index) => <div key={`${option.sku}-${index}`} style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) 58px 24px", gap: 5, alignItems: "center", marginBottom: 6 }}><div style={{ fontSize: 11, color: "#5b616e", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{parts.find((part) => part.sku === option.sku)?.desc || option.sku}</div><input type="number" min={1} value={option.qty} onChange={(e) => setOptions((all) => ({ ...all, [key]: all[key].map((row, i) => i === index ? { ...row, qty: Math.max(1, parseInt(e.target.value, 10) || 1) } : row) }))} style={{ ...FIELD, padding: "5px 6px", fontSize: 11 }} /><button type="button" onClick={() => setOptions((all) => ({ ...all, [key]: all[key].filter((_, i) => i !== index) }))} style={{ border: 0, background: "transparent", color: "#a0442b", cursor: "pointer" }}>×</button></div>)}
              <PartPicker label="Add compatible item" parts={parts} value="" onChange={(sku) => { if (!sku) return; const part = parts.find((p) => p.sku === sku); if (!part) return; setOptions((all) => ({ ...all, [key]: [...all[key], { sku, qty: 1 }] })); }} />
            </div>)}
          </div>
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, marginTop: 16, paddingTop: 14, borderTop: "1px solid #eef0f3" }}>
          <div style={{ fontSize: 12.5, color: "#5b616e" }}>
            Combined cost: <strong>{money(draft.cost)}</strong>
            <span style={{ marginLeft: 8, color: "#9aa0ab", fontSize: 11.5 }}>{pricesNote(draft.pricesAsOf)}</span>
          </div>
          <button type="button" onClick={submit} disabled={busy} style={{ border: 0, borderRadius: 8, padding: "9px 15px", background: busy ? "#c7cad1" : "var(--accent)", color: "#fff", fontSize: 13, fontWeight: 700, cursor: busy ? "wait" : "pointer" }}>{busy ? "Saving…" : editingId ? "Save fixture" : "Build fixture"}</button>
        </div>
        {error && <div style={{ marginTop: 10, color: "#a0442b", fontSize: 12 }}>{error}</div>}
      </section>

      <section className="pk-card" style={{ padding: 20 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 12 }}><h2 style={{ fontSize: 17, margin: 0 }}>Fixture subassemblies</h2><span style={{ color: "#9aa0ab", fontSize: 12 }}>{initial.length} saved</span></div>
        {initial.length === 0 ? <p style={{ color: "#8c919c", fontSize: 13 }}>No fixtures built yet.</p> : <div style={{ display: "grid", gap: 9 }}>{initial.map((item) => {
  const live = resolveSubassembly(item, parts, settings);
  const was = item.snapshot?.price ?? item.price;
  return (
    <div key={item.id} style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) auto auto", gap: 14, alignItems: "center", padding: "12px 0", borderTop: "1px solid #eef0f3" }}>
      <div>
        <div style={{ fontSize: 13.5, fontWeight: 700 }}>{item.label}</div>
        <div style={{ color: "#737985", fontSize: 12, marginTop: 4 }}>{item.description || "No description"}</div>
        <div style={{ color: "#9aa0ab", fontSize: 11.5, marginTop: 5 }}>{item.lightEngineName} + {item.lensName}</div>
        {live.missing.length > 0 && (
          <div style={{ color: "#a0442b", fontSize: 11.5, marginTop: 4 }}>
            {live.missing.length} part{live.missing.length === 1 ? "" : "s"} no longer in the catalog: {live.missing.join(", ")}
          </div>
        )}
      </div>
      <div style={{ textAlign: "right" }}>
        <div style={{ fontFamily: "var(--font-mono)", fontSize: 13, fontWeight: 700 }}>{money(live.price)}</div>
        <div style={{ color: "#9aa0ab", fontSize: 10.5 }}>live combined cost · {pricesNote(live.pricesAsOf)}</div>
        {Math.abs(was - live.price) >= 0.005 && (
          <div style={{ color: "#8a6d1f", fontSize: 10.5 }}>was {money(was)} when built ({dateYear(item.updatedAt)})</div>
        )}
      </div>
      <div style={{ display: "flex", gap: 6 }}>
        <button type="button" onClick={() => edit(item)} style={{ border: "1px solid #dfe2e8", borderRadius: 7, padding: "6px 9px", background: "#fff", color: "#3d424e", cursor: "pointer", fontSize: 11.5 }}>Edit</button>
        <button type="button" onClick={() => remove(item)} style={{ border: "1px solid #f0d6cd", borderRadius: 7, padding: "6px 9px", background: "#fff", color: "#a0442b", cursor: "pointer", fontSize: 11.5 }}>Delete</button>
      </div>
    </div>
  );
})}</div>}
      </section>
    </>
  );
}
