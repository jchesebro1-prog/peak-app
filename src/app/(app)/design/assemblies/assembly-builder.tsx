"use client";

import { useState, useTransition } from "react";
import { dateYear } from "@/lib/format";
import {
  ASSEMBLY_ROLES,
  type AssemblyRole,
  type FixtureAssembly,
  type FixtureAssemblyComponent,
} from "@/lib/fixture-assemblies";
import { saveFixtureAssembliesAction, searchAssemblyCatalogAction } from "./actions";

type Hit = { sku: string; desc: string; category: string; cost: number; list: number };

const input: React.CSSProperties = { width: "100%", border: "1px solid #dfe2e8", borderRadius: 8, padding: "9px 10px", font: "inherit" };

/** Section = one role, picked via its own search box. Light engine/lens are
 *  exclusive (radio); everything else stacks (checkbox) so a tech can build
 *  a whole fixture's cabling/hardware without the results list clearing
 *  between picks. */
const ROLE_SECTIONS: { role: AssemblyRole; label: string; multi: boolean }[] = [
  { role: "fixture", label: "Light engine", multi: false },
  { role: "lens", label: "Lens", multi: false },
  { role: "power", label: "Power cable", multi: true },
  { role: "data", label: "Data cable", multi: true },
  { role: "accessory", label: "Accessories", multi: true },
  { role: "mount", label: "Clamps", multi: true },
  { role: "cable", label: "Safety cable", multi: true },
];

export default function AssemblyBuilder({ initial, priceDates }: { initial: FixtureAssembly[]; priceDates: Record<string, number | null> }) {
  const [assemblies, setAssemblies] = useState(initial);
  const [query, setQuery] = useState<Record<string, string>>({});
  const [hits, setHits] = useState<Record<string, Hit[]>>({});
  const [saved, setSaved] = useState(false);
  const [pending, startTransition] = useTransition();

  const patch = (id: string, change: Partial<FixtureAssembly>) => {
    setSaved(false);
    setAssemblies((all) => all.map((assembly) => assembly.id === id ? { ...assembly, ...change } : assembly));
  };
  const search = (key: string) => startTransition(async () => {
    const result = await searchAssemblyCatalogAction(query[key] || "");
    setHits((all) => ({ ...all, [key]: result }));
  });
  const toggleSection = (assembly: FixtureAssembly, role: AssemblyRole, hit: Hit, multi: boolean) => {
    const already = assembly.components.some((c) => c.role === role && c.sku === hit.sku);
    const kept = multi
      ? assembly.components.filter((c) => !(c.role === role && c.sku === hit.sku))
      : assembly.components.filter((c) => c.role !== role);
    const next: FixtureAssemblyComponent[] = already
      ? kept
      : kept.concat({ sku: hit.sku, label: hit.desc, role, defaultQty: 1 });
    patch(assembly.id, { components: next });
  };
  const save = () => startTransition(async () => {
    const result = await saveFixtureAssembliesAction(assemblies);
    setAssemblies(result.fixtureAssemblies);
    setSaved(true);
  });

  const pricesNote = (id: string) => {
    if (!(id in priceDates)) return "Prices resolve from the catalog once saved";
    const at = priceDates[id];
    return at == null ? "Prices as of: unknown — set price-list dates on the Catalog screen" : `Prices as of ${dateYear(at)}`;
  };

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "end", gap: 16, margin: "0 0 16px", flexWrap: "wrap" }}>
        <p style={{ margin: 0, color: "#707681", fontSize: 13, maxWidth: 640 }}>Build orderable fixtures from catalog parts. A default quantity of 0 keeps an item available without adding it automatically.</p>
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
          <div style={{ marginTop: 6, fontSize: 11.5, color: "#8c919c" }}>{pricesNote(assembly.id)}</div>
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
          <div style={{ marginTop: 16, display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 12 }}>
            {ROLE_SECTIONS.map((section) => {
              const key = `${assembly.id}:${section.role}`;
              const selected = assembly.components.filter((c) => c.role === section.role);
              return (
                <div key={section.role} style={{ border: "1px solid #e4e7ec", borderRadius: 9, padding: 10 }}>
                  <div style={{ fontSize: 12, fontWeight: 650, marginBottom: 6 }}>
                    {section.label}
                    <span style={{ fontWeight: 400, color: "#8c919c" }}>{section.multi ? " · pick any" : " · pick one"}</span>
                  </div>
                  {!!selected.length && (
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 6 }}>
                      {selected.map((c) => (
                        <span key={c.sku} style={{ display: "inline-flex", alignItems: "center", gap: 4, background: "#f2f4f7", borderRadius: 999, padding: "3px 8px 3px 10px", fontSize: 11.5 }}>
                          {c.label}
                          <button
                            type="button"
                            aria-label={`Remove ${c.label}`}
                            onClick={() => patch(assembly.id, { components: assembly.components.filter((x) => x !== c) })}
                            style={{ border: 0, background: "none", cursor: "pointer", color: "#8c919c", fontSize: 13, lineHeight: 1 }}
                          >
                            ×
                          </button>
                        </span>
                      ))}
                    </div>
                  )}
                  <div style={{ display: "flex", gap: 6 }}>
                    <input
                      value={query[key] || ""}
                      onChange={(event) => setQuery((all) => ({ ...all, [key]: event.target.value }))}
                      onKeyDown={(event) => { if (event.key === "Enter") search(key); }}
                      placeholder={`Search ${section.label.toLowerCase()}…`}
                      style={{ ...input, padding: "7px 9px", fontSize: 12.5 }}
                    />
                    <button className="pk-btn" disabled={pending} onClick={() => search(key)} style={{ padding: "7px 10px", fontSize: 12.5 }}>Go</button>
                  </div>
                  {!!hits[key]?.length && (
                    <div style={{ border: "1px solid #eef0f3", borderRadius: 8, marginTop: 6, overflow: "hidden", maxHeight: 220, overflowY: "auto" }}>
                      {hits[key].map((hit) => {
                        const checked = selected.some((c) => c.sku === hit.sku);
                        return (
                          <label key={hit.sku} style={{ display: "flex", alignItems: "center", gap: 8, borderBottom: "1px solid #f0f1f4", background: checked ? "#f7f9fc" : "#fff", padding: "7px 9px", cursor: "pointer" }}>
                            <input
                              type={section.multi ? "checkbox" : "radio"}
                              name={section.multi ? undefined : key}
                              checked={checked}
                              onChange={() => toggleSection(assembly, section.role, hit, section.multi)}
                            />
                            <span style={{ fontSize: 12, flex: 1 }}><b>{hit.sku}</b> · {hit.desc}</span>
                            <span style={{ fontSize: 11.5, color: "#8c919c" }}>${hit.list.toFixed(2)}</span>
                          </label>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}
