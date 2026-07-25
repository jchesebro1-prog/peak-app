"use client";

import { useMemo, useState, useTransition } from "react";
import type { CSSProperties } from "react";
import {
  curtainPriceEach,
  curtainQty,
  type CurtainSpec,
  type FabricSell,
  type SellCoeffs,
} from "@/lib/curtain-geom";
import { submitPortalEstimate } from "../actions";

/**
 * Self-serve estimate builder (IDEAS #48). Two sections in one estimate:
 *  - Drapery: the curtain configurator (live SELL-side pricing, see
 *    @/lib/curtain-geom).
 *  - Equipment: a curated catalog picker (LIST price only; cost never reaches
 *    the client — see @/lib/portal-catalog).
 * Both feed one running total and one submission; submitPortalEstimate
 * recomputes everything authoritatively server-side and lands ONE draft quote.
 */

/** Catalog part as the customer sees it — list price only, no cost. */
type EquipPart = { sku: string; desc: string; category: string; unit: string; list: number };

/** Display groupings over the customer-facing catalog categories. */
const GROUPS: { label: string; cats: string[] }[] = [
  { label: "Hoists", cats: ["Manual Hoist", "Motorized Hoist"] },
  { label: "Blocks & arbors", cats: ["Loftblocks", "Headblocks", "Mule Block", "Floor Block", "Arbor", "Standard Arbor", "Front Arbor", "Shoes"] },
  { label: "Rope locks", cats: ["Rope Lock"] },
  { label: "Track & pipe", cats: ["Track", "Pipe"] },
  { label: "Fixtures & lamps", cats: ["Fixtures", "Lamp"] },
  { label: "Cable & connectors", cats: ["Cable", "Cable Assemblies", "Connectors"] },
  { label: "Fog & haze", cats: ["Atmospherics"] },
  { label: "Hardware", cats: ["Hardware"] },
];

const FULLNESS: [string, string][] = [["Flat", "0"], ["50%", "50"], ["75%", "75"], ["100%", "100"]];
const EQUIP_LIMIT = 60;

const LABEL: CSSProperties = {
  display: "block", fontSize: 11, fontWeight: 600, color: "#9aa0ab",
  letterSpacing: ".05em", textTransform: "uppercase", marginBottom: 7,
};
const FIELD: CSSProperties = {
  width: "100%", fontFamily: "var(--font-ui)", fontSize: 13.5, color: "#16181d",
  background: "#fff", border: "1px solid #e4e7ec", borderRadius: 9, padding: "11px 13px", boxSizing: "border-box",
};
const CARD: CSSProperties = {
  background: "#fff", border: "1px solid #e4e7ec", borderRadius: 14,
  boxShadow: "0 1px 2px rgba(0,0,0,.04)", padding: "18px 22px",
};

function seg(on: boolean): CSSProperties {
  return {
    fontFamily: "var(--font-ui)", fontSize: 12.5, fontWeight: 600, padding: "8px 13px",
    borderRadius: 8, cursor: "pointer", border: on ? "1px solid var(--accent)" : "1px solid #e4e7ec",
    background: on ? "var(--accent)" : "#fff", color: on ? "#fff" : "#5b616e", whiteSpace: "nowrap",
  };
}
const money = (n: number) => "$" + Math.round(n).toLocaleString("en-US");

function fresh(fabricSku: string): CurtainSpec {
  return { name: "", hang: "Pipe", fabric: fabricSku, qty: "1", width: "", height: "", fullness: "50", bottom: "Chain" };
}

export function EstimateBuilder({
  companyName, venues, fabrics, coeffs, equipment, initialTab = "drapery",
}: {
  companyName: string;
  venues: Array<{ id: string; label: string; place: string }>;
  fabrics: FabricSell[];
  coeffs: SellCoeffs;
  equipment: EquipPart[];
  initialTab?: "drapery" | "equipment";
}) {
  const hasFabrics = fabrics.length > 0;
  const firstFabric = fabrics[0]?.sku || "";
  const priceOf = useMemo(() => {
    const map = new Map(fabrics.map((f) => [f.sku, f.pricePerSqft]));
    return (sku: string) => map.get(sku) ?? 0;
  }, [fabrics]);
  const priceEach = (l: CurtainSpec) => curtainPriceEach(l, priceOf(l.fabric), coeffs);

  const partBySku = useMemo(() => new Map(equipment.map((p) => [p.sku, p])), [equipment]);
  const groups = useMemo(
    () => GROUPS.filter((g) => equipment.some((p) => g.cats.includes(p.category))),
    [equipment]
  );

  const [tab, setTab] = useState<"drapery" | "equipment">(
    initialTab === "equipment" || !hasFabrics ? "equipment" : "drapery"
  );
  const [projectName, setProjectName] = useState("");
  const [venue, setVenue] = useState(venues[0]?.id || "");
  const [lines, setLines] = useState<CurtainSpec[]>(hasFabrics ? [fresh(firstFabric)] : []);
  const [cart, setCart] = useState<Record<string, number>>({});
  const [q, setQ] = useState("");
  const [group, setGroup] = useState<string>("All");
  const [pending, startTransition] = useTransition();

  /* ---- totals ---- */
  const drapeTotal = lines.reduce((a, l) => a + priceEach(l) * curtainQty(l), 0);
  const cartEntries = Object.entries(cart).filter(([, n]) => n > 0);
  const equipTotal = cartEntries.reduce((a, [sku, n]) => a + n * (partBySku.get(sku)?.list || 0), 0);
  const grand = drapeTotal + equipTotal;

  const pricedCurtains = lines.filter((l) => priceEach(l) > 0);
  const canSubmit = (pricedCurtains.length > 0 || cartEntries.length > 0) && !pending;

  /* ---- drapery ops ---- */
  const setLine = (i: number, patch: Partial<CurtainSpec>) =>
    setLines((prev) => prev.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  const addLine = () => setLines((prev) => [...prev, fresh(firstFabric)]);
  const removeLine = (i: number) => setLines((prev) => prev.filter((_, j) => j !== i));

  /* ---- equipment ops ---- */
  const bump = (sku: string, d: number) =>
    setCart((prev) => {
      const n = Math.max(0, (prev[sku] || 0) + d);
      const next = { ...prev };
      if (n === 0) delete next[sku];
      else next[sku] = n;
      return next;
    });
  const setQty = (sku: string, raw: string) =>
    setCart((prev) => {
      const n = Math.max(0, parseInt(raw, 10) || 0);
      const next = { ...prev };
      if (n === 0) delete next[sku];
      else next[sku] = n;
      return next;
    });

  const activeCats = group === "All" ? null : new Set(GROUPS.find((g) => g.label === group)?.cats || []);
  const ql = q.trim().toLowerCase();
  const matches = equipment.filter((p) => {
    if (activeCats && !activeCats.has(p.category)) return false;
    if (ql && !(p.desc.toLowerCase().includes(ql) || p.sku.toLowerCase().includes(ql))) return false;
    return true;
  });
  const shown = matches.slice(0, EQUIP_LIMIT);

  function submit() {
    if (!canSubmit) return;
    const curtainPayload = pricedCurtains.map((l) => ({
      name: l.name.trim(), hang: l.hang, fabric: l.fabric, qty: l.qty,
      width: l.width, height: l.height, fullness: l.fullness, bottom: l.bottom,
    }));
    const equipPayload = cartEntries.map(([sku, qty]) => ({ sku, qty }));
    const fd = new FormData();
    fd.set("project", projectName.trim());
    fd.set("venue", venue);
    fd.set("lines", JSON.stringify(curtainPayload));
    fd.set("equipment", JSON.stringify(equipPayload));
    startTransition(() => submitPortalEstimate(fd));
  }

  const tabBtn = (key: "drapery" | "equipment"): CSSProperties => ({
    flex: 1, textAlign: "center", cursor: "pointer", fontFamily: "var(--font-ui)",
    padding: "11px 12px", borderRadius: 10, border: "1px solid " + (tab === key ? "var(--accent)" : "#e4e7ec"),
    background: tab === key ? "var(--accent-soft, #f3edf9)" : "#fff",
  });

  return (
    <div style={{ display: "grid", gap: 16 }}>
      {/* estimate meta */}
      <div style={{ ...CARD, display: "grid", gridTemplateColumns: venues.length ? "1fr 1fr" : "1fr", gap: 14 }}>
        <div>
          <label style={LABEL}>Name this estimate</label>
          <input value={projectName} onChange={(e) => setProjectName(e.target.value)}
            placeholder="e.g. Main stage refresh" style={FIELD} />
        </div>
        {venues.length > 0 && (
          <div>
            <label style={LABEL}>Venue</label>
            <select value={venue} onChange={(e) => setVenue(e.target.value)} style={{ ...FIELD, cursor: "pointer" }}>
              {venues.map((v) => (
                <option key={v.id} value={v.id}>{v.label + (v.place ? " — " + v.place : "")}</option>
              ))}
              <option value="">Another / new venue</option>
            </select>
          </div>
        )}
      </div>

      {/* section tabs */}
      <div style={{ display: "flex", gap: 10 }}>
        <button type="button" onClick={() => setTab("drapery")} style={tabBtn("drapery")}>
          <div style={{ fontSize: 13.5, fontWeight: 600, color: tab === "drapery" ? "var(--accent)" : "#16181d" }}>Drapery</div>
          <div style={{ fontSize: 11, color: "#9aa0ab", marginTop: 2 }}>
            {pricedCurtains.length ? `${pricedCurtains.length} configured · ${money(drapeTotal)}` : "curtains & soft goods"}
          </div>
        </button>
        <button type="button" onClick={() => setTab("equipment")} style={tabBtn("equipment")}>
          <div style={{ fontSize: 13.5, fontWeight: 600, color: tab === "equipment" ? "var(--accent)" : "#16181d" }}>Equipment</div>
          <div style={{ fontSize: 11, color: "#9aa0ab", marginTop: 2 }}>
            {cartEntries.length ? `${cartEntries.length} item${cartEntries.length === 1 ? "" : "s"} · ${money(equipTotal)}` : "hoists, rigging, supplies"}
          </div>
        </button>
      </div>

      {/* ---------------- DRAPERY ---------------- */}
      {tab === "drapery" && (
        !hasFabrics ? (
          <div style={{ ...CARD, color: "#8c919c" }}>
            Drapery options aren&#39;t set up yet — add equipment on the other tab, or use “Request a
            quote” and we&#39;ll take it from there.
          </div>
        ) : (
          <>
            {lines.map((l, i) => {
              const each = priceEach(l);
              const ext = each * curtainQty(l);
              return (
                <div key={i} style={{ ...CARD, display: "grid", gap: 15 }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
                    <div style={{ fontSize: 12, fontWeight: 700, color: "#8c919c", letterSpacing: ".04em" }}>CURTAIN {i + 1}</div>
                    <button type="button" onClick={() => removeLine(i)}
                      style={{ fontFamily: "var(--font-ui)", fontSize: 11.5, fontWeight: 600, color: "#b4543a", background: "#fff", border: "1px solid #e4e7ec", borderRadius: 8, padding: "6px 10px", cursor: "pointer" }}>
                      Remove
                    </button>
                  </div>
                  <div>
                    <label style={LABEL}>Curtain name</label>
                    <input value={l.name} onChange={(e) => setLine(i, { name: e.target.value })} placeholder="e.g. Main grand drape" style={FIELD} />
                  </div>
                  <div>
                    <label style={LABEL}>Fabric</label>
                    <select value={l.fabric} onChange={(e) => setLine(i, { fabric: e.target.value })} style={{ ...FIELD, cursor: "pointer" }}>
                      {fabrics.map((f) => <option key={f.sku} value={f.sku}>{f.name}</option>)}
                    </select>
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
                    <div><label style={LABEL}>Quantity</label>
                      <input value={l.qty} onChange={(e) => setLine(i, { qty: e.target.value })} inputMode="numeric" placeholder="1" style={FIELD} /></div>
                    <div><label style={LABEL}>Width (ft)</label>
                      <input value={l.width} onChange={(e) => setLine(i, { width: e.target.value })} inputMode="decimal" placeholder="0" style={FIELD} /></div>
                    <div><label style={LABEL}>Height (ft)</label>
                      <input value={l.height} onChange={(e) => setLine(i, { height: e.target.value })} inputMode="decimal" placeholder="0" style={FIELD} /></div>
                  </div>
                  <div>
                    <label style={LABEL}>Fullness</label>
                    <div style={{ display: "flex", gap: 7, flexWrap: "wrap" }}>
                      {FULLNESS.map(([label, v]) => <button key={v} type="button" onClick={() => setLine(i, { fullness: v })} style={seg(l.fullness === v)}>{label}</button>)}
                    </div>
                  </div>
                  <div style={{ display: "flex", alignItems: "baseline", justifyContent: "flex-end", gap: 10, borderTop: "1px solid #f0f1f4", paddingTop: 12 }}>
                    {each > 0 ? (
                      <>
                        <span style={{ fontSize: 11.5, color: "#9aa0ab" }}>{money(each)} each × {curtainQty(l)}</span>
                        <span style={{ fontFamily: "var(--font-mono)", fontSize: 15, fontWeight: 700 }}>{money(ext)}</span>
                      </>
                    ) : (
                      <span style={{ fontSize: 11.5, color: "#c0683a" }}>Enter width &amp; height to price</span>
                    )}
                  </div>
                </div>
              );
            })}
            <button type="button" onClick={addLine}
              style={{ fontFamily: "var(--font-ui)", fontSize: 13, fontWeight: 600, color: "#5b616e", background: "#fff", border: "1px dashed #cfd3da", borderRadius: 10, padding: "12px 16px", cursor: "pointer" }}>
              + Add {lines.length ? "another " : ""}curtain
            </button>
          </>
        )
      )}

      {/* ---------------- EQUIPMENT ---------------- */}
      {tab === "equipment" && (
        <>
          {/* your equipment (cart) */}
          {cartEntries.length > 0 && (
            <div style={{ ...CARD, display: "grid", gap: 10 }}>
              <div style={{ fontSize: 13, fontWeight: 600 }}>Your equipment</div>
              {cartEntries.map(([sku, n]) => {
                const p = partBySku.get(sku);
                if (!p) return null;
                return (
                  <div key={sku} style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) auto auto", gap: 12, alignItems: "center", borderTop: "1px solid #f5f6f8", paddingTop: 10 }}>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: 12.5, fontWeight: 500, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{p.desc}</div>
                      <div style={{ fontFamily: "var(--font-mono)", fontSize: 10.5, color: "#aab0bb" }}>{money(p.list)} / {p.unit}</div>
                    </div>
                    <QtyStepper n={n} onMinus={() => bump(sku, -1)} onPlus={() => bump(sku, 1)} onSet={(v) => setQty(sku, v)} />
                    <div style={{ fontFamily: "var(--font-mono)", fontSize: 13, fontWeight: 600, minWidth: 74, textAlign: "right" }}>{money(p.list * n)}</div>
                  </div>
                );
              })}
            </div>
          )}

          {/* browse */}
          <div style={{ ...CARD, display: "grid", gap: 12 }}>
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search equipment & supplies…" style={FIELD} />
            <div style={{ display: "flex", gap: 7, flexWrap: "wrap" }}>
              <button type="button" onClick={() => setGroup("All")} style={seg(group === "All")}>All</button>
              {groups.map((g) => <button key={g.label} type="button" onClick={() => setGroup(g.label)} style={seg(group === g.label)}>{g.label}</button>)}
            </div>
            <div style={{ fontSize: 11, color: "#9aa0ab" }}>
              {matches.length > EQUIP_LIMIT ? `Showing ${EQUIP_LIMIT} of ${matches.length} — search to narrow` : `${matches.length} item${matches.length === 1 ? "" : "s"}`}
            </div>
            <div style={{ display: "grid", gap: 2 }}>
              {shown.map((p) => {
                const inCart = cart[p.sku] || 0;
                return (
                  <div key={p.sku} style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) auto auto", gap: 12, alignItems: "center", padding: "9px 0", borderTop: "1px solid #f5f6f8" }}>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: 12.5, fontWeight: 500, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{p.desc}</div>
                      <div style={{ fontSize: 10.5, color: "#aab0bb" }}>{p.category}</div>
                    </div>
                    <div style={{ fontFamily: "var(--font-mono)", fontSize: 12.5, fontWeight: 600, minWidth: 72, textAlign: "right" }}>{money(p.list)}</div>
                    {inCart > 0 ? (
                      <QtyStepper n={inCart} onMinus={() => bump(p.sku, -1)} onPlus={() => bump(p.sku, 1)} onSet={(v) => setQty(p.sku, v)} />
                    ) : (
                      <button type="button" onClick={() => bump(p.sku, 1)}
                        style={{ fontFamily: "var(--font-ui)", fontSize: 12, fontWeight: 600, color: "var(--accent)", background: "#fff", border: "1px solid var(--accent)", borderRadius: 8, padding: "6px 12px", cursor: "pointer", whiteSpace: "nowrap" }}>
                        + Add
                      </button>
                    )}
                  </div>
                );
              })}
              {matches.length === 0 && (
                <div style={{ padding: "18px 0", fontSize: 12.5, color: "#9aa0ab", textAlign: "center" }}>No matches — try a different search or category.</div>
              )}
            </div>
          </div>
        </>
      )}

      {/* ---------------- shared summary + submit ---------------- */}
      <div style={{ ...CARD, display: "grid", gap: 12 }}>
        {(pricedCurtains.length > 0 || cartEntries.length > 0) && (
          <div style={{ display: "grid", gap: 5, fontSize: 12.5, color: "#5b616e", borderBottom: "1px solid #f0f1f4", paddingBottom: 12 }}>
            {pricedCurtains.length > 0 && (
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span>Drapery ({pricedCurtains.length})</span><span style={{ fontFamily: "var(--font-mono)" }}>{money(drapeTotal)}</span>
              </div>
            )}
            {cartEntries.length > 0 && (
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span>Equipment ({cartEntries.length})</span><span style={{ fontFamily: "var(--font-mono)" }}>{money(equipTotal)}</span>
              </div>
            )}
          </div>
        )}
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12 }}>
          <div style={{ fontSize: 14.5, fontWeight: 600 }}>Estimated total</div>
          <div style={{ fontFamily: "var(--font-mono)", fontSize: 22, fontWeight: 700 }}>{money(grand)}</div>
        </div>
        <div style={{ fontSize: 11.5, color: "#9aa0ab", lineHeight: 1.55, marginTop: -6 }}>
          Preliminary budgetary estimate — excludes freight, tax, and any site-specific labor. A{" "}
          {companyName} specialist confirms the final quote before anything is binding.
        </div>
        <button type="button" onClick={submit} disabled={!canSubmit}
          style={{ fontFamily: "var(--font-ui)", fontSize: 14, fontWeight: 600, color: "#fff", background: canSubmit ? "var(--accent)" : "#c8ccd3", border: "none", borderRadius: 10, padding: "13px 18px", cursor: canSubmit ? "pointer" : "not-allowed" }}>
          {pending ? "Sending…" : "Submit this estimate to " + companyName}
        </button>
      </div>
    </div>
  );
}

function QtyStepper({ n, onMinus, onPlus, onSet }: { n: number; onMinus: () => void; onPlus: () => void; onSet: (v: string) => void }) {
  const btn: CSSProperties = { width: 30, height: 32, fontSize: 16, fontWeight: 600, color: "#5b616e", background: "#fff", border: "1px solid #e4e7ec", cursor: "pointer" };
  return (
    <div style={{ display: "flex", alignItems: "center" }}>
      <button type="button" onClick={onMinus} style={{ ...btn, borderRadius: "8px 0 0 8px" }}>−</button>
      <input value={n} onChange={(e) => onSet(e.target.value)} inputMode="numeric"
        style={{ width: 40, height: 32, textAlign: "center", fontFamily: "var(--font-mono)", fontSize: 13, border: "1px solid #e4e7ec", borderLeft: "none", borderRight: "none", boxSizing: "border-box", outline: "none" }} />
      <button type="button" onClick={onPlus} style={{ ...btn, borderRadius: "0 8px 8px 0" }}>+</button>
    </div>
  );
}
