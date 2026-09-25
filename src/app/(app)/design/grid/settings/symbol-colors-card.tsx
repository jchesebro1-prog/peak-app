"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  COLOR_KEY_SAMPLE_ICON,
  DEFAULT_SYMBOL_COLORS,
  SYMBOL_COLOR_KEYS,
  SYMBOL_COLOR_LABEL,
  contrastOnWhite,
  isHexColor,
  type SymbolColorKey,
} from "@/lib/design/grid-icons";
import { SymbolIcon } from "@/components/design/symbol-shape";
import { saveSymbolColorsAction } from "./actions";

/**
 * "Symbol colours" card (stock symbols, spec 2026-09-25 §2) — the 10
 * swatches a device's badge can take: six catalog groups, three trades
 * (for trade-only categories like Track or Racks) and grey for anything
 * unmapped. Sparse save: only swatches that differ from the shipped
 * defaults are posted (settings.gridSymbolColors merges per key), so a
 * later change to a default still reaches every swatch the admin never
 * touched. "Reset to defaults" clears the key.
 */

type Colors = Record<SymbolColorKey, string>;

const inS: React.CSSProperties = {
  fontFamily: "var(--font-mono)",
  fontSize: 12,
  color: "#16181d",
  border: "1px solid #e4e7ec",
  borderRadius: 8,
  padding: "6px 9px",
  background: "#fff",
  outline: "none",
  width: 96,
};

function sparse(colors: Colors): Record<string, string> {
  const out: Record<string, string> = {};
  for (const k of SYMBOL_COLOR_KEYS) {
    const v = colors[k].toLowerCase();
    if (v !== DEFAULT_SYMBOL_COLORS[k]) out[k] = v;
  }
  return out;
}

export function SymbolColorsCard({ colors }: { colors: Colors }) {
  const router = useRouter();
  const [draft, setDraft] = useState<Colors>({ ...colors });
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [justSaved, setJustSaved] = useState(false);

  const allValid = SYMBOL_COLOR_KEYS.every((k) => isHexColor(draft[k]));
  const dirty = JSON.stringify(allValid ? sparse(draft) : draft) !== JSON.stringify(sparse(colors));
  const canSave = dirty && allValid && !pending;

  const set = (k: SymbolColorKey, v: string) => {
    setJustSaved(false);
    setError(null);
    setDraft((d) => ({ ...d, [k]: v }));
  };

  const save = (map: Record<string, string>, next: Colors) => {
    setError(null);
    startTransition(async () => {
      try {
        await saveSymbolColorsAction(map);
        setDraft(next);
        setJustSaved(true);
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Save failed — please try again.");
      }
    });
  };

  return (
    <div className="pk-card" style={{ overflow: "hidden", marginBottom: 18 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap", rowGap: 10, padding: "14px 18px", borderBottom: "1px solid #ececf0" }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 14.5, fontWeight: 600 }}>Symbol colours</div>
          <div style={{ fontSize: 12, color: "#8c919c", marginTop: 4, lineHeight: 1.45 }}>
            The colour of every device badge on the plan and the riser. A category takes its group&apos;s colour, else its
            trade&apos;s, else grey. A colour set on a single Grid entry wins.
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
          <button
            type="button"
            disabled={pending}
            onClick={() => save({}, { ...DEFAULT_SYMBOL_COLORS })}
            style={{ fontSize: 12, fontWeight: 600, color: "#5b616e", background: "transparent", border: "none", cursor: "pointer" }}
          >
            Reset to defaults
          </button>
          <button
            type="button"
            disabled={!canSave}
            onClick={() => save(sparse(draft), draft)}
            style={{ fontSize: 13, fontWeight: 600, border: "none", borderRadius: 9, padding: "9px 16px", cursor: canSave ? "pointer" : "not-allowed", color: canSave ? "#fff" : "#aab0bb", background: canSave ? "var(--accent)" : "#eef0f3", whiteSpace: "nowrap" }}
          >
            {pending ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
      {error && (
        <div style={{ margin: "12px 18px 0", fontSize: 12, color: "#b4543a", background: "#f9ece8", border: "1px solid #f0d6cd", borderRadius: 8, padding: "9px 12px" }}>
          {error}
        </div>
      )}
      {justSaved && !dirty && (
        <div style={{ margin: "12px 18px 0", fontSize: 11.5, color: "#1f7a52", fontWeight: 600 }}>✓ Saved</div>
      )}
      <div style={{ padding: "12px 18px 16px", display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 10 }}>
        {SYMBOL_COLOR_KEYS.map((k) => {
          const v = draft[k];
          const valid = isHexColor(v);
          const low = valid && contrastOnWhite(v) < 3;
          return (
            <div key={k} style={{ display: "flex", alignItems: "center", gap: 9 }}>
              <SymbolIcon iconId={COLOR_KEY_SAMPLE_ICON[k]} color={valid ? v : DEFAULT_SYMBOL_COLORS[k]} size={22} />
              <span style={{ fontSize: 12.5, fontWeight: 600, flex: 1, minWidth: 0 }}>{SYMBOL_COLOR_LABEL[k]}</span>
              <input
                type="color"
                value={valid ? v.toLowerCase() : DEFAULT_SYMBOL_COLORS[k]}
                onChange={(e) => set(k, e.target.value)}
                aria-label={`${SYMBOL_COLOR_LABEL[k]} colour picker`}
                style={{ width: 30, height: 28, border: "1px solid #e4e7ec", borderRadius: 6, padding: 0, background: "#fff", cursor: "pointer" }}
              />
              <input
                value={v}
                onChange={(e) => set(k, e.target.value.trim())}
                aria-label={`${SYMBOL_COLOR_LABEL[k]} hex colour`}
                aria-invalid={!valid}
                style={{ ...inS, borderColor: valid ? "#e4e7ec" : "#d5342a" }}
              />
              {low && (
                <span title="Low contrast with the white glyph (below 3:1)" style={{ fontSize: 11, color: "#b4543a", fontWeight: 700 }}>
                  !
                </span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
