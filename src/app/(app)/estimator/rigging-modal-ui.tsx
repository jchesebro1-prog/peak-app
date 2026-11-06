"use client";

import Link from "next/link";
import { fmt } from "./pricing";
import type { RiggingBom } from "./rigging-bom";
import type { SpecItem } from "./types";

/** #373 — "No pipe types yet — set one up in Estimating Rules → Pipe types". */
export function NoRiggingTypes({ noun, home, href }: { noun: string; home: string; href: string }) {
  return (
    <div role="note" style={{ padding: "10px 12px", borderRadius: 8, border: "1px solid #efe4c4", background: "#fffdf6", color: "#8a6d1f", fontSize: 12, lineHeight: 1.45 }}>
      No {noun} types yet — set one up in{" "}
      <Link href={href} style={{ color: "var(--accent)", fontWeight: 600 }}>{home}</Link>.
    </div>
  );
}

/** A part sold in the wrong unit prices badly; say so, and let the estimator decide. */
export function RiggingWarnings({ warnings }: { warnings: string[] }) {
  if (!warnings.length) return null;
  return (
    <div role="note" style={{ marginTop: 12, padding: "9px 12px", borderRadius: 8, border: "1px solid #efe4c4", background: "#fffdf6", color: "#8a6d1f", fontSize: 12, lineHeight: 1.45 }}>
      {warnings.map((w) => <div key={w}>{w}</div>)}
    </div>
  );
}

const GRID = "1.3fr 2.2fr .8fr .9fr";

/** The live BOM, or — read-only on a deleted type — the line's saved parts. */
export function RiggingPartsTable({ bom, stored }: { bom: RiggingBom; stored?: SpecItem["components"] }) {
  const rows = bom.rows.length
    ? bom.rows.map((r) => ({ key: r.key, label: r.label, part: r.missing ? r.desc : `${r.sku} · ${r.desc}`, qty: r.qty, unit: r.unit, ext: r.ext, missing: r.missing }))
    : (stored || []).map((c, i) => ({ key: c.sku + i, label: c.label, part: c.sku, qty: c.qty, unit: c.unit, ext: c.price * c.qty, missing: false }));
  if (!rows.length) return null;
  return (
    <div style={{ marginTop: 16, border: "1px solid #e4e7ec", borderRadius: 10, overflow: "hidden" }}>
      <div style={{ display: "grid", gridTemplateColumns: GRID, gap: 10, padding: "7px 12px", background: "#fafbfc", fontSize: 10, fontWeight: 700, color: "#9aa0ab", textTransform: "uppercase", letterSpacing: ".06em" }}>
        <span>Role</span>
        <span>Part</span>
        <span style={{ textAlign: "right" }}>Qty</span>
        <span style={{ textAlign: "right" }}>Ext</span>
      </div>
      {rows.map((r) => (
        <div key={r.key} style={{ display: "grid", gridTemplateColumns: GRID, gap: 10, padding: "7px 12px", borderTop: "1px solid #f3f4f7", fontSize: 12, alignItems: "center" }}>
          <span style={{ fontWeight: 600, color: "#3a3f4a" }}>{r.label}</span>
          <span style={{ color: r.missing ? "#b4543a" : "#8c919c", fontSize: 11.5, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={r.part}>{r.part}</span>
          <span style={{ textAlign: "right", fontFamily: "var(--font-mono)" }}>{r.qty}{r.unit && r.unit !== "ea" ? " " + r.unit : ""}</span>
          <span style={{ textAlign: "right", fontFamily: "var(--font-mono)" }}>{r.missing ? "—" : fmt(r.ext)}</span>
        </div>
      ))}
    </div>
  );
}
