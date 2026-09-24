"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import type { CSSProperties } from "react";
import { searchCatalog } from "./actions";
import type { CatalogHit } from "./types";
import type { SuggestPart } from "./estimator-data";
import { fmt, marginColor, parseAddQty } from "./pricing";

/**
 * Estimator "Add part from catalog" picker — searches the real catalog (10k+
 * parts) via the searchCatalog server action, debounced. Team-only tool, so
 * cost + margin are shown. #160: each row has its own qty box; adding keeps
 * the panel open, clears + refocuses the search and flashes "✓ Added" — the
 * panel closes only via its toggle or ×.
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

const QTY: CSSProperties = {
  width: 52,
  fontSize: 12.5,
  fontFamily: "var(--font-mono)",
  color: "#16181d",
  border: "1px solid #e4e7ec",
  borderRadius: 6,
  padding: "4px 6px",
  background: "#fff",
  textAlign: "right",
  boxSizing: "border-box",
};

export default function CatalogPicker({
  onAdd,
  onClose,
}: {
  onAdd: (p: SuggestPart, qty: number) => void;
  onClose?: () => void;
}) {
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<CatalogHit[]>([]);
  const [total, setTotal] = useState(0);
  // The query these results belong to. Rendering is derived from it rather
  // than the effect clearing state synchronously: results show only while
  // they still match what is typed, which also keeps the previous query's
  // hits from flashing during the next query's 220ms debounce.
  const [resultQ, setResultQ] = useState("");
  const [qtys, setQtys] = useState<Record<string, string>>({});
  const [added, setAdded] = useState("");
  const [pending, start] = useTransition();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const seq = useRef(0);
  const addedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    inputRef.current?.focus();
    return () => {
      if (addedTimer.current) clearTimeout(addedTimer.current);
    };
  }, []);

  useEffect(() => {
    const query = q.trim();
    if (!query) return;
    const my = ++seq.current;
    const t = setTimeout(() => {
      start(async () => {
        const res = await searchCatalog(query);
        if (my === seq.current) {
          setHits(res.hits);
          setTotal(res.total);
          setResultQ(query);
        }
      });
    }, 220);
    return () => clearTimeout(t);
  }, [q]);

  // Results are shown only while they still match the box (see resultQ).
  const fresh = resultQ === q.trim();
  const shownHits = fresh ? hits : [];
  const shownTotal = fresh ? total : 0;

  const add = (h: CatalogHit) => {
    const qty = parseAddQty(qtys[h.sku] ?? "1");
    onAdd({ sku: h.sku, desc: h.desc, cost: h.cost, price: h.list, unit: h.unit }, qty);
    setAdded(`✓ Added ${qty} × ${h.desc}`);
    if (addedTimer.current) clearTimeout(addedTimer.current);
    addedTimer.current = setTimeout(() => setAdded(""), 2000);
    setQtys({});
    setQ("");
    inputRef.current?.focus();
  };

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
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <input
          ref={inputRef}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search the catalog — description, SKU, or manufacturer…"
          style={FIELD}
        />
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            title="Close the catalog"
            aria-label="Close the catalog"
            className="est-close"
            style={{ flexShrink: 0, border: 0, background: "none", cursor: "pointer", fontSize: 14, color: "#9aa0ab", padding: "4px 6px", borderRadius: 6 }}
          >
            ×
          </button>
        )}
      </div>

      <div style={{ marginTop: 4, fontSize: 10.5, color: "#aab0bb", padding: "2px 2px" }}>
        {!q.trim()
          ? "Start typing to search the catalog."
          : pending
          ? "Searching…"
          : shownTotal === 0
          ? "No parts match."
          : shownTotal > shownHits.length
          ? `Showing ${shownHits.length} of ${shownTotal} — refine to narrow`
          : `${shownTotal} match${shownTotal === 1 ? "" : "es"}`}
      </div>
      {added && (
        <div role="status" style={{ marginTop: 2, fontSize: 11.5, fontWeight: 600, color: "#1f7a52", padding: "2px 2px" }}>
          {added}
        </div>
      )}

      {shownHits.map((h) => {
        const margin = h.list > 0 ? (h.list - h.cost) / h.list : 0;
        return (
          <div
            key={h.sku}
            className="est-sug"
            style={{
              width: "100%",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 10,
              padding: "9px 11px",
              borderRadius: 8,
              boxSizing: "border-box",
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
            <span style={{ display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
              <span style={{ textAlign: "right" }}>
                <span style={{ fontFamily: "var(--font-mono)", fontSize: 12.5, color: "#16181d", display: "block" }}>
                  {fmt(h.list)}
                </span>
                <span style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: marginColor(margin) }}>
                  {Math.round(margin * 100)}% · cost {fmt(h.cost)}
                </span>
              </span>
              <input
                type="number"
                min={1}
                step={1}
                inputMode="numeric"
                aria-label={`Quantity of ${h.desc}`}
                value={qtys[h.sku] ?? "1"}
                onChange={(e) => setQtys((m) => ({ ...m, [h.sku]: e.target.value }))}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    add(h);
                  }
                }}
                style={QTY}
              />
              <button
                type="button"
                onClick={() => add(h)}
                style={{
                  fontSize: 11,
                  fontWeight: 600,
                  color: "#fff",
                  background: "var(--accent)",
                  padding: "4px 10px",
                  borderRadius: 6,
                  border: 0,
                  cursor: "pointer",
                  fontFamily: "var(--font-ui)",
                }}
              >
                Add
              </button>
            </span>
          </div>
        );
      })}
    </div>
  );
}
