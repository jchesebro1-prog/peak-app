"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import {
  ASSEMBLY_ROLES,
  type AssemblyRole,
  type FixtureAssembly,
} from "@/lib/fixture-assemblies";
import { saveFixtureAssembliesAction, searchAssemblyCatalogAction } from "./actions";

type Hit = { sku: string; desc: string; category: string; cost: number; list: number };

const input: React.CSSProperties = { width: "100%", border: "1px solid #dfe2e8", borderRadius: 8, padding: "9px 10px", font: "inherit" };

export default function AssemblyBuilder({ initial }: { initial: FixtureAssembly[] }) {
  const [assemblies, setAssemblies] = useState(initial);
  const [query, setQuery] = useState<Record<string, string>>({});
  const [hits, setHits] = useState<Record<string, Hit[]>>({});
  const [saved, setSaved] = useState(false);
  const [pending, startTransition] = useTransition();

  const patch = (id: string, change: Partial<FixtureAssembly>) => {
    setSaved(false);
    setAssemblies((all) => all.map((assembly) => assembly.id === id ? { ...assembly, ...change } : assembly));
  };
  const search = (id: string) => startTransition(async () => {
    const result = await searchAssemblyCatalogAction(query[id] || "");
    setHits((all) => ({ ...all, [id]: result }));
  });
  const save = () => startTransition(async () => {
    const result = await saveFixtureAssembliesAction(assemblies);
    setAssemblies(result.fixtureAssemblies);
    setSaved(true);
  });

  return (
    <div className="pk-content" style={{ maxWidth: 980 }}>
      <Link href="/design" style={{ fontSize: 12.5, color: "#8c919c" }}>← Design</Link>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "end", gap: 16, margin: "8px 0 20px", flexWrap: "wrap" }}>
        <div><h1 style={{ margin: 0, fontSize: 24 }}>Assembly Builder</h1><p style={{ margin: "5px 0 0", color: "#707681", fontSize: 13 }}>Build orderable fixtures from catalog parts. A default quantity of 0 keeps an item available without adding it automatically.</p></div>
        <div style={{ display: "flex", gap: 8 }}>
          <button className="pk-btn" onClick={() => setAssemblies((all) => all.concat({ id: `fa-${Date.now().toString(36)}`, name: "New fixture assembly", components: [] }))}>+ New assembly</button>
          <button className="pk-btn pk-btn-primary" disabled={pending} onClick={save}>{pending ? "Saving…" : saved ? "Saved" : "Save assemblies"}</button>
        </div>
      </div>
      {!assemblies.length && <div className="pk-card" style={{ padding: 28, color: "#777d88" }}>No sample assemblies are installed. Create the first assembly from your catalog.</div>}
      {assemblies.map((assembly) => (
        <section key={assembly.id} className="pk-card" style={{ padding: 18, marginBottom: 16 }}>
          <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
            <input aria-label="Assembly name" value={assembly.name} onChange={(event) => patch(assembly.id, { name: event.target.value })} style={{ ...input, fontWeight: 650, fontSize: 15 }} />
            <button className="pk-btn" onClick={() => setAssemblies((all) => all.filter((item) => item.id !== assembly.id))}>Delete</button>
          </div>
          <div style={{ marginTop: 14, display: "grid", gap: 8 }}>
            {assembly.components.map((component, index) => (
              <div key={`${component.sku}-${index}`} style={{ display: "grid", gridTemplateColumns: "minmax(160px,1.2fr) minmax(140px,1fr) 120px 90px 40px", gap: 8, alignItems: "center" }}>
                <div><div style={{ fontSize: 12.5, fontWeight: 650 }}>{component.sku}</div><div style={{ fontSize: 11, color: "#999fa9" }}>Catalog component</div></div>
                <input aria-label="Builder label" title="Name used in the estimator and BOM" value={component.label} onChange={(event) => patch(assembly.id, { components: assembly.components.map((item, i) => i === index ? { ...item, label: event.target.value } : item) })} style={input} />
                <select value={component.role} onChange={(event) => patch(assembly.id, { components: assembly.components.map((item, i) => i === index ? { ...item, role: event.target.value as AssemblyRole } : item) })} style={input}>{ASSEMBLY_ROLES.map((role) => <option key={role}>{role}</option>)}</select>
                <input aria-label="Default quantity" type="number" min="0" step="1" value={component.defaultQty} onChange={(event) => patch(assembly.id, { components: assembly.components.map((item, i) => i === index ? { ...item, defaultQty: Math.max(0, Number(event.target.value) || 0) } : item) })} style={input} />
                <button aria-label="Remove component" className="pk-btn" onClick={() => patch(assembly.id, { components: assembly.components.filter((_, i) => i !== index) })}>×</button>
              </div>
            ))}
          </div>
          <div style={{ marginTop: 14, display: "flex", gap: 8 }}>
            <input value={query[assembly.id] || ""} onChange={(event) => setQuery((all) => ({ ...all, [assembly.id]: event.target.value }))} onKeyDown={(event) => { if (event.key === "Enter") search(assembly.id); }} placeholder="Search catalog by SKU, item, manufacturer, or category" style={input} />
            <button className="pk-btn" disabled={pending} onClick={() => search(assembly.id)}>Search</button>
          </div>
          {!!hits[assembly.id]?.length && <div style={{ border: "1px solid #e4e7ec", borderRadius: 9, marginTop: 8, overflow: "hidden" }}>{hits[assembly.id].map((hit) => <button key={hit.sku} type="button" onClick={() => { patch(assembly.id, { components: assembly.components.concat({ sku: hit.sku, label: hit.desc, role: "accessory", defaultQty: 1 }) }); setHits((all) => ({ ...all, [assembly.id]: [] })); }} style={{ width: "100%", display: "flex", justifyContent: "space-between", gap: 12, border: 0, borderBottom: "1px solid #f0f1f4", background: "#fff", padding: "10px 12px", textAlign: "left", cursor: "pointer" }}><span><b>{hit.sku}</b> · {hit.desc}</span><span style={{ color: "#8c919c" }}>${hit.list.toFixed(2)}</span></button>)}</div>}
        </section>
      ))}
    </div>
  );
}
