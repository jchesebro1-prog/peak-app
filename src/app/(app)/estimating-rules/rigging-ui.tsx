"use client";

import type { CSSProperties } from "react";

/** #373 — what the Pipe types and Lineset types screens share (Track series' look). */
export type PartInfo = { desc: string; cost: number; unit: string; mfr: string };

export const INPUT: CSSProperties = { width: "100%", boxSizing: "border-box", border: "1px solid #e4e7ec", borderRadius: 7, padding: "7px 9px", fontSize: 12.5, fontFamily: "inherit", background: "#fff" };
export const BTN: CSSProperties = { border: "1px solid #dfe2e8", background: "#fff", borderRadius: 7, padding: "6px 11px", fontSize: 12, fontWeight: 600, color: "#3d424e", cursor: "pointer", fontFamily: "inherit" };
export const PRIMARY: CSSProperties = { ...BTN, background: "var(--accent)", borderColor: "var(--accent)", color: "#fff" };
export const LABEL: CSSProperties = { fontSize: 10, fontWeight: 700, color: "#9aa0ab", textTransform: "uppercase", letterSpacing: ".06em", marginBottom: 5 };
export const ROW: CSSProperties = { border: "1px solid #eef0f3", borderRadius: 9, padding: "8px 10px" };
export const money = (n: number) => "$" + n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const day = (ts?: number) => (ts ? new Date(ts).toISOString().slice(0, 10) : "");

export function PartLine({ sku, info }: { sku: string; info: PartInfo | undefined }) {
  if (!sku) return <span style={{ color: "#a0442b" }}>Not mapped</span>;
  if (!info)
    return (
      <span>
        <span style={{ fontFamily: "var(--font-mono)" }}>{sku}</span>
        <span style={{ color: "#a0442b" }}> — no longer in the catalog (counts as unmapped)</span>
      </span>
    );
  return (
    <span>
      <span style={{ fontFamily: "var(--font-mono)" }}>{sku}</span> — {info.desc}
      <span style={{ color: "#737985" }}> · cost {money(info.cost)}/{info.unit}</span>
    </span>
  );
}

export function StatusChip({ active }: { active: boolean }) {
  return (
    <span style={{ fontSize: 10.5, fontWeight: 700, borderRadius: 999, padding: "2px 8px", color: active ? "#1f7a52" : "#737985", background: active ? "#eaf6ef" : "#f1f2f5" }}>
      {active ? "Active" : "Inactive"}
    </span>
  );
}

export function UnitWarning({ text }: { text: string }) {
  return <div style={{ fontSize: 11, color: "#8a6d1f", marginTop: 5 }}>{text}</div>;
}
