"use client";

import { SYMBOL_SCALE_MAX, SYMBOL_SCALE_MIN, SYMBOL_SCALE_STEP, type SymbolMode } from "@/lib/design/grid-symbol-display";
import type { GridEditor } from "../use-grid-editor";
import { BTN } from "./toolbar-style";

/**
 * Symbols (#300) — the toolbar's Size slider and Generic / Object switch.
 * Both are a per-design display setting (saved on the design, so the plan
 * and the printed drawing set match), never an undo step. The slider paints
 * every step and writes once the hand settles; double-click resets to 100 %.
 */

const MODES: { mode: SymbolMode; label: string }[] = [
  { mode: "generic", label: "Generic" },
  { mode: "object", label: "Object" },
];

export default function SymbolControls({ ed }: { ed: GridEditor }) {
  const { symbolDisplay, setSymbolScale, setSymbolMode } = ed;
  const pct = Math.round(symbolDisplay.scale * 100);
  return (
    <div role="group" aria-label="Symbols" style={{ display: "inline-flex", alignItems: "center", gap: 6, flex: "0 0 auto" }}>
      <label
        title="Symbol size — drag to resize every symbol on this design; double-click for 100 %"
        style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 12, fontWeight: 600, color: "#3d424e" }}
      >
        Size
        <input
          type="range"
          min={Math.round(SYMBOL_SCALE_MIN * 100)}
          max={Math.round(SYMBOL_SCALE_MAX * 100)}
          step={Math.round(SYMBOL_SCALE_STEP * 100)}
          value={pct}
          aria-label="Symbol size"
          aria-valuetext={`${pct}%`}
          onChange={(e) => setSymbolScale(Number(e.target.value) / 100)}
          onDoubleClick={() => setSymbolScale(1)}
          style={{ width: 84, accentColor: "var(--accent)", cursor: "pointer" }}
        />
        <span style={{ minWidth: 34, fontVariantNumeric: "tabular-nums", fontWeight: 500, color: "#8c919c" }}>{pct}%</span>
      </label>
      <span
        role="group"
        aria-label="Symbol style"
        title="Show product drawings where a part has one (falls back to the generic icon)"
        style={{ display: "inline-flex" }}
      >
        {MODES.map(({ mode, label }, i) => {
          const on = symbolDisplay.mode === mode;
          return (
            <button
              key={mode}
              type="button"
              aria-pressed={on}
              onClick={() => setSymbolMode(mode)}
              style={{
                ...BTN,
                height: 24,
                padding: "0 8px",
                borderColor: on ? "#16181d" : "#dfe2e8",
                background: on ? "#16181d" : "#fff",
                color: on ? "#fff" : "#3d424e",
                borderRadius: i === 0 ? "7px 0 0 7px" : "0 7px 7px 0",
                marginLeft: i === 0 ? 0 : -1,
              }}
            >
              {label}
            </button>
          );
        })}
      </span>
    </div>
  );
}
