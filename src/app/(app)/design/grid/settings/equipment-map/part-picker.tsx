"use client";

import { useRef, useState, useTransition, type CSSProperties } from "react";
import { searchEquipmentPartsAction, type EquipPartHit } from "../actions";

/**
 * The admin catalog-part picker (#211) — search the live catalog by SKU,
 * description or maker, click a hit to pick it. Shared by the Grid Equipment
 * map and Estimating Rules → Track series (#274). `onSuggest`, when given,
 * adds a Suggest button (the Equipment map's per-row suggestions). The picked
 * hit is handed back whole so a caller can show its description and cost
 * without another round trip. Search is admin-only (searchEquipmentPartsAction
 * gates on manage_users), like both screens that use it.
 */

const INPUT: CSSProperties = { width: "100%", boxSizing: "border-box", border: "1px solid #e4e7ec", borderRadius: 7, padding: "7px 9px", fontSize: 12.5, fontFamily: "inherit", background: "#fff" };
const BTN: CSSProperties = { border: "1px solid #dfe2e8", background: "#fff", borderRadius: 7, padding: "6px 11px", fontSize: 12, fontWeight: 600, color: "#3d424e", cursor: "pointer", fontFamily: "inherit" };
const money = (n: number | null | undefined) => (n == null ? "—" : "$" + n.toLocaleString("en-US", { maximumFractionDigits: 2 }));

export function PartPicker({
  sku,
  onPick,
  onSuggest,
  showSku = true,
}: {
  sku: string;
  onPick: (sku: string, hit: EquipPartHit) => void;
  onSuggest?: () => Promise<{ hits: EquipPartHit[] }>;
  /** Print the current SKU above the search box (the Equipment map does; Track series shows its own summary). */
  showSku?: boolean;
}) {
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<EquipPartHit[]>([]);
  const [note, setNote] = useState("");
  const [pending, start] = useTransition();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const search = (v: string) => {
    setQ(v);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(
      () =>
        start(async () => {
          const r = await searchEquipmentPartsAction(v);
          setHits(r.hits);
          setNote(r.hits.length ? `${r.total} match${r.total === 1 ? "" : "es"}${r.total > r.hits.length ? " — refine to narrow" : ""}` : "No matches");
        }),
      250
    );
  };
  const suggest = onSuggest
    ? () =>
        start(async () => {
          const r = await onSuggest();
          setHits(r.hits);
          setNote(r.hits.length ? "Suggested matches" : "No suggestions — search instead");
        })
    : null;
  return (
    <div style={{ display: "grid", gap: 5 }}>
      {showSku && sku && <div style={{ fontFamily: "var(--font-mono)", fontSize: 11.5 }}>{sku}</div>}
      <div style={{ display: "flex", gap: 6 }}>
        <input value={q} onChange={(e) => search(e.target.value)} placeholder="Search SKU, description, maker…" style={{ ...INPUT, flex: 1 }} />
        {suggest && <button type="button" onClick={suggest} style={BTN}>Suggest</button>}
      </div>
      {pending ? <div style={{ fontSize: 11, color: "#8c919c" }}>Searching…</div> : note && <div style={{ fontSize: 11, color: "#8c919c" }}>{note}</div>}
      {hits.map((h) => (
        <button
          key={h.sku}
          type="button"
          onClick={() => {
            onPick(h.sku, h);
            setHits([]);
            setNote("");
          }}
          style={{ ...BTN, textAlign: "left", fontWeight: 500, background: h.sku === sku ? "color-mix(in srgb, var(--accent) 10%, #fff)" : "#fff" }}
        >
          <span style={{ fontFamily: "var(--font-mono)" }}>{h.sku}</span> — {h.desc}
          <span style={{ color: "#8c919c" }}> · {h.category} · cost {money(h.cost)} · list {money(h.list)}</span>
        </button>
      ))}
    </div>
  );
}
