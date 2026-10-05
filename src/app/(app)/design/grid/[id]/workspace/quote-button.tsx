"use client";

import { EquipmentMapLink } from "@/components/design/equipment-map-link";
import type { GridEditor } from "../use-grid-editor";
import { BTN } from "./toolbar-style";

/**
 * The toolbar's primary Add to quotes / Update quote button (#299) and the
 * D322 confirm that opens under it when an Auto design still has lines
 * needing a part. Split out of toolbar.tsx unchanged.
 */
export default function QuoteButton({ ed }: { ed: GridEditor }) {
  const { busy, bomEmpty, runQuote, incompleteQuote, setIncompleteQuote, activeOption, quoteNumbers } = ed;
  return (
    <div style={{ position: "relative", display: "inline-flex" }}>
      <button
        type="button"
        style={{ ...BTN, background: "#16181d", color: "#fff", borderColor: "#16181d", opacity: busy || bomEmpty ? 0.55 : 1 }}
        disabled={busy || bomEmpty}
        onClick={() => runQuote(false)}
        title={bomEmpty ? "Place something first — the BOM is empty" : "Create or update this option's draft quote"}
      >
        {activeOption.quoteId ? `Update quote ${quoteNumbers[activeOption.quoteId] ?? activeOption.quoteId}` : "Add to quotes"}
      </button>
      {/* D322 — the same confirm the BOM card shows, where this click can see it. */}
      {incompleteQuote && (
        <div
          role="alertdialog"
          data-no-nudge
          aria-label="Quote an incomplete design?"
          style={{
            position: "absolute",
            top: "calc(100% + 6px)",
            right: 0,
            zIndex: 60,
            width: 300,
            background: "#fbf0ea",
            border: "1px solid #f0d6cd",
            borderRadius: 9,
            padding: "9px 11px",
            fontSize: 11.5,
            color: "#a0442b",
            lineHeight: 1.45,
            boxShadow: "0 10px 28px rgba(0,0,0,.14)",
          }}
        >
          <div>{incompleteQuote}</div>
          <div style={{ display: "flex", gap: 8, marginTop: 7, alignItems: "center", flexWrap: "wrap" }}>
            <button type="button" style={{ ...BTN, height: 26, fontSize: 11.5 }} disabled={busy} onClick={() => runQuote(true)}>
              Quote anyway
            </button>
            <button type="button" style={{ ...BTN, height: 26, fontSize: 11.5 }} onClick={() => setIncompleteQuote(null)}>
              Cancel
            </button>
            <EquipmentMapLink style={{ fontWeight: 600, color: "#a0442b" }} fallback="Ask an admin to map them in the Equipment map.">
              Equipment map →
            </EquipmentMapLink>
          </div>
        </div>
      )}
    </div>
  );
}
