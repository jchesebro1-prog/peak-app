"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import type { CSSProperties } from "react";
import { suggestPartsForMfr } from "./actions";
import type { SuggestPart } from "./estimator-data";
import { fmt, marginColor } from "./pricing";

/**
 * Quick-add suggestions strip (PUNCHLIST #14, decision B) — catalog-backed
 * replacement for the hardcoded SUGGEST/GENERIC_SUGGEST arrays. Keyed on the
 * section's own `mfr` field (now editable, see section-card.tsx); renders
 * nothing until a manufacturer is set and matches real catalog rows. Fetches
 * via suggestPartsForMfr rather than loading the catalog client-side — same
 * reasoning as CatalogPicker's searchCatalog call.
 */
export default function SuggestedParts({
  mfr,
  onAdd,
}: {
  mfr: string;
  onAdd: (p: SuggestPart) => void;
}) {
  const [parts, setParts] = useState<SuggestPart[]>([]);
  const [pending, start] = useTransition();
  const seq = useRef(0);

  useEffect(() => {
    const m = mfr.trim();
    if (!m) {
      setParts([]);
      return;
    }
    const my = ++seq.current;
    const t = setTimeout(() => {
      start(async () => {
        const res = await suggestPartsForMfr(m);
        if (my === seq.current) setParts(res);
      });
    }, 220);
    return () => clearTimeout(t);
  }, [mfr]);

  if (!mfr.trim() || (!pending && parts.length === 0)) return null;

  const wrap: CSSProperties = { marginTop: 11 };
  const label: CSSProperties = {
    fontSize: 10,
    fontWeight: 600,
    color: "#aab0bb",
    textTransform: "uppercase",
    letterSpacing: ".04em",
    marginBottom: 6,
  };

  return (
    <div style={wrap}>
      <div style={label}>Quick add · {mfr.trim()}</div>
      {pending && parts.length === 0 && (
        <div style={{ fontSize: 11, color: "#aab0bb" }}>Checking the catalog…</div>
      )}
      {parts.map((p) => {
        const margin = p.price > 0 ? (p.price - p.cost) / p.price : 0;
        return (
          <button
            type="button"
            key={p.sku}
            className="est-sug"
            onClick={() => onAdd(p)}
            style={{
              width: "100%",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 10,
              padding: "9px 11px",
              background: "#fafbfc",
              border: "1px solid #eef0f3",
              borderRadius: 8,
              marginBottom: 6,
              cursor: "pointer",
              textAlign: "left",
            }}
          >
            <span style={{ minWidth: 0 }}>
              <span
                style={{
                  fontSize: 12.5,
                  fontWeight: 600,
                  display: "block",
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                }}
              >
                {p.desc}
              </span>
              <span style={{ fontFamily: "var(--font-mono)", fontSize: 10.5, color: "#aab0bb" }}>
                {p.sku}
              </span>
            </span>
            <span style={{ display: "flex", alignItems: "center", gap: 12, flexShrink: 0 }}>
              <span style={{ textAlign: "right" }}>
                <span
                  style={{
                    fontFamily: "var(--font-mono)",
                    fontSize: 12.5,
                    color: "#16181d",
                    display: "block",
                  }}
                >
                  {fmt(p.price)}
                </span>
                <span style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: marginColor(margin) }}>
                  {Math.round(margin * 100)}%
                </span>
              </span>
              <span
                style={{
                  fontSize: 11,
                  fontWeight: 600,
                  color: "#fff",
                  background: "var(--accent)",
                  padding: "3px 9px",
                  borderRadius: 6,
                }}
              >
                Add
              </span>
            </span>
          </button>
        );
      })}
    </div>
  );
}
