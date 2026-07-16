"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import type { CSSProperties } from "react";
import { searchCatalog } from "./actions";
import type { CatalogHit } from "./types";
import type { SuggestPart } from "./estimator-data";
import { fmt, marginColor } from "./pricing";

/**
 * Estimator "Add part from catalog" picker — searches the real catalog (10k+
 * parts) via the searchCatalog server action, debounced, and adds the chosen
 * part to the open section. Team-only tool, so cost + margin are shown. On add,
 * the part maps to the estimator's SuggestPart shape (price = catalog list).
 */

const FIELD: CSSProperties = {
  width: "100%",
  fontSize: 12.5,
  fontFamily: "var(--font-ui)",
  color: "#16181d",
  border: "1px solid #e4e7ec",
  borderRadius: 8,
  padding: "9px 11px",
  background: "#fff",
  boxSizing: "border-box",
  outline: "none",
};

export default function CatalogPicker({ onAdd }: { onAdd: (p: SuggestPart) => void }) {
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<CatalogHit[]>([]);
  const [total, setTotal] = useState(0);
  const [pending, start] = useTransition();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const seq = useRef(0);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    const query = q.trim();
    if (!query) {
      setHits([]);
      setTotal(0);
      return;
    }
    const my = ++seq.current;
    const t = setTimeout(() => {
      start(async () => {
        const res = await searchCatalog(query);
        if (my === seq.current) {
          setHits(res.hits);
          setTotal(res.total);
        }
      });
    }, 220);
    return () => clearTimeout(t);
  }, [q]);

  return (
    <div
      style={{
        marginTop: 11,
        background: "#fafbfc",
        border: "1px solid #eef0f3",
        borderRadius: 10,
        padding: 10,
      }}
    >
      <input
        ref={inputRef}
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Search the catalog — description, SKU, or manufacturer…"
        style={FIELD}
      />

      <div style={{ marginTop: 4, fontSize: 10.5, color: "#aab0bb", padding: "2px 2px" }}>
        {!q.trim()
          ? "Start typing to search the catalog."
          : pending
          ? "Searching…"
          : total === 0
          ? "No parts match."
          : total > hits.length
          ? `Showing ${hits.length} of ${total} — refine to narrow`
          : `${total} match${total === 1 ? "" : "es"}`}
      </div>

      {hits.map((h) => {
        const margin = h.list > 0 ? (h.list - h.cost) / h.list : 0;
        return (
          <button
            type="button"
            key={h.sku}
            className="est-sug"
            onClick={() => onAdd({ sku: h.sku, desc: h.desc, cost: h.cost, price: h.list, unit: h.unit })}
            style={{
              width: "100%",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 10,
              padding: "9px 11px",
              background: "transparent",
              border: "none",
              borderRadius: 8,
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
                {h.desc}
              </span>
              <span style={{ fontFamily: "var(--font-mono)", fontSize: 10.5, color: "#aab0bb" }}>
                {h.sku}
                {h.mfr ? " · " + h.mfr : ""}
                {h.category ? " · " + h.category : ""}
              </span>
            </span>
            <span style={{ display: "flex", alignItems: "center", gap: 12, flexShrink: 0 }}>
              <span style={{ textAlign: "right" }}>
                <span style={{ fontFamily: "var(--font-mono)", fontSize: 12.5, color: "#16181d", display: "block" }}>
                  {fmt(h.list)}
                </span>
                <span style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: marginColor(margin) }}>
                  {Math.round(margin * 100)}% · cost {fmt(h.cost)}
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
