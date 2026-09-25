"use client";

import { useState } from "react";
import { iconById, isHexColor, type SymbolLook } from "@/lib/design/grid-icons";
import { IconPicker } from "@/components/design/icon-picker";

/**
 * Per-entry symbol override (#131 → stock symbols, spec 2026-09-25): the
 * icon and, optionally, the colour for ONE Grid library entry — every placed
 * instance, on every design, redraws. The category default lives in Grid
 * Settings. Colour edits are drafted locally and applied with a button (a
 * native colour input fires on every drag step); the editor keys this panel
 * by entry id + resolved colour, so the draft resets after each save.
 */
export default function SymbolLookPanel({
  desc,
  look,
  base,
  hasIcon,
  hasColor,
  busy,
  onSave,
}: {
  desc: string;
  /** The entry's resolved look (overrides applied). */
  look: SymbolLook;
  /** What the entry would draw with no overrides (category defaults). */
  base: SymbolLook;
  hasIcon: boolean;
  hasColor: boolean;
  busy: boolean;
  onSave: (patch: { icon?: string; color?: string }) => void;
}) {
  const [draft, setDraft] = useState(look.color);
  const changed = isHexColor(draft) && draft.toLowerCase() !== look.color;
  return (
    <div style={{ marginTop: 7, paddingTop: 6, borderTop: "1px solid #f0dcbb", fontSize: 11, color: "#5b616e" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <span style={{ flexShrink: 0, width: 42 }}>Icon</span>
        <IconPicker
          value={look.iconId}
          color={look.color}
          label={`Icon for ${desc}`}
          disabled={busy}
          onChange={(id) => onSave({ icon: id })}
          clearLabel={hasIcon ? `Use the category default (${iconById(base.iconId).label})` : undefined}
          onClear={hasIcon ? () => onSave({ icon: "" }) : undefined}
        />
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 5 }}>
        <span style={{ flexShrink: 0, width: 42 }}>Colour</span>
        <input
          type="color"
          value={isHexColor(draft) ? draft.toLowerCase() : look.color}
          disabled={busy}
          onChange={(e) => setDraft(e.target.value)}
          aria-label={`Colour for ${desc}`}
          style={{ width: 30, height: 24, border: "1px solid #dfe2e8", borderRadius: 6, padding: 0, background: "#fff", cursor: "pointer" }}
        />
        {changed && (
          <button type="button" disabled={busy} onClick={() => onSave({ color: draft.toLowerCase() })} style={{ fontSize: 11, fontWeight: 600, color: "var(--accent)", background: "transparent", border: "none", cursor: "pointer", padding: 0 }}>
            Apply
          </button>
        )}
        {hasColor && !changed && (
          <button type="button" disabled={busy} onClick={() => onSave({ color: "" })} style={{ fontSize: 11, fontWeight: 600, color: "#5b616e", background: "transparent", border: "none", cursor: "pointer", padding: 0 }}>
            Use the default colour
          </button>
        )}
      </div>
      <div style={{ fontSize: 10.5, color: "#8c919c", marginTop: 3 }}>Applies to every placed {desc}.</div>
    </div>
  );
}
