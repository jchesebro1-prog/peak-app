"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { iconById, searchIcons } from "@/lib/design/grid-icons";
import { SymbolIcon } from "./symbol-shape";

/**
 * Searchable stock-icon picker (spec 2026-09-25 §6) — Grid Settings'
 * Category icons card and the Grid editor's per-entry override both use it.
 * A button shows the current badge; opening it reveals a search box (filters
 * by id, label and tag) over a grid of badges drawn in `color`. Keyboard:
 * Tab into the search box, ↓ to the grid, arrows move, Enter/Space picks,
 * Escape closes. Imports only pure modules (grid-icons, symbol-shape).
 */

const COLS = 8;

export function IconPicker({
  value,
  color,
  onChange,
  label,
  disabled = false,
  clearLabel,
  onClear,
}: {
  value: string;
  color: string;
  onChange: (iconId: string) => void;
  /** Accessible name, e.g. "Icon for Speakers". */
  label: string;
  disabled?: boolean;
  /** When set, the panel offers a "use the default" button (e.g. "Category default"). */
  clearLabel?: string;
  onClear?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const gridRef = useRef<HTMLDivElement | null>(null);
  const results = useMemo(() => searchIcons(q), [q]);
  const current = iconById(value);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const focusCell = (i: number) => {
    const cells = gridRef.current?.querySelectorAll<HTMLButtonElement>("button[data-cell]");
    if (!cells || !cells.length) return;
    cells[Math.max(0, Math.min(cells.length - 1, i))].focus();
  };

  const pick = (id: string) => {
    onChange(id);
    setOpen(false);
    setQ("");
  };

  return (
    <div ref={wrapRef} style={{ position: "relative", display: "inline-block" }}>
      <button
        type="button"
        disabled={disabled}
        aria-label={`${label}: ${current.label}`}
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        style={{
          display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, fontFamily: "var(--font-ui)",
          border: "1px solid #e4e7ec", borderRadius: 8, padding: "4px 8px", background: "#fff",
          cursor: disabled ? "not-allowed" : "pointer", color: "#3d424e", maxWidth: 220,
        }}
      >
        <SymbolIcon iconId={current.id} color={color} size={16} />
        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{current.label}</span>
        <span aria-hidden style={{ color: "#9aa0ab" }}>▾</span>
      </button>
      {open && (
        <div
          role="dialog"
          aria-label={label}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.stopPropagation();
              setOpen(false);
            }
          }}
          style={{
            position: "absolute", zIndex: 40, top: "calc(100% + 4px)", right: 0, width: 300, padding: 10,
            background: "#fff", border: "1px solid #e4e7ec", borderRadius: 10, boxShadow: "0 8px 24px rgba(22,24,29,.12)",
          }}
        >
          <input
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                focusCell(0);
              }
              if (e.key === "Enter" && results[0]) {
                e.preventDefault();
                pick(results[0].id);
              }
            }}
            placeholder="Search icons (name or tag)"
            aria-label="Search icons"
            style={{ width: "100%", fontSize: 12.5, border: "1px solid #e4e7ec", borderRadius: 8, padding: "6px 9px", outline: "none", marginBottom: 8 }}
          />
          {clearLabel && onClear && (
            <button
              type="button"
              onClick={() => {
                onClear();
                setOpen(false);
                setQ("");
              }}
              style={{ fontSize: 11.5, fontWeight: 600, color: "var(--accent)", background: "transparent", border: "none", cursor: "pointer", padding: "0 0 8px" }}
            >
              {clearLabel}
            </button>
          )}
          <div
            ref={gridRef}
            role="listbox"
            aria-label="Icons"
            onKeyDown={(e) => {
              const i = Number((document.activeElement as HTMLElement | null)?.dataset?.cell ?? -1);
              if (i < 0) return;
              const step = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: COLS, ArrowUp: -COLS }[e.key];
              if (step === undefined) return;
              e.preventDefault();
              focusCell(i + step);
            }}
            style={{ display: "grid", gridTemplateColumns: `repeat(${COLS}, 1fr)`, gap: 4, maxHeight: 220, overflowY: "auto" }}
          >
            {results.map((icon, i) => (
              <button
                key={icon.id}
                type="button"
                data-cell={i}
                role="option"
                aria-selected={icon.id === value}
                title={icon.label}
                aria-label={icon.label}
                onClick={() => pick(icon.id)}
                style={{
                  display: "flex", alignItems: "center", justifyContent: "center", padding: 3, borderRadius: 7, cursor: "pointer",
                  border: icon.id === value ? "2px solid #16181d" : "1px solid #eef0f3", background: "#fff",
                }}
              >
                <SymbolIcon iconId={icon.id} color={color} size={20} />
              </button>
            ))}
            {results.length === 0 && (
              <div style={{ gridColumn: `1 / span ${COLS}`, fontSize: 12, color: "#9aa0ab", padding: "10px 0", textAlign: "center" }}>
                No icons match “{q}”.
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
